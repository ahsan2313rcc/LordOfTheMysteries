import { choiceValue, legalChoices, type LegalChoice } from "./ai";
import { CARD_DEFS, getCardDef } from "./cards";
import { createGame, currentPlayer, endTurn, getRng } from "./engine";
import { matchRecipe } from "./ascension";
import { PATHWAYS, getSequence } from "./pathways";
import type { CardInstance, GameState, PlayerState } from "./types";

/**
 * A small network that scores a position: how likely this seat is to win from here.
 * To choose a move it tries each legal action under the real rules and keeps the one
 * that leaves the better position. It learns from who actually won.
 * Weights live in this module and in the browser's local storage.
 */

const CARD_IDS = CARD_DEFS.map((c) => c.id);
const ABILITY_IDS = [...new Set(PATHWAYS.flatMap((p) => p.sequences.map((s) => s.abilityId)))].sort();
const PATHS = PATHWAYS.length;
const HAND_SLOTS = 7;
const SLOT = 4 + CARD_IDS.length;
const GEAR_SLOTS = 5;
const SELF = 18 + HAND_SLOTS * SLOT + GEAR_SLOTS * CARD_IDS.length + ABILITY_IDS.length;
const MAIN_OPP = 6 + GEAR_SLOTS * CARD_IDS.length + ABILITY_IDS.length;
const EXTRA_OPPS = 2 * 8;
const GLOBAL = 4;
export const INPUTS = SELF + MAIN_OPP + EXTRA_OPPS + GLOBAL + PATHS + PATHS;
const H1 = 32;
const H2 = 16;
const STORE_KEY = "lotm-learner-v2";

export type SeatController = "nn" | "ai";

export interface LearnerModel {
  version: 2;
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
  /** Newest mixed-game results, capped, so the current policy is visible. */
  recent: ("nn" | "ai" | "draw")[];
}

let model: LearnerModel = freshModel(7);
/** True after this page has loaded the saved network, or decided there isn't one. */
let hydrated = false;
/** True after this page has changed the weights. A later load must not replace them. */
let dirty = false;

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
    version: 2,
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
    recent: [],
  };
}

function withCounters(parsed: LearnerModel): LearnerModel {
  parsed.headToHead ??= 0;
  parsed.nnWins ??= 0;
  parsed.aiWins ??= 0;
  parsed.recent ??= [];
  parsed.watched ??= 0;
  parsed.played ??= 0;
  parsed.wins ??= 0;
  parsed.losses ??= 0;
  return parsed;
}

export function learnerStats() {
  const draws = Math.max(0, model.headToHead - model.nnWins - model.aiWins);
  const decided = model.nnWins + model.aiWins;
  const recent = model.recent ?? [];
  const recentNn = recent.filter((r) => r === "nn").length;
  const recentAi = recent.filter((r) => r === "ai").length;
  const recentDecided = recentNn + recentAi;
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
    recentGames: recent.length,
    recentNn,
    recentAi,
    recentDraws: recent.length - recentDecided,
    recentNnWinRate: recentDecided ? recentNn / recentDecided : 0,
  };
}

export function learnerJson(): string {
  return JSON.stringify(model);
}

export function eraseLearner() {
  model = freshModel(Date.now() % 100000);
  dirty = false;
  hydrated = true;
  buffer.length = 0;
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORE_KEY);
}

export function saveLearnerLocal(): boolean {
  if (typeof localStorage === "undefined") return false;
  localStorage.setItem(STORE_KEY, learnerJson());
  return true;
}

function loadFromStorage(): boolean {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as LearnerModel;
    if (parsed.version !== 2 || parsed.w1.length !== INPUTS * H1) return false;
    model = withCounters(parsed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bring in the network stored in this browser.
 * Refuses once this page has already trained, so a reload cannot throw away newer weights.
 */
export function loadLearnerLocal(): boolean {
  if (dirty) return false;
  hydrated = true;
  return loadFromStorage();
}

/** Load the saved network once per page. Later calls keep whatever this page has learned. */
export function hydrateLearner() {
  if (dirty || hydrated) return;
  hydrated = true;
  loadFromStorage();
}

export function importLearner(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as LearnerModel;
    if (parsed.version !== 2 || parsed.w1.length !== INPUTS * H1) return false;
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
  const active: number[] = [];
  for (let i = 0; i < input.length; i++) if (input[i]) active.push(i);
  for (let j = 0; j < H1; j++) {
    let s = model.b1[j]!;
    const base = j * INPUTS;
    for (const i of active) s += model.w1[base + i]! * input[i]!;
    h1[j] = tanh(s);
  }
  const h2 = new Array<number>(H2);
  for (let j = 0; j < H2; j++) {
    let s = model.b2[j]!;
    const base = j * H1;
    for (let i = 0; i < H1; i++) s += model.w2[base + i]! * h1[i]!;
    h2[j] = tanh(s);
  }
  let y = model.b3[0]!;
  for (let i = 0; i < H2; i++) y += model.w3[i]! * h2[i]!;
  return { y, h1, h2 };
}

function sigmoid(y: number): number {
  if (y >= 8) return 1;
  if (y <= -8) return 0;
  return 1 / (1 + Math.exp(-y));
}

function learnValue(input: number[], target: number, rate = 0.006) {
  dirty = true;
  const { y, h1, h2 } = forward(input);
  const dy = sigmoid(y) - target;
  const oldW3 = model.w3.slice();
  for (let i = 0; i < H2; i++) {
    model.w3[i] = (oldW3[i] ?? 0) - rate * dy * h2[i]!;
  }
  model.b3[0] = (model.b3[0] ?? 0) - rate * dy;
  const dh2 = new Array<number>(H2).fill(0);
  for (let i = 0; i < H2; i++) dh2[i] = dy * oldW3[i]! * (1 - h2[i]! * h2[i]!);
  const dh1 = new Array<number>(H1).fill(0);
  for (let j = 0; j < H2; j++) {
    const base = j * H1;
    for (let i = 0; i < H1; i++) {
      dh1[i] = (dh1[i] ?? 0) + dh2[j]! * model.w2[base + i]!;
      model.w2[base + i] = (model.w2[base + i] ?? 0) - rate * dh2[j]! * h1[i]!;
    }
    model.b2[j] = (model.b2[j] ?? 0) - rate * dh2[j]!;
  }
  const active: number[] = [];
  for (let i = 0; i < input.length; i++) if (input[i]) active.push(i);
  for (let j = 0; j < H1; j++) {
    const grad = dh1[j]! * (1 - h1[j]! * h1[j]!);
    const base = j * INPUTS;
    for (const i of active) {
      model.w1[base + i] = (model.w1[base + i] ?? 0) - rate * grad * input[i]!;
    }
    model.b1[j] = (model.b1[j] ?? 0) - rate * grad;
  }
}

function pathwayIndex(id: string): number {
  const i = PATHWAYS.findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
}

function pushHot(out: number[], ids: readonly string[], id: string | undefined) {
  for (let i = 0; i < ids.length; i++) out.push(id !== undefined && ids[i] === id ? 1 : 0);
}

function pushHand(out: number[], card: CardInstance | undefined) {
  if (!card) {
    out.push(0, 0, 0, 0);
    pushHot(out, CARD_IDS, undefined);
    return;
  }
  const d = getCardDef(card.defId);
  out.push(1, d.spCost / 6, d.rarity === "rare" ? 1 : 0, (d.weapon?.attack ?? 0) / 4);
  pushHot(out, CARD_IDS, card.defId);
}

function pushGear(out: number[], card: CardInstance | undefined, known: boolean) {
  pushHot(out, CARD_IDS, known ? card?.defId : undefined);
}

function abilityOf(seat: PlayerState): string {
  return getSequence(seat.pathwayId, seat.sequence).abilityId;
}

function recipeProgress(seat: PlayerState): number {
  const recipe = matchRecipe(seat);
  if (!recipe || recipe.needed.length === 0) return 0;
  return (recipe.needed.length - recipe.remaining.length) / recipe.needed.length;
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
    currentPlayer(state).id === me.id ? 1 : 0,
    me.actingMet ? 1 : 0,
    matchRecipe(me)?.canPay ? 1 : 0,
    recipeProgress(me),
  );
  for (let i = 0; i < HAND_SLOTS; i++) pushHand(out, me.hand[i]);
  pushGear(out, me.weapon, true);
  pushGear(out, me.artifact, true);
  pushGear(out, me.trap, true);
  pushGear(out, me.charms[0], true);
  pushGear(out, me.charms[1], true);
  pushHot(out, ABILITY_IDS, abilityOf(me));

  const opps = state.players.filter((p) => p.id !== me.id);
  const main = opps[0];
  if (!main) {
    out.push(0, 0, 0, 0, 0, 0);
    for (let g = 0; g < GEAR_SLOTS; g++) pushGear(out, undefined, false);
    pushHot(out, ABILITY_IDS, undefined);
  } else {
    const known = seatKnown(state, main, me);
    out.push(
      main.hp / 20,
      main.sanity / 20,
      known ? main.sp / 20 : 0,
      known ? main.sequence / 9 : 0,
      main.hand.length / 7,
      known && main.weapon ? (getCardDef(main.weapon.defId).weapon?.attack ?? 0) / 4 : 0,
    );
    pushGear(out, main.weapon, known);
    pushGear(out, main.artifact, known);
    pushGear(out, main.trap, known);
    pushGear(out, main.charms[0], known);
    pushGear(out, main.charms[1], known);
    pushHot(out, ABILITY_IDS, known ? abilityOf(main) : undefined);
  }
  for (let i = 1; i < 3; i++) {
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
  pushPathway(out, main?.pathwayId, main ? seatKnown(state, main, me) : false);
  if (out.length !== INPUTS) throw new Error(`learner input ${out.length} !== ${INPUTS}`);
  return out;
}

function quietClone(state: GameState): GameState {
  const log = state.log;
  const reveals = state.reveals;
  const plays = state.simPlays;
  state.log = [];
  state.reveals = [];
  if (state.simPlays) state.simPlays = [];
  const clone = structuredClone(state);
  state.log = log;
  state.reveals = reveals;
  state.simPlays = plays;
  return clone;
}

/** Win chance the network gives this seat after the action is actually played. */
function valueAfter(state: GameState, seatId: string, choice: LegalChoice): number | null {
  const clone = quietClone(state);
  if (!choice.apply(clone)) return null;
  return sigmoid(forward(positionVector(clone, seatId)).y);
}

/**
 * One action from the network. It tries every legal move with the real rules
 * and keeps the one that leaves the higher chance of winning. explore is only
 * for training; a finished game uses 0.
 */
export function playNetworkTurn(state: GameState, explore = 0): boolean {
  // A network that has never played or watched has no basis for a move.
  // It declines, which is why a fresh network loses to the search AI.
  if (model.played + model.watched === 0) return false;
  const choices = legalChoices(state);
  if (!choices.length) return false;
  const picked = pickByValue(state, choices, explore);
  if (!picked) return false;
  return picked.apply(state);
}

function pickByValue(state: GameState, choices: LegalChoice[], explore: number): LegalChoice | null {
  const seatId = currentPlayer(state).id;
  if (explore > 0 && Math.random() < explore) return choices[Math.floor(Math.random() * choices.length)]!;
  let best: LegalChoice | null = null;
  let bestY = -Infinity;
  for (const choice of choices) {
    const y = valueAfter(state, seatId, choice);
    if (y === null) continue;
    if (y > bestY) {
      bestY = y;
      best = choice;
    }
  }
  return best;
}

type Memory = { idx: number[]; val: number[]; target: number };
const buffer: Memory[] = [];
const BUFFER_CAP = 2500;

function remember(row: number[], target: number) {
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < row.length; i++) {
    if (!row[i]) continue;
    idx.push(i);
    val.push(row[i]!);
  }
  buffer.push({ idx, val, target });
  if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
}

function recall(sample: Memory): number[] {
  const out = new Array<number>(INPUTS).fill(0);
  for (let i = 0; i < sample.idx.length; i++) out[sample.idx[i]!] = sample.val[i]!;
  return out;
}

function rehearse() {
  const n = Math.min(80, buffer.length);
  const rate = model.played + model.watched < 80 ? 0.004 : 0.0015;
  for (let i = 0; i < n; i++) {
    const sample = buffer[Math.floor(Math.random() * buffer.length)]!;
    learnValue(recall(sample), sample.target, rate);
  }
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
  const tag: "nn" | "ai" | "draw" = winner < 0 ? "draw" : kinds[winner] === "nn" ? "nn" : "ai";
  model.recent.push(tag);
  if (model.recent.length > 32) model.recent.shift();
  if (winner < 0) return;
  if (kinds[winner] === "nn") model.nnWins += 1;
  else model.aiWins += 1;
}

/** Who won, plus a hint from HP, sanity, Sequence progress, and whether the potion is ready. */
function shapedTarget(row: number[], outcome: number): number {
  const myHp = row[0] ?? 0;
  const mySan = row[1] ?? 0;
  const mySeq = row[3] ?? 0;
  const acting = row[15] ?? 0;
  const canPay = row[16] ?? 0;
  const progress = row[17] ?? 0;
  const oppHp = row[SELF] ?? 0;
  const oppSan = row[SELF + 1] ?? 0;
  const oppSeq = row[SELF + 3] ?? 0;
  const edge =
    (myHp - oppHp) * 0.7 +
    (mySan - oppSan) * 0.6 +
    (oppSeq - mySeq) * 3 +
    0.7 * (acting + canPay + progress);
  const hint = 1 / (1 + Math.exp(-2.2 * edge));
  return 0.55 * outcome + 0.45 * hint;
}

function thinSamples(rows: number[][], cap = 18): number[][] {
  if (rows.length <= cap) return rows;
  const out: number[][] = [];
  for (let i = 0; i < cap; i++) {
    const idx = Math.round((i * (rows.length - 1)) / (cap - 1));
    out.push(rows[idx]!);
  }
  return out;
}

/**
 * One match. Each seat is the neural network or the search AI.
 * The two seats swap who goes first every game.
 * Every seat's positions are labeled by who won the game, so the network
 * learns the value of the board after real cards and Sequence abilities resolve.
 * NN-versus-AI results are stored on the model.
 */
export async function runTrainerMatch(
  games: number,
  seatA: SeatController,
  seatB: SeatController,
  onProgress?: (done: number, total: number) => void,
) {
  hydrateLearner();
  const total = Math.max(1, Math.min(1024, Math.floor(games)));
  for (let g = 0; g < total; g++) {
    const seed = (Math.floor(Math.random() * 1_000_000_000) + g * 13 + 1) >>> 0;
    const state = openDuel(seed || 1);
    const kinds: [SeatController, SeatController] = g % 2 === 0 ? [seatA, seatB] : [seatB, seatA];
    const byId = new Map<string, SeatController>();
    state.players.forEach((p, i) => byId.set(p.id, kinds[i]!));
    const taken = new Map<string, number[][]>();
    const bothAi = seatA === "ai" && seatB === "ai";
    const explore = Math.max(0.06, 0.2 * Math.exp(-(model.played + model.watched) / 160));
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
      let applied = false;
      if (kind === "nn") {
        const choice = pickByValue(state, choices, explore);
        if (choice && choice.apply(state)) applied = true;
      } else {
        const best = searchChoice(state, choices);
        if (best.apply(state)) applied = true;
      }
      if (!applied) endTurn(state, getRng(state));
      const rows = taken.get(seat.id) ?? [];
      rows.push(positionVector(state, seat.id));
      taken.set(seat.id, rows);
      guard += 1;
    }
    noteHeadToHead(state, kinds);
    const winner = state.winnerId;
    for (const [seatId, rows] of taken) {
      const outcome = winner ? (winner === seatId ? 1 : 0) : 0.5;
      if (byId.get(seatId) === "nn") {
        if (outcome === 1) model.wins += 1;
        else model.losses += 1;
      }
      for (const row of thinSamples(rows)) {
        const target = shapedTarget(row, outcome);
        remember(row, target);
        const rate = model.played + model.watched < 80 ? 0.008 : 0.002;
        learnValue(row, target, rate);
      }
    }
    rehearse();
    if (bothAi) model.watched += 1;
    else model.played += 1;
    onProgress?.(g + 1, total);
    if ((g + 1) % 8 === 0) saveLearnerLocal();
    await stepYield();
  }
  saveLearnerLocal();
}
