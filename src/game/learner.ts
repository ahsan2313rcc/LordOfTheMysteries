import { choiceValue, legalChoices, type LegalChoice } from "./ai";
import { getCardDef } from "./cards";
import { createGame, currentPlayer, endTurn, getRng } from "./engine";
import { PATHWAYS } from "./pathways";
import type { GameState, PlayerState } from "./types";

/**
 * A small network that scores a position plus a candidate action.
 * It learns by imitating the search AI, and by playing games itself.
 * Weights live in this module and in the browser's local storage.
 */

const SELF = 14;
const HAND = 7 * 8;
const OPPS = 3 * 8;
const GLOBAL = 4;
const PATHS = 22;
const STATE = SELF + HAND + OPPS + GLOBAL + PATHS + PATHS;
const ACTION = 18;
export const INPUTS = STATE + ACTION;
const H1 = 48;
const H2 = 24;
const STORE_KEY = "lotm-learner-v1";

const KINDS = ["draw", "ascend", "cast", "attack", "play", "trap", "artifact", "other"] as const;
const TYPES = ["weapon", "spell", "utility", "charm", "trap", "artifact"] as const;

export type SeatController = "nn" | "ai";

export interface LearnerModel {
  version: 1;
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  w3: number[];
  b3: number[];
  watched: number;
  played: number;
  wins: number;
  losses: number;
  /** Matches with one neural-network seat and one search-AI seat. */
  headToHead: number;
  nnWins: number;
  aiWins: number;
}

let model: LearnerModel = freshModel(7);

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function freshModel(seed: number): LearnerModel {
  const rand = mulberry(seed);
  const fill = (n: number, scale: number) => Array.from({ length: n }, () => (rand() * 2 - 1) * scale);
  return {
    version: 1,
    w1: fill(INPUTS * H1, Math.sqrt(2 / INPUTS)),
    b1: fill(H1, 0.01),
    w2: fill(H1 * H2, Math.sqrt(2 / H1)),
    b2: fill(H2, 0.01),
    w3: fill(H2, Math.sqrt(2 / H2)),
    b3: [0],
    watched: 0,
    played: 0,
    wins: 0,
    losses: 0,
    headToHead: 0,
    nnWins: 0,
    aiWins: 0,
  };
}

function withCounters(parsed: LearnerModel): LearnerModel {
  parsed.headToHead ??= 0;
  parsed.nnWins ??= 0;
  parsed.aiWins ??= 0;
  parsed.watched ??= 0;
  parsed.played ??= 0;
  parsed.wins ??= 0;
  parsed.losses ??= 0;
  return parsed;
}

export function learnerStats() {
  const draws = Math.max(0, model.headToHead - model.nnWins - model.aiWins);
  const decided = model.nnWins + model.aiWins;
  return {
    watched: model.watched,
    played: model.played,
    wins: model.wins,
    losses: model.losses,
    headToHead: model.headToHead,
    nnWins: model.nnWins,
    aiWins: model.aiWins,
    draws,
    nnWinRate: decided ? model.nnWins / decided : 0,
  };
}

export function learnerJson(): string {
  return JSON.stringify(model);
}

export function eraseLearner() {
  model = freshModel(Date.now() % 100000);
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORE_KEY);
}

export function saveLearnerLocal(): boolean {
  if (typeof localStorage === "undefined") return false;
  localStorage.setItem(STORE_KEY, learnerJson());
  return true;
}

export function loadLearnerLocal(): boolean {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as LearnerModel;
    if (parsed.version !== 1 || parsed.w1.length !== INPUTS * H1) return false;
    model = withCounters(parsed);
    return true;
  } catch {
    return false;
  }
}

export function importLearner(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as LearnerModel;
    if (parsed.version !== 1 || parsed.w1.length !== INPUTS * H1) return false;
    model = withCounters(parsed);
    saveLearnerLocal();
    return true;
  } catch {
    return false;
  }
}

function tanh(x: number) {
  const e = Math.exp(Math.max(-8, Math.min(8, 2 * x)));
  return (e - 1) / (e + 1);
}

function forward(input: number[]) {
  const h1 = new Array<number>(H1);
  const z1 = new Array<number>(H1);
  for (let j = 0; j < H1; j++) {
    let s = model.b1[j]!;
    const base = j * INPUTS;
    for (let i = 0; i < INPUTS; i++) s += model.w1[base + i]! * input[i]!;
    z1[j] = s;
    h1[j] = tanh(s);
  }
  const h2 = new Array<number>(H2);
  const z2 = new Array<number>(H2);
  for (let j = 0; j < H2; j++) {
    let s = model.b2[j]!;
    const base = j * H1;
    for (let i = 0; i < H1; i++) s += model.w2[base + i]! * h1[i]!;
    z2[j] = s;
    h2[j] = tanh(s);
  }
  let y = model.b3[0]!;
  for (let i = 0; i < H2; i++) y += model.w3[i]! * h2[i]!;
  return { y, h1, h2 };
}

function learn(input: number[], target: number, rate = 0.02) {
  const { y, h1, h2 } = forward(input);
  const dy = y - target;
  for (let i = 0; i < H2; i++) {
    const g = dy * h2[i]!;
    model.w3[i] = (model.w3[i] ?? 0) - rate * g;
  }
  model.b3[0] = (model.b3[0] ?? 0) - rate * dy;
  const dh2 = new Array<number>(H2).fill(0);
  for (let i = 0; i < H2; i++) dh2[i] = dy * model.w3[i]! * (1 - h2[i]! * h2[i]!);
  const dh1 = new Array<number>(H1).fill(0);
  for (let j = 0; j < H2; j++) {
    const base = j * H1;
    for (let i = 0; i < H1; i++) {
      model.w2[base + i] = (model.w2[base + i] ?? 0) - rate * dh2[j]! * h1[i]!;
      dh1[i] = (dh1[i] ?? 0) + dh2[j]! * model.w2[base + i]!;
    }
    model.b2[j] = (model.b2[j] ?? 0) - rate * dh2[j]!;
  }
  for (let j = 0; j < H1; j++) {
    const grad = dh1[j]! * (1 - h1[j]! * h1[j]!);
    const base = j * INPUTS;
    for (let i = 0; i < INPUTS; i++) {
      model.w1[base + i] = (model.w1[base + i] ?? 0) - rate * grad * input[i]!;
    }
    model.b1[j] = (model.b1[j] ?? 0) - rate * grad;
  }
}

function pathwayIndex(id: string): number {
  const i = PATHWAYS.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
}

function pushPathway(out: number[], id: string | undefined, known: boolean) {
  for (let i = 0; i < PATHS; i++) out.push(known && id && pathwayIndex(id) === i ? 1 : 0);
}

function seatKnown(state: GameState, seat: PlayerState, viewer: PlayerState): boolean {
  if (seat.id === viewer.id) return true;
  if (!state.arcanaConcealment) return true;
  return !!seat.revealed;
}

/** Public position, from one seat's point of view. Hidden hands stay hidden. */
export function positionVector(state: GameState, seatId: string): number[] {
  const me = state.players.find((p) => p.id === seatId)!;
  const out: number[] = [];
  const weapon = me.weapon ? getCardDef(me.weapon.defId) : undefined;
  out.push(
    me.hp / 20,
    me.sanity / 20,
    me.sp / 20,
    me.sequence / 9,
    me.hand.length / 7,
    Math.min(me.status.block, 8) / 8,
    Math.min(me.status.evade, 3) / 3,
    Math.min(Math.max(me.status.attackModifier, 0), 6) / 6,
    me.weapon ? 1 : 0,
    (weapon?.weapon?.attack ?? 0) / 4,
    me.charms.length / 2,
    me.artifact ? 1 : 0,
    me.trap ? 1 : 0,
    me.revealed ? 1 : 0,
  );
  for (let i = 0; i < 7; i++) {
    const card = me.hand[i];
    if (!card) {
      out.push(0, 0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    const d = getCardDef(card.defId);
    out.push(
      1,
      d.spCost / 6,
      d.rarity === "rare" ? 1 : 0,
      d.type === "weapon" ? 1 : 0,
      d.type === "spell" ? 1 : 0,
      d.type === "utility" ? 1 : 0,
      d.type === "charm" ? 1 : 0,
      (d.weapon?.attack ?? 0) / 4,
    );
  }
  const opps = state.players.filter((p) => p.id !== me.id);
  for (let i = 0; i < 3; i++) {
    const o = opps[i];
    if (!o) {
      out.push(0, 0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    const known = seatKnown(state, o, me);
    const board = (o.charms.length > 0 ? 1 : 0) + (o.artifact ? 1 : 0) + (o.trap ? 1 : 0);
    out.push(
      o.hp / 20,
      o.sanity / 20,
      known ? o.sp / 20 : 0,
      known ? o.sequence / 9 : 0,
      o.hand.length / 7,
      o.revealed || !state.arcanaConcealment ? 1 : 0,
      known && o.weapon ? (getCardDef(o.weapon.defId).weapon?.attack ?? 0) / 4 : 0,
      known ? board / 3 : o.trap ? 0.2 : 0,
    );
  }
  out.push(
    state.deck.length / 78,
    state.discard.length / 78,
    Math.min(state.turnNumber, 80) / 80,
    state.arcanaConcealment ? 1 : 0,
  );
  pushPathway(out, me.pathwayId, true);
  const opp = opps[0];
  pushPathway(out, opp?.pathwayId, opp ? seatKnown(state, opp, me) : false);
  return out;
}

function actionVector(state: GameState, seatId: string, label: string): number[] {
  const me = state.players.find((p) => p.id === seatId)!;
  const kind = label.split(":")[0] ?? "other";
  const mapped = KINDS.includes(kind as (typeof KINDS)[number]) ? kind : kind === "wish" || kind === "contend" || kind === "requiem" ? "other" : "other";
  const one = KINDS.map((k) => (k === mapped ? 1 : 0));
  let cost = 0;
  let rare = 0;
  const types = TYPES.map(() => 0);
  let atk = 0;
  let self = 0;
  if (label.startsWith("play:") || label.startsWith("trap:")) {
    const id = label.split(":")[1];
    const card = me.hand.find((c) => c.instanceId === id);
    if (card) {
      const d = getCardDef(card.defId);
      cost = d.spCost / 6;
      rare = d.rarity === "rare" ? 1 : 0;
      const ti = TYPES.indexOf(d.type as (typeof TYPES)[number]);
      if (ti >= 0) types[ti] = 1;
      atk = (d.weapon?.attack ?? 0) / 4;
    }
    const target = label.split(":")[2];
    self = target === seatId ? 1 : 0;
  }
  if (label.startsWith("cast:") || label.startsWith("attack:")) {
    self = label.endsWith(seatId) || label.endsWith(":self") ? 1 : 0;
  }
  return [...one, cost, rare, ...types, atk, self];
}

function pack(state: GameState, seatId: string, label: string): number[] {
  const input = positionVector(state, seatId).concat(actionVector(state, seatId, label));
  if (input.length !== INPUTS) {
    throw new Error(`learner input ${input.length} !== ${INPUTS}`);
  }
  return input;
}

function trainPair(state: GameState, seatId: string, better: string, worse: string) {
  if (better === worse) return;
  const a = pack(state, seatId, better);
  const b = pack(state, seatId, worse);
  const sa = forward(a).y;
  const sb = forward(b).y;
  if (sa < sb + 0.35) {
    learn(a, Math.min(1.2, sa + 0.35));
    learn(b, Math.max(-1.2, sb - 0.35));
  }
}

function pickLearner(state: GameState, choices: LegalChoice[], explore: number): LegalChoice {
  const seat = currentPlayer(state).id;
  if (Math.random() < explore) return choices[Math.floor(Math.random() * choices.length)]!;
  let best = choices[0]!;
  let bestY = -Infinity;
  for (const choice of choices) {
    const y = forward(pack(state, seat, choice.label)).y;
    if (y > bestY) {
      bestY = y;
      best = choice;
    }
  }
  return best;
}

function shufflePathways(seed: number): string[] {
  const ids = PATHWAYS.map((p) => p.id);
  const rand = mulberry(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

function openDuel(seed: number): GameState {
  const ids = shufflePathways(seed);
  const state = createGame({
    humanPathwayId: ids[0]!,
    aiPathwayIds: [ids[1]!],
    seed,
    humanName: "Seat A",
    arcanaConcealment: false,
  });
  state.simQuiet = true;
  state.simPlays = [];
  for (const p of state.players) p.isHuman = false;
  return state;
}

async function stepYield() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function searchChoice(state: GameState, choices: LegalChoice[]): LegalChoice {
  let best = choices[0]!;
  let bestV = -Infinity;
  for (const choice of choices) {
    const value = choiceValue(state, choice.apply) ?? -99999;
    if (value > bestV) {
      bestV = value;
      best = choice;
    }
  }
  return best;
}

function noteHeadToHead(state: GameState, kinds: [SeatController, SeatController]) {
  if (kinds[0] === kinds[1]) return;
  model.headToHead += 1;
  const winner = state.players.findIndex((p) => p.id === state.winnerId);
  if (winner < 0) return;
  if (kinds[winner] === "nn") model.nnWins += 1;
  else model.aiWins += 1;
}

/**
 * One match. Each seat is the neural network or the search AI.
 * The two seats swap who goes first every game.
 * A match of two search AIs is watched and imitated.
 * Any network seat learns from whether that seat won.
 * NN-versus-AI results are stored on the model.
 */
export async function runTrainerMatch(
  games: number,
  seatA: SeatController,
  seatB: SeatController,
  onProgress?: (done: number, total: number) => void,
) {
  const total = Math.max(1, Math.min(1024, Math.floor(games)));
  for (let g = 0; g < total; g++) {
    const state = openDuel(5000 + (model.watched + model.played) * 17 + g * 13);
    const kinds: [SeatController, SeatController] = g % 2 === 0 ? [seatA, seatB] : [seatB, seatA];
    const byId = new Map<string, SeatController>();
    state.players.forEach((p, i) => byId.set(p.id, kinds[i]!));
    const taken = new Map<string, number[][]>();
    const bothAi = seatA === "ai" && seatB === "ai";
    let guard = 0;
    while ((state.phase as string) !== "gameover" && guard < 240) {
      const seat = currentPlayer(state);
      const choices = legalChoices(state);
      if (!choices.length) {
        endTurn(state, getRng(state));
        guard += 1;
        continue;
      }
      const kind = byId.get(seat.id) ?? "ai";
      if (kind === "nn") {
        const choice = pickLearner(state, choices, 0.12);
        const rows = taken.get(seat.id) ?? [];
        rows.push(pack(state, seat.id, choice.label));
        taken.set(seat.id, rows);
        if (!choice.apply(state)) endTurn(state, getRng(state));
      } else if (bothAi) {
        let best = choices[0]!;
        let bestV = -Infinity;
        const scored: { choice: LegalChoice; value: number }[] = [];
        for (const choice of choices) {
          const value = choiceValue(state, choice.apply) ?? -99999;
          scored.push({ choice, value });
          if (value > bestV) {
            bestV = value;
            best = choice;
          }
        }
        const worse = scored.find((row) => row.choice !== best)?.choice ?? best;
        trainPair(state, seat.id, best.label, worse.label);
        if (!best.apply(state)) endTurn(state, getRng(state));
      } else {
        const best = searchChoice(state, choices);
        if (!best.apply(state)) endTurn(state, getRng(state));
      }
      guard += 1;
    }
    noteHeadToHead(state, kinds);
    if (bothAi) model.watched += 1;
    else {
      const winner = state.winnerId;
      for (const [seatId, rows] of taken) {
        const won = !!winner && winner === seatId;
        if (won) model.wins += 1;
        else model.losses += 1;
        for (const row of rows) learn(row, won ? 1 : 0, 0.015);
      }
      model.played += 1;
    }
    onProgress?.(g + 1, total);
    if ((g + 1) % 8 === 0) saveLearnerLocal();
    await stepYield();
  }
  saveLearnerLocal();
}
