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

export function playAiGame(seed: number, players: 2 | 4, maxTurns = 280): GameReplay {
  const ids = shuffleIds(seed);
  const state: GameState = createGame({
    humanPathwayId: ids[0]!,
    aiPathwayIds: ids.slice(1, players),
    seed,
    humanName: "Seat 1",
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
    log: state.log.slice(-220).map((e) => ({ text: e.text, tone: e.tone })),
  };
}

export function runSimulation(opts: {
  players: 2 | 4;
  games: number;
  seed?: number;
}): SimReport {
  const base = opts.seed ?? 4100;
  const replays: GameReplay[] = [];
  for (let i = 0; i < opts.games; i++) {
    replays.push(playAiGame(base + i * 97, opts.players));
  }

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

  const pathMap = new Map<string, { games: number; wins: number; seqSum: number; turnSum: number }>();
  for (const p of PATHWAYS) {
    pathMap.set(p.id, { games: 0, wins: 0, seqSum: 0, turnSum: 0 });
  }

  for (const g of replays) {
    const winner = g.winnerPathway;
    for (const seat of g.sequences) {
      const row = pathMap.get(seat.pathwayId);
      if (!row) continue;
      row.games += 1;
      row.seqSum += seat.sequence;
      row.turnSum += g.turns;
      if (seat.pathwayId === winner) row.wins += 1;
    }
    for (const play of g.plays) {
      const row = cardMap.get(play.defId);
      if (!row) continue;
      if (!play.swing) row.plays += 1;
      row.damage += play.damage;
      if (!play.swing && play.pathwayId === winner) row.winPlays += 1;
    }
  }

  const cards = [...cardMap.values()]
    .map((c) => ({
      ...c,
      damagePerPlay: c.plays ? c.damage / c.plays : 0,
      winRateWhenPlayed: c.plays ? c.winPlays / c.plays : 0,
    }))
    .sort((a, b) => b.plays - a.plays || b.damagePerPlay - a.damagePerPlay);

  const pathways = PATHWAYS.map((p) => {
    const row = pathMap.get(p.id)!;
    return {
      id: p.id,
      name: p.name,
      games: row.games,
      wins: row.wins,
      winRate: row.games ? row.wins / row.games : 0,
      avgSequence: row.games ? row.seqSum / row.games : 9,
      avgTurns: row.games ? row.turnSum / row.games : 0,
    };
  }).sort((a, b) => b.winRate - a.winRate || b.games - a.games);

  const finished = replays.filter((r) => !r.timedOut);
  const avgTurns = finished.length
    ? finished.reduce((n, r) => n + r.turns, 0) / finished.length
    : 0;

  return {
    players: opts.players,
    games: replays.length,
    finished: finished.length,
    timeouts: replays.length - finished.length,
    avgTurns,
    cards,
    pathways,
    replays,
  };
}

export function replayGame(seed: number, players: 2 | 4): GameReplay {
  return playAiGame(seed, players);
}
