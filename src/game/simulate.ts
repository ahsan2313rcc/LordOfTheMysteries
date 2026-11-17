import { runAiTurn } from "./ai";
import { CARD_DEFS } from "./cards";
import { createGame, currentPlayer, endTurn, getRng } from "./engine";
import { hydrateLearner, playNetworkTurn } from "./learner";
import { PATHWAYS } from "./pathways";
import type { GameState } from "./types";

export type SeatController = "nn" | "ai";

export interface SimPlay {
  defId: string;
  playerId: string;
  pathwayId: string;
  turn: number;
  damage: number;
  swing?: boolean;
}

export interface SeatFinish {
  pathwayId: string;
  sequence: number;
  alive: boolean;
  hp: number;
  sanity: number;
  sanityBroken: boolean;
  weaponId?: string;
  charmIds: string[];
  artifactId?: string;
}

export interface GameReplay {
  seed: number;
  players: number;
  pathways: { name: string; pathwayId: string; controller?: SeatController }[];
  turns: number;
  timedOut: boolean;
  winReason: string;
  winnerPathway: string;
  winnerName: string;
  /** Sequence number the winner finished on. Smaller is further along. */
  winnerSequence?: number;
  /** Most advanced opponent's sequence number. */
  bestOtherSequence?: number;
  /**
   * Winner finished with a higher sequence number than someone else.
   * They were less advanced and still won.
   */
  lowerSeqWin: boolean;
  /** Winner finished further along than every other seat. */
  seqLeadWin: boolean;
  seqTie: boolean;
  /** Winner fell to 10 HP or less while an opponent led by 6 or more. */
  hpComeback: boolean;
  /** After that hole, the winner's HP climbed at least 4. */
  healedComeback: boolean;
  /** Winner was behind on Sequence, then finished equal or ahead of that lead. */
  seqComeback: boolean;
  attacks: number;
  hpDealt: number;
  ascensions: number;
  abilities: number;
  sanityDealt: number;
  unarmed: number;
  /** Sequence steps the table climbed, summed across seats. */
  steps: number;
  sequences: SeatFinish[];
  plays: SimPlay[];
  log: { text: string; tone?: string }[];
}

export interface CardStat {
  id: string;
  name: string;
  type: string;
  rarity: string;
  plays: number;
  damage: number;
  winPlays: number;
  damagePerPlay: number;
  winRateWhenPlayed: number;
}

export interface PathwayStat {
  id: string;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  avgSequence: number;
  avgTurns: number;
  /** How many sequences the seat climbed, on average. */
  avgSteps: number;
  hpWins: number;
  sanityWins: number;
  ascensionWins: number;
  lowerSeqWins: number;
  seqLeadWins: number;
  hpComebacks: number;
  healedComebacks: number;
  seqComebacks: number;
  avgWinSequence: number;
}

/** A counted slice: plays, holds, or wins over a shared denominator. */
export interface RateStat {
  id: string;
  label: string;
  count: number;
  wins: number;
  rate: number;
}

export interface GearStat {
  id: string;
  name: string;
  slot: "relic" | "weapon" | "charm";
  rarity: string;
  held: number;
  holderWins: number;
  holderWinRate: number;
  plays: number;
  winRateWhenPlayed: number;
}

export interface SimReport {
  players: number;
  games: number;
  finished: number;
  timeouts: number;
  avgTurns: number;
  avgAttacks: number;
  avgHpDealt: number;
  pace: {
    ascensions: number;
    abilities: number;
    sanityDealt: number;
    unarmed: number;
    steps: number;
    under20: number;
    under40: number;
    under80: number;
    over80: number;
  };
  avgSequence: number;
  /** Games with a named winner. Sanity wipes and timeouts are not included. */
  decided: number;
  endings: { hp: number; sanity: number; ascension: number; timeout: number; other: number };
  lowerSeqWins: number;
  seqLeadWins: number;
  seqTies: number;
  hpComebacks: number;
  healedComebacks: number;
  seqComebacks: number;
  /** Either an HP hole or a sequence catch-up. */
  anyComebacks: number;
  /** Index is the sequence number, 0 through 9. */
  winnerSequence: number[];
  avgWinnerSequence: number;
  /** Seats who finished holding at least one rare weapon, charm, or relic. */
  rareGearSeats: number;
  rareGearWins: number;
  gear: GearStat[];
  gearBuckets: RateStat[];
  playBuckets: RateStat[];
  cards: CardStat[];
  pathways: PathwayStat[];
  replays: GameReplay[];
  /** Games where the table had both a neural network and a search AI. */
  mixedGames: number;
  nnWins: number;
  aiWins: number;
  controllerDraws: number;
  seatControllers: SeatController[];
}

function shuffleIds(seed: number): string[] {
  const arr = PATHWAYS.map((p) => p.id);
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

interface Trail {
  minHoleHp: number;
  sawHole: boolean;
  roseAfterHole: boolean;
  seqBehind: boolean;
  /** Most advanced opponent sequence seen while this seat was strictly behind. */
  bestOppWhileBehind: number;
}

function emptyTrail(): Trail {
  return {
    minHoleHp: 99,
    sawHole: false,
    roseAfterHole: false,
    seqBehind: false,
    bestOppWhileBehind: 99,
  };
}

/** Record HP holes and sequence deficits. Sequence 9 is the start; a smaller number is further along. */
function noteTrail(state: GameState, trails: Map<string, Trail>) {
  const living = state.players.filter((p) => p.alive);
  for (const p of living) {
    const trail = trails.get(p.id) ?? emptyTrail();
    trails.set(p.id, trail);
    const downBySix = living.some((o) => o.id !== p.id && o.hp >= p.hp + 6);
    if (p.hp <= 10 && downBySix) {
      trail.sawHole = true;
      trail.minHoleHp = Math.min(trail.minHoleHp, p.hp);
    }
    if (trail.sawHole && p.hp >= trail.minHoleHp + 4) trail.roseAfterHole = true;
    if (state.turnNumber < 4) continue;
    let best = 99;
    for (const o of living) {
      if (o.id === p.id || o.sequence >= p.sequence) continue;
      best = Math.min(best, o.sequence);
    }
    if (best < 99) {
      trail.seqBehind = true;
      trail.bestOppWhileBehind = Math.min(trail.bestOppWhileBehind, best);
    }
  }
}

function runNetworkTurn(state: GameState) {
  const seatId = currentPlayer(state).id;
  let guard = 0;
  while (
    (state.phase as string) === "action" &&
    currentPlayer(state).id === seatId &&
    currentPlayer(state).alive &&
    !currentPlayer(state).sanityBroken &&
    guard < 22
  ) {
    guard += 1;
    if (!playNetworkTurn(state)) break;
  }
  if (
    (state.phase as string) === "action" &&
    currentPlayer(state).id === seatId &&
    currentPlayer(state).alive
  ) {
    endTurn(state, getRng(state));
  }
}

export function playAiGame(
  seed: number,
  players: 2 | 4,
  maxTurns = 280,
  arcanaConcealment = false,
  controllers?: SeatController[],
): GameReplay {
  const ids = shuffleIds(seed);
  const state: GameState = createGame({
    humanPathwayId: ids[0]!,
    aiPathwayIds: ids.slice(1, players),
    seed,
    humanName: "Seat 1",
    arcanaConcealment,
  });
  for (const p of state.players) p.isHuman = false;
  state.simPlays = [];
  const kinds: SeatController[] = state.players.map((_, i) => controllers?.[i] ?? "ai");
  const trails = new Map<string, Trail>();

  const ended = () => (state.phase as string) === "gameover";
  let guard = 0;
  while (!ended() && guard < maxTurns) {
    const before = state.turnNumber;
    const idx = state.players.findIndex((p) => p.id === currentPlayer(state).id);
    if (kinds[idx] === "nn") runNetworkTurn(state);
    else runAiTurn(state);
    if (state.turnNumber === before && !ended()) {
      endTurn(state, getRng(state));
    }
    noteTrail(state, trails);
    guard += 1;
  }

  return replayFrom(state, trails, seed, players, kinds);
}

function replayFrom(
  state: GameState,
  trails: Map<string, Trail>,
  seed: number,
  players: 2 | 4,
  controllers?: SeatController[],
): GameReplay {
  const winner = state.players.find((p) => p.id === state.winnerId);
  const others = state.players.filter((p) => p.id !== winner?.id);
  const bestOther =
    winner && others.length ? Math.min(...others.map((p) => p.sequence)) : undefined;
  const trail = winner ? trails.get(winner.id) : undefined;
  const lowerSeqWin = winner != null && bestOther != null && winner.sequence > bestOther;
  const seqLeadWin = winner != null && bestOther != null && winner.sequence < bestOther;
  const seqTie = winner != null && bestOther != null && winner.sequence === bestOther;
  const seqComeback =
    !!winner &&
    !!trail?.seqBehind &&
    winner.sequence <= trail.bestOppWhileBehind;
  const reason = state.winReason ?? (state.phase === "gameover" ? "unknown" : "timeout");
  const summary = winner
    ? `${winner.name} won by ${reason} in ${state.turnNumber} turns.`
    : `No winner after ${state.turnNumber} turns (${reason}).`;
  const logged = state.log.slice(-220).map((e) => ({ text: e.text, tone: e.tone }));
  return {
    seed,
    players,
    pathways: state.players.map((p, i) => ({
      name: p.name,
      pathwayId: p.pathwayId,
      controller: controllers?.[i],
    })),
    turns: state.turnNumber,
    timedOut: state.phase !== "gameover",
    winReason: reason,
    winnerPathway: winner?.pathwayId ?? "",
    winnerName: winner?.name ?? "",
    winnerSequence: winner?.sequence,
    bestOtherSequence: bestOther,
    lowerSeqWin,
    seqLeadWin,
    seqTie,
    hpComeback: !!winner && !!trail?.sawHole,
    healedComeback: !!winner && !!trail?.roseAfterHole,
    seqComeback,
    sequences: state.players.map((p) => ({
      pathwayId: p.pathwayId,
      sequence: p.sequence,
      alive: p.alive,
      hp: p.hp,
      sanity: p.sanity,
      sanityBroken: !!p.sanityBroken,
      weaponId: p.weapon?.defId,
      charmIds: p.charms.map((c) => c.defId),
      artifactId: p.artifact?.defId,
    })),
    plays: state.simPlays ?? [],
    attacks: state.simAttacks ?? 0,
    hpDealt: state.simHpDealt ?? 0,
    ascensions: state.simAscensions ?? 0,
    abilities: state.simAbilities ?? 0,
    sanityDealt: state.simSanityDealt ?? 0,
    unarmed: state.simUnarmed ?? 0,
    steps: state.players.reduce((n, p) => n + (9 - p.sequence), 0),
    log: logged.length ? logged : [{ text: summary, tone: "system" }],
  };
}

function gearSlot(type: string): GearStat["slot"] | null {
  if (type === "artifact") return "relic";
  if (type === "weapon" || type === "charm") return type;
  return null;
}

function emptyReport(players: number): SimReport {
  const cardMap = new Map<string, CardStat>();
  const gear: GearStat[] = [];
  for (const c of CARD_DEFS) {
    cardMap.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.type,
      rarity: c.rarity,
      plays: 0,
      damage: 0,
      winPlays: 0,
      damagePerPlay: 0,
      winRateWhenPlayed: 0,
    });
    const slot = gearSlot(c.type);
    if (slot) {
      gear.push({
        id: c.id,
        name: c.name,
        slot,
        rarity: c.rarity,
        held: 0,
        holderWins: 0,
        holderWinRate: 0,
        plays: 0,
        winRateWhenPlayed: 0,
      });
    }
  }
  return {
    players,
    games: 0,
    finished: 0,
    timeouts: 0,
    avgTurns: 0,
    avgAttacks: 0,
    avgHpDealt: 0,
    pace: {
      ascensions: 0,
      abilities: 0,
      sanityDealt: 0,
      unarmed: 0,
      steps: 0,
      under20: 0,
      under40: 0,
      under80: 0,
      over80: 0,
    },
    avgSequence: 9,
    decided: 0,
    endings: { hp: 0, sanity: 0, ascension: 0, timeout: 0, other: 0 },
    lowerSeqWins: 0,
    seqLeadWins: 0,
    seqTies: 0,
    hpComebacks: 0,
    healedComebacks: 0,
    seqComebacks: 0,
    anyComebacks: 0,
    winnerSequence: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    avgWinnerSequence: 0,
    rareGearSeats: 0,
    rareGearWins: 0,
    gear,
    gearBuckets: [],
    playBuckets: [],
    cards: [...cardMap.values()],
    pathways: PATHWAYS.map((p) => ({
      id: p.id,
      name: p.name,
      games: 0,
      wins: 0,
      winRate: 0,
      avgSequence: 9,
      avgTurns: 0,
      avgSteps: 0,
      hpWins: 0,
      sanityWins: 0,
      ascensionWins: 0,
      lowerSeqWins: 0,
      seqLeadWins: 0,
      hpComebacks: 0,
      healedComebacks: 0,
      seqComebacks: 0,
      avgWinSequence: 0,
    })),
    replays: [],
    mixedGames: 0,
    nnWins: 0,
    aiWins: 0,
    controllerDraws: 0,
    seatControllers: [],
  };
}

function tallyEnding(report: SimReport, game: GameReplay) {
  if (game.timedOut) report.endings.timeout += 1;
  else if (game.winReason === "lastStanding") report.endings.hp += 1;
  else if (game.winReason === "madness") report.endings.sanity += 1;
  else if (game.winReason === "apotheosis") report.endings.ascension += 1;
  else report.endings.other += 1;
}

function holdGear(gearById: Map<string, GearStat>, id: string | undefined, won: boolean): boolean {
  if (!id) return false;
  const row = gearById.get(id);
  if (!row) return false;
  row.held += 1;
  if (won) row.holderWins += 1;
  return row.rarity === "rare" || row.slot === "relic";
}

function absorb(report: SimReport, game: GameReplay, keepReplay: boolean) {
  report.games += 1;
  const kinds = game.pathways.map((p) => p.controller).filter((c): c is SeatController => !!c);
  if (kinds.includes("nn") && kinds.includes("ai")) {
    report.mixedGames += 1;
    const winnerIdx = game.pathways.findIndex((p) => p.pathwayId === game.winnerPathway && p.name === game.winnerName);
    const winnerKind = winnerIdx >= 0 ? game.pathways[winnerIdx]?.controller : undefined;
    if (winnerKind === "nn") report.nnWins += 1;
    else if (winnerKind === "ai") report.aiWins += 1;
    else report.controllerDraws += 1;
  }
  if (game.timedOut) report.timeouts += 1;
  else report.finished += 1;
  tallyEnding(report, game);
  if (keepReplay) report.replays.push(game);
  report.pace.ascensions += game.ascensions;
  report.pace.abilities += game.abilities;
  report.pace.sanityDealt += game.sanityDealt;
  report.pace.unarmed += game.unarmed;
  report.pace.steps += game.steps;
  if (game.turns <= 20) report.pace.under20 += 1;
  else if (game.turns <= 40) report.pace.under40 += 1;
  else if (game.turns <= 80) report.pace.under80 += 1;
  else report.pace.over80 += 1;

  const decided = !!game.winnerPathway;
  if (decided) {
    report.decided += 1;
    if (game.lowerSeqWin) report.lowerSeqWins += 1;
    if (game.seqLeadWin) report.seqLeadWins += 1;
    if (game.seqTie) report.seqTies += 1;
    if (game.hpComeback) report.hpComebacks += 1;
    if (game.healedComeback) report.healedComebacks += 1;
    if (game.seqComeback) report.seqComebacks += 1;
    if (game.hpComeback || game.seqComeback) report.anyComebacks += 1;
    if (game.winnerSequence != null && game.winnerSequence >= 0 && game.winnerSequence <= 9) {
      report.winnerSequence[game.winnerSequence] += 1;
    }
  }

  const mirrorTable =
    game.sequences.length > 1 &&
    game.sequences.every((seat) => seat.pathwayId === game.sequences[0]!.pathwayId);
  const pathById = new Map(report.pathways.map((p) => [p.id, p]));
  if (!mirrorTable) for (const seat of game.sequences) {
    const row = pathById.get(seat.pathwayId);
    if (!row) continue;
    const games = row.games + 1;
    row.avgSequence = (row.avgSequence * row.games + seat.sequence) / games;
    row.avgSteps = (row.avgSteps * row.games + (9 - seat.sequence)) / games;
    row.avgTurns = (row.avgTurns * row.games + game.turns) / games;
    row.games = games;
    if (seat.pathwayId === game.winnerPathway) {
      row.wins += 1;
      row.avgWinSequence = (row.avgWinSequence * (row.wins - 1) + seat.sequence) / row.wins;
      if (game.winReason === "lastStanding") row.hpWins += 1;
      else if (game.winReason === "madness") row.sanityWins += 1;
      else if (game.winReason === "apotheosis") row.ascensionWins += 1;
      if (game.lowerSeqWin) row.lowerSeqWins += 1;
      if (game.seqLeadWin) row.seqLeadWins += 1;
      if (game.hpComeback) row.hpComebacks += 1;
      if (game.healedComeback) row.healedComebacks += 1;
      if (game.seqComeback) row.seqComebacks += 1;
    }
    row.winRate = row.wins / row.games;
  }

  const gearById = new Map(report.gear.map((g) => [g.id, g]));
  for (const seat of game.sequences) {
    const won = seat.pathwayId === game.winnerPathway && !!game.winnerPathway;
    let rare = holdGear(gearById, seat.weaponId, won);
    rare = holdGear(gearById, seat.artifactId, won) || rare;
    for (const charmId of seat.charmIds) rare = holdGear(gearById, charmId, won) || rare;
    if (rare) {
      report.rareGearSeats += 1;
      if (won) report.rareGearWins += 1;
    }
  }

  const cardById = new Map(report.cards.map((c) => [c.id, c]));
  for (const play of game.plays) {
    const row = cardById.get(play.defId);
    if (!row) continue;
    if (!play.swing) {
      row.plays += 1;
      if (play.pathwayId === game.winnerPathway) row.winPlays += 1;
    }
    row.damage += play.damage;
  }
}

function rate(count: number, wins: number): number {
  return count ? wins / count : 0;
}

function pushBucket(rows: RateStat[], id: string, label: string, count: number, wins: number) {
  rows.push({ id, label, count, wins, rate: rate(count, wins) });
}

function finalize(report: SimReport, attackSum: number, hpSum: number) {
  const finished = report.finished;
  report.avgTurns = finished
    ? report.replays.filter((r) => !r.timedOut).reduce((n, r) => n + r.turns, 0) /
      Math.max(1, report.replays.filter((r) => !r.timedOut).length)
    : 0;
  // avgTurns must cover dropped games too — stored on a side field during absorb.
  report.avgAttacks = report.games ? attackSum / report.games : 0;
  report.avgHpDealt = report.games ? hpSum / report.games : 0;
  const seats = report.pathways.reduce((n, p) => n + p.games, 0);
  report.avgSequence = seats
    ? report.pathways.reduce((n, p) => n + p.avgSequence * p.games, 0) / seats
    : 9;
  const cardById = new Map(report.cards.map((c) => [c.id, c]));
  for (const c of report.cards) {
    c.damagePerPlay = c.plays ? c.damage / c.plays : 0;
    c.winRateWhenPlayed = c.plays ? c.winPlays / c.plays : 0;
  }
  for (const g of report.gear) {
    const card = cardById.get(g.id);
    g.plays = card?.plays ?? 0;
    g.winRateWhenPlayed = card?.winRateWhenPlayed ?? 0;
    g.holderWinRate = rate(g.held, g.holderWins);
  }
  const winSeqTotal = report.winnerSequence.reduce((n, c) => n + c, 0);
  const winSeqSum = report.winnerSequence.reduce((n, c, seq) => n + c * seq, 0);
  report.avgWinnerSequence = winSeqTotal ? winSeqSum / winSeqTotal : 0;

  const gearBuckets: RateStat[] = [];
  const bucket = (id: string, label: string, rows: GearStat[]) => {
    const count = rows.reduce((n, g) => n + g.held, 0);
    const wins = rows.reduce((n, g) => n + g.holderWins, 0);
    pushBucket(gearBuckets, id, label, count, wins);
  };
  bucket("relic", "Relics held", report.gear.filter((g) => g.slot === "relic"));
  bucket("rare-weapon", "Rare weapons held", report.gear.filter((g) => g.slot === "weapon" && g.rarity === "rare"));
  bucket("common-weapon", "Common weapons held", report.gear.filter((g) => g.slot === "weapon" && g.rarity === "common"));
  bucket("rare-charm", "Rare charms held", report.gear.filter((g) => g.slot === "charm" && g.rarity === "rare"));
  bucket("common-charm", "Common charms held", report.gear.filter((g) => g.slot === "charm" && g.rarity === "common"));
  pushBucket(gearBuckets, "any-rare", "Any rare gear held", report.rareGearSeats, report.rareGearWins);
  report.gearBuckets = gearBuckets;

  const playBuckets: RateStat[] = [];
  const playBucket = (id: string, label: string, rows: CardStat[]) => {
    const count = rows.reduce((n, c) => n + c.plays, 0);
    const wins = rows.reduce((n, c) => n + c.winPlays, 0);
    pushBucket(playBuckets, id, label, count, wins);
  };
  playBucket("common", "Common cards played", report.cards.filter((c) => c.rarity === "common"));
  playBucket("rare", "Rare cards played", report.cards.filter((c) => c.rarity === "rare" && c.type !== "artifact"));
  playBucket("relic", "Relics played", report.cards.filter((c) => c.type === "artifact"));
  const typeLabels: Record<string, string> = {
    weapon: "Weapons played",
    spell: "Spells played",
    utility: "Utilities played",
    charm: "Charms played",
    trap: "Traps played",
  };
  for (const type of Object.keys(typeLabels)) {
    playBucket(type, typeLabels[type]!, report.cards.filter((c) => c.type === type));
  }
  playBucket(
    "theft",
    "Theft cards played",
    report.cards.filter((c) => c.id === "bribe" || c.id === "errors_theft"),
  );
  report.playBuckets = playBuckets;

  report.cards.sort((a, b) => b.plays - a.plays || b.damagePerPlay - a.damagePerPlay);
  report.gear.sort((a, b) => b.held - a.held || b.holderWinRate - a.holderWinRate || a.name.localeCompare(b.name));
  report.pathways.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

export function runSimulation(opts: {
  players: 2 | 4;
  games: number;
  seed?: number;
  /** Chronicle replays kept for the viewer. Stats still cover every game. */
  keepReplays?: number;
  arcanaConcealment?: boolean;
  controllers?: SeatController[];
}): SimReport {
  const report = emptyReport(opts.players);
  report.seatControllers = (opts.controllers ?? []).slice(0, opts.players);
  if (report.seatControllers.some((c) => c === "nn")) hydrateLearner();
  const keep = opts.keepReplays ?? opts.games;
  let turnSum = 0;
  let attackSum = 0;
  let hpSum = 0;
  const base = opts.seed ?? 1 + Math.floor(Math.random() * 1_000_000_000);
  for (let i = 0; i < opts.games; i++) {
    const game = playAiGame(base + i * 97, opts.players, 280, !!opts.arcanaConcealment, opts.controllers);
    const keepThis = report.replays.length < keep;
    if (!keepThis) {
      game.log = [];
    }
    absorb(report, game, keepThis);
    if (!game.timedOut) turnSum += game.turns;
    attackSum += game.attacks;
    hpSum += game.hpDealt;
  }
  report.avgTurns = report.finished ? turnSum / report.finished : 0;
  finalize(report, attackSum, hpSum);
  report.avgTurns = report.finished ? turnSum / report.finished : 0;
  return report;
}

export async function runSimulationAsync(
  opts: {
    players: 2 | 4;
    games: number;
    seed?: number;
    keepReplays?: number;
    arcanaConcealment?: boolean;
    controllers?: SeatController[];
  },
  onProgress?: (done: number, total: number) => void,
): Promise<SimReport> {
  const report = emptyReport(opts.players);
  report.seatControllers = (opts.controllers ?? []).slice(0, opts.players);
  if (report.seatControllers.some((c) => c === "nn")) hydrateLearner();
  const keep = opts.keepReplays ?? 12;
  let turnSum = 0;
  let attackSum = 0;
  let hpSum = 0;
  const base = opts.seed ?? 1 + Math.floor(Math.random() * 1_000_000_000);
  for (let i = 0; i < opts.games; i++) {
    const game = playAiGame(base + i * 97, opts.players, 280, !!opts.arcanaConcealment, opts.controllers);
    const keepThis = report.replays.length < keep;
    if (!keepThis) game.log = [];
    absorb(report, game, keepThis);
    if (!game.timedOut) turnSum += game.turns;
    attackSum += game.attacks;
    hpSum += game.hpDealt;
    onProgress?.(i + 1, opts.games);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  finalize(report, attackSum, hpSum);
  report.avgTurns = report.finished ? turnSum / report.finished : 0;
  return report;
}

export function replayGame(seed: number, players: 2 | 4): GameReplay {
  return playAiGame(seed, players);
}

export interface DuelResult {
  a: string;
  b: string;
  seed: number;
  /** True when pathway `a` took the first turn. */
  aFirst: boolean;
  winner: "a" | "b" | null;
  reason: "hp" | "sanity" | "ascension" | "timeout";
  turns: number;
  seqA: number;
  seqB: number;
}

/** Fresh seeds for one round robin. Each seed is still played from both seats. */
export function drawSeeds(count: number): number[] {
  const seeds: number[] = [];
  while (seeds.length < count) {
    const next = 1 + Math.floor(Math.random() * 1_000_000_000);
    if (!seeds.includes(next)) seeds.push(next);
  }
  return seeds;
}

export interface PlayedDuel {
  duel: DuelResult;
  replay: GameReplay;
}

/** One duel. Pathways are fixed; the seed only shuffles the deck. */
export function playDuel(
  a: string,
  b: string,
  seed: number,
  aFirst: boolean,
  controllers?: { a: SeatController; b: SeatController },
): PlayedDuel {
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  const state: GameState = createGame({
    humanPathwayId: first,
    aiPathwayIds: [second],
    seed,
    humanName: "Seat A",
    arcanaConcealment: false,
  });
  state.simQuiet = true;
  state.simPlays = [];
  for (const p of state.players) p.isHuman = false;
  const kinds: SeatController[] = aFirst
    ? [controllers?.a ?? "ai", controllers?.b ?? "ai"]
    : [controllers?.b ?? "ai", controllers?.a ?? "ai"];
  const trails = new Map<string, Trail>();

  let guard = 0;
  while ((state.phase as string) !== "gameover" && guard < 280) {
    const before = state.turnNumber;
    const idx = state.players.findIndex((p) => p.id === currentPlayer(state).id);
    if (kinds[idx] === "nn") runNetworkTurn(state);
    else runAiTurn(state);
    if (state.turnNumber === before && (state.phase as string) !== "gameover") {
      endTurn(state, getRng(state));
    }
    noteTrail(state, trails);
    guard += 1;
  }

  const seatA = aFirst ? state.players[0]! : state.players[1]!;
  const seatB = aFirst ? state.players[1]! : state.players[0]!;
  const winnerP = state.players.find((p) => p.id === state.winnerId);
  let winner: "a" | "b" | null = null;
  if (winnerP) winner = winnerP.id === seatA.id ? "a" : "b";
  const reason: DuelResult["reason"] =
    (state.phase as string) !== "gameover"
      ? "timeout"
      : state.winReason === "madness"
        ? "sanity"
        : state.winReason === "apotheosis"
          ? "ascension"
          : state.winReason === "lastStanding"
            ? "hp"
            : "timeout";
  return {
    duel: {
      a,
      b,
      seed,
      aFirst,
      winner,
      reason,
      turns: state.turnNumber,
      seqA: seatA.sequence,
      seqB: seatB.sequence,
    },
    replay: replayFrom(state, trails, seed, 2, kinds),
  };
}

function timeoutReplay(a: string, b: string, seed: number): GameReplay {
  const name = (id: string) => PATHWAYS.find((p) => p.id === id)?.name ?? id;
  const seat = (id: string): SeatFinish => ({
    pathwayId: id,
    sequence: 9,
    alive: true,
    hp: 20,
    sanity: 20,
    sanityBroken: false,
    charmIds: [],
  });
  return {
    seed,
    players: 2,
    pathways: [
      { name: name(a), pathwayId: a },
      { name: name(b), pathwayId: b },
    ],
    turns: 0,
    timedOut: true,
    winReason: "timeout",
    winnerPathway: "",
    winnerName: "",
    lowerSeqWin: false,
    seqLeadWin: false,
    seqTie: false,
    hpComeback: false,
    healedComeback: false,
    seqComeback: false,
    attacks: 0,
    hpDealt: 0,
    ascensions: 0,
    abilities: 0,
    sanityDealt: 0,
    unarmed: 0,
    steps: 0,
    sequences: [seat(a), seat(b)],
    plays: [],
    log: [{ text: "The duel stopped before a result.", tone: "system" }],
  };
}

export interface RoundRobinResult {
  duels: DuelResult[];
  report: SimReport;
  seeds: number[];
}

/**
 * Every pathway against every pathway, including itself.
 * `perSide` is 1–10. Each seed is played twice, once with each seat going first.
 * 253 pairings × perSide × 2 duels. The report feeds Overview, Arcana, Items, and Cards.
 */
export async function runRoundRobin(
  perSide = 5,
  onProgress?: (done: number, total: number) => void,
  controllers?: { a: SeatController; b: SeatController },
): Promise<RoundRobinResult> {
  const gamesEachSide = Math.min(10, Math.max(1, Math.floor(perSide) || 1));
  const seeds = drawSeeds(gamesEachSide);
  const ids = PATHWAYS.map((p) => p.id);
  const pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i; j < ids.length; j++) pairs.push([ids[i]!, ids[j]!]);
  }
  const total = pairs.length * seeds.length * 2;
  const duels: DuelResult[] = [];
  const report = emptyReport(2);
  report.seatControllers = [controllers?.a ?? "ai", controllers?.b ?? "ai"];
  if (report.seatControllers.some((c) => c === "nn")) hydrateLearner();
  let turnSum = 0;
  let attackSum = 0;
  let hpSum = 0;
  let done = 0;
  for (const [a, b] of pairs) {
    for (const seed of seeds) {
      for (const aFirst of [true, false]) {
        let replay: GameReplay;
        try {
          const played = playDuel(a, b, seed, aFirst, controllers);
          duels.push(played.duel);
          replay = played.replay;
        } catch {
          duels.push({
            a,
            b,
            seed,
            aFirst,
            winner: null,
            reason: "timeout",
            turns: 0,
            seqA: 9,
            seqB: 9,
          });
          replay = timeoutReplay(a, b, seed);
        }
        const keep = report.replays.length < 8;
        absorb(report, replay, keep);
        if (!replay.timedOut) turnSum += replay.turns;
        attackSum += replay.attacks;
        hpSum += replay.hpDealt;
        done += 1;
        onProgress?.(done, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  finalize(report, attackSum, hpSum);
  report.avgTurns = report.finished ? turnSum / report.finished : 0;
  return { duels, report, seeds };
}
