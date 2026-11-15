import { runAiTurn } from "./ai";
import { CARD_DEFS } from "./cards";
import { createGame, endTurn, getRng } from "./engine";
import { PATHWAYS } from "./pathways";
import type { GameState } from "./types";

export interface SimPlay {
  defId: string;
  playerId: string;
  pathwayId: string;
  turn: number;
  damage: number;
  swing?: boolean;
}

export interface GameReplay {
  seed: number;
  players: number;
  pathways: { name: string; pathwayId: string }[];
  turns: number;
  timedOut: boolean;
  winReason: string;
  winnerPathway: string;
  winnerName: string;
  attacks: number;
  hpDealt: number;
  sequences: { pathwayId: string; sequence: number; alive: boolean }[];
  plays: SimPlay[];
  log: { text: string; tone?: string }[];
}

export interface CardStat {
  id: string;
  name: string;
  type: string;
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
}

export interface SimReport {
  players: number;
  games: number;
  finished: number;
  timeouts: number;
  avgTurns: number;
  avgAttacks: number;
  avgHpDealt: number;
  avgSequence: number;
  cards: CardStat[];
  pathways: PathwayStat[];
  replays: GameReplay[];
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

export function playAiGame(
  seed: number,
  players: 2 | 4,
  maxTurns = 280,
  arcanaConcealment = false,
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

  const ended = () => (state.phase as string) === "gameover";
  let guard = 0;
  while (!ended() && guard < maxTurns) {
    const before = state.turnNumber;
    runAiTurn(state);
    if (state.turnNumber === before && !ended()) {
      endTurn(state, getRng(state));
    }
    guard += 1;
  }

  const winner = state.players.find((p) => p.id === state.winnerId);
  const plays = state.simPlays ?? [];
  return {
    seed,
    players,
    pathways: state.players.map((p) => ({
      name: p.name,
      pathwayId: p.pathwayId,
    })),
    turns: state.turnNumber,
    timedOut: state.phase !== "gameover",
    winReason: state.winReason ?? (state.phase === "gameover" ? "unknown" : "timeout"),
    winnerPathway: winner?.pathwayId ?? "",
    winnerName: winner?.name ?? "",
    sequences: state.players.map((p) => ({
      pathwayId: p.pathwayId,
      sequence: p.sequence,
      alive: p.alive,
    })),
    plays,
    attacks: state.simAttacks ?? 0,
    hpDealt: state.simHpDealt ?? 0,
    log: state.log.slice(-220).map((e) => ({ text: e.text, tone: e.tone })),
  };
}

function emptyReport(players: number): SimReport {
  const cardMap = new Map<string, CardStat>();
  for (const c of CARD_DEFS) {
    cardMap.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.type,
      plays: 0,
      damage: 0,
      winPlays: 0,
      damagePerPlay: 0,
      winRateWhenPlayed: 0,
    });
  }
  return {
    players,
    games: 0,
    finished: 0,
    timeouts: 0,
    avgTurns: 0,
    avgAttacks: 0,
    avgHpDealt: 0,
    avgSequence: 9,
    cards: [...cardMap.values()],
    pathways: PATHWAYS.map((p) => ({
      id: p.id,
      name: p.name,
      games: 0,
      wins: 0,
      winRate: 0,
      avgSequence: 9,
      avgTurns: 0,
    })),
    replays: [],
  };
}

function absorb(report: SimReport, game: GameReplay, keepReplay: boolean) {
  report.games += 1;
  if (game.timedOut) report.timeouts += 1;
  else report.finished += 1;
  if (keepReplay) report.replays.push(game);

  const pathById = new Map(report.pathways.map((p) => [p.id, p]));
  for (const seat of game.sequences) {
    const row = pathById.get(seat.pathwayId);
    if (!row) continue;
    const games = row.games + 1;
    row.avgSequence = (row.avgSequence * row.games + seat.sequence) / games;
    row.avgTurns = (row.avgTurns * row.games + game.turns) / games;
    row.games = games;
    if (seat.pathwayId === game.winnerPathway) row.wins += 1;
    row.winRate = row.wins / row.games;
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
  for (const c of report.cards) {
    c.damagePerPlay = c.plays ? c.damage / c.plays : 0;
    c.winRateWhenPlayed = c.plays ? c.winPlays / c.plays : 0;
  }
  report.cards.sort((a, b) => b.plays - a.plays || b.damagePerPlay - a.damagePerPlay);
  report.pathways.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

export function runSimulation(opts: {
  players: 2 | 4;
  games: number;
  seed?: number;
  /** Chronicle replays kept for the viewer. Stats still cover every game. */
  keepReplays?: number;
  arcanaConcealment?: boolean;
}): SimReport {
  const report = emptyReport(opts.players);
  const keep = opts.keepReplays ?? opts.games;
  let turnSum = 0;
  let attackSum = 0;
  let hpSum = 0;
  const base = opts.seed ?? 4100;
  for (let i = 0; i < opts.games; i++) {
    const game = playAiGame(base + i * 97, opts.players, 280, !!opts.arcanaConcealment);
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
  },
  onProgress?: (done: number, total: number) => void,
): Promise<SimReport> {
  const report = emptyReport(opts.players);
  const keep = opts.keepReplays ?? 12;
  let turnSum = 0;
  let attackSum = 0;
  let hpSum = 0;
  const base = opts.seed ?? 4100;
  for (let i = 0; i < opts.games; i++) {
    const game = playAiGame(base + i * 97, opts.players, 280, !!opts.arcanaConcealment);
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
