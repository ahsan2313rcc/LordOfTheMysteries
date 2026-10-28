/**
 * Simulate full 4-player games and report economy / length metrics.
 * Run: npx tsx scripts/sim-four-player.ts
 */
import { runAiTurn } from "../src/game/ai";
import { matchRecipe } from "../src/game/ascension";
import {
  createGame,
  currentPlayer,
  endTurn,
  getRng,
} from "../src/game/engine";
import { PATHWAYS } from "../src/game/pathways";
import type { GameState } from "../src/game/types";

type Metrics = {
  seed: number;
  turns: number;
  actions: number;
  winReason: string;
  winnerPathway: string;
  winnerSeq: number;
  ascensions: number;
  eliminations: number;
  actingLocks: number;
  ascendAttemptsFail: number;
  recipeBlocked: number;
  sanityBlocked: number;
  avgSpEnd: number;
  avgSeqEnd: number;
  maxSeqReached: number;
  timedOut: boolean;
  pathways: string[];
};

function pickPathways(seed: number, n: number): string[] {
  const shuffled = [...PATHWAYS].sort(
    (a, b) => ((seed * 17 + a.id.length * 3) % 97) - ((seed * 13 + b.id.length * 5) % 97),
  );
  // deterministic shuffle
  const arr = [...PATHWAYS];
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, n).map((p) => p.id);
}

/** Snapshot blockers, then run the same AI the live game uses. */
function playTurn(state: GameState, m: Metrics) {
  if (state.phase !== "action" || !currentPlayer(state).alive) {
    if (state.phase === "action") endTurn(state, getRng(state));
    return;
  }

  const p = currentPlayer(state);
  const beforeSeq = Object.fromEntries(state.players.map((pl) => [pl.id, pl.sequence]));
  const beforeActing = Object.fromEntries(state.players.map((pl) => [pl.id, pl.actingMet]));
  const recipe = matchRecipe(p);
  m.actions += 1;
  if (p.actingMet && recipe) {
    if (recipe.remaining.length) m.recipeBlocked += 1;
    else if (p.sanity < recipe.toll) m.sanityBlocked += 1;
  }

  runAiTurn(state);

  for (const pl of state.players) {
    if (pl.sequence < (beforeSeq[pl.id] ?? pl.sequence)) m.ascensions += 1;
    if (!beforeActing[pl.id] && pl.actingMet) m.actingLocks += 1;
  }

  if (state.phase === "action" && currentPlayer(state).alive) {
    endTurn(state, getRng(state));
  }
}

function simulate(seed: number, maxTurns = 400): Metrics {
  const paths = pickPathways(seed, 4);
  const state = createGame({
    humanPathwayId: paths[0]!,
    aiPathwayIds: paths.slice(1),
    seed,
    humanName: "P1",
  });
  // All auto
  for (const p of state.players) p.isHuman = false;

  const m: Metrics = {
    seed,
    turns: 0,
    actions: 0,
    winReason: "none",
    winnerPathway: "",
    winnerSeq: 9,
    ascensions: 0,
    eliminations: 0,
    actingLocks: 0,
    ascendAttemptsFail: 0,
    recipeBlocked: 0,
    sanityBlocked: 0,
    avgSpEnd: 0,
    avgSeqEnd: 0,
    maxSeqReached: 9,
    timedOut: false,
    pathways: paths,
  };

  let lastAlive = 4;
  let guardTurns = 0;
  while (state.phase !== "gameover" && guardTurns < maxTurns) {
    const beforeTurn = state.turnNumber;
    playTurn(state, m);
    if (state.turnNumber !== beforeTurn) {
      m.turns = state.turnNumber;
      guardTurns += 1;
    } else {
      // stuck?
      endTurn(state, getRng(state));
      guardTurns += 1;
    }
    const alive = state.players.filter((p) => p.alive).length;
    if (alive < lastAlive) {
      m.eliminations += lastAlive - alive;
      lastAlive = alive;
    }
    for (const p of state.players) {
      m.maxSeqReached = Math.min(m.maxSeqReached, p.sequence);
    }
  }

  if (state.phase !== "gameover") {
    m.timedOut = true;
    m.winReason = "timeout";
  } else {
    m.winReason = state.winReason ?? "unknown";
    const w = state.players.find((p) => p.id === state.winnerId);
    if (w) {
      m.winnerPathway = w.pathwayId;
      m.winnerSeq = w.sequence;
    }
  }

  const livingOrAll = state.players;
  m.avgSpEnd =
    livingOrAll.reduce((n, p) => n + p.sp, 0) / Math.max(1, livingOrAll.length);
  m.avgSeqEnd =
    livingOrAll.reduce((n, p) => n + p.sequence, 0) / Math.max(1, livingOrAll.length);

  return m;
}

function summarize(runs: Metrics[]) {
  const finished = runs.filter((r) => !r.timedOut);
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const byWin: Record<string, number> = {};
  for (const r of finished) byWin[r.winReason] = (byWin[r.winReason] ?? 0) + 1;

  return {
    games: runs.length,
    finished: finished.length,
    timeouts: runs.filter((r) => r.timedOut).length,
    avgTurnsFinished: avg(finished.map((r) => r.turns)),
    avgTurnsAll: avg(runs.map((r) => r.turns)),
    avgAscensions: avg(runs.map((r) => r.ascensions)),
    avgEliminations: avg(runs.map((r) => r.eliminations)),
    avgActingLocks: avg(runs.map((r) => r.actingLocks)),
    avgRecipeBlocked: avg(runs.map((r) => r.recipeBlocked)),
    avgSanityBlocked: avg(runs.map((r) => r.sanityBlocked)),
    avgAscendFails: avg(runs.map((r) => r.ascendAttemptsFail)),
    avgMaxSeqReached: avg(runs.map((r) => r.maxSeqReached)), // lower = further ascended
    avgSeqEnd: avg(runs.map((r) => r.avgSeqEnd)),
    avgSpEnd: avg(runs.map((r) => r.avgSpEnd)),
    winReasons: byWin,
    sample: runs.slice(0, 5),
  };
}

const N = Number(process.env.SIM_GAMES ?? 24);
const runs: Metrics[] = [];
for (let i = 0; i < N; i++) {
  const m = simulate(1000 + i * 97);
  runs.push(m);
  const tag = m.timedOut ? "TIMEOUT" : m.winReason;
  console.log(
    `#${i + 1} seed=${m.seed} turns=${m.turns} ${tag} asc=${m.ascensions} elim=${m.eliminations} recipeBlock=${m.recipeBlocked} paths=${m.pathways.join(",")}`,
  );
}

const summary = summarize(runs);
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));

// Write artifact for canvas
import { writeFileSync, mkdirSync } from "fs";
mkdirSync("/opt/cursor/artifacts", { recursive: true });
writeFileSync(
  "/opt/cursor/artifacts/sim-four-player.json",
  JSON.stringify({ summary, runs }, null, 2),
);
console.log("\nWrote /opt/cursor/artifacts/sim-four-player.json");
