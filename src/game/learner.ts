import { choiceValue, legalChoices, type LegalChoice } from "./ai";
import { CARD_DEFS } from "./cards";
import { createGame, currentPlayer, endTurn, getRng } from "./engine";
import { matchRecipe } from "./ascension";
import { PATHWAYS, getSequence } from "./pathways";
import { liteBoard, noteAction, TRACE_KINDS } from "./trace";
import type { CardInstance, GameState, PlayerState } from "./types";

/**
 * A small network that scores a position: how likely this seat is to win from here.
 * It starts without knowing what a card or a Sequence ability does. Card names,
 * pathway names, and ability names are only identities. Effects are learned from
 * how the board changes and who won. Hidden numbers are marked unknown.
 * Weights live in this module and in the browser's local storage.
 * The weights used to play are the best exam so far against the search AI.
 */

const CARD_IDS = CARD_DEFS.map((c) => c.id);
const ABILITY_IDS = [...new Set(PATHWAYS.flatMap((p) => p.sequences.map((s) => s.abilityId)))].sort();
const PATHS = PATHWAYS.length;
const HAND_SLOTS = 7;
const GEAR_SLOTS = 5;
const OPP_SLOTS = 3;
const TRACE_SLOTS = 6;
const ID_BLOCK = 1 + CARD_IDS.length;
const AB_BLOCK = 1 + ABILITY_IDS.length;
const PATH_BLOCK = 1 + PATHS;
const SCALARS = 21;
const GEAR_BLOCK = 2 + ID_BLOCK;
const SEAT_BLOCK = SCALARS + HAND_SLOTS * ID_BLOCK + GEAR_SLOTS * GEAR_BLOCK + AB_BLOCK + PATH_BLOCK;
const DISCARD_BLOCK = 2 + CARD_IDS.length;
const DECK_BLOCK = 2;
const TRACE_BLOCK = 1 + TRACE_KINDS.length + ID_BLOCK;
const GLOBAL_BLOCK = 6;
export const INPUTS =
  SEAT_BLOCK * (1 + OPP_SLOTS) + DISCARD_BLOCK + DECK_BLOCK + TRACE_SLOTS * TRACE_BLOCK + GLOBAL_BLOCK;
const H1 = 32;
const H2 = 16;
const STORE_KEY = "lotm-learner-v3";

export type SeatController = "nn" | "ai";

interface Weights {
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  w3: number[];
  b3: number[];
}

export interface LearnerModel extends Weights {
  version: 3;
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
  /** Weights that won the last same-deal check. This is the network that plays. */
  champion: Weights | null;
  /** Champion's wins on the deals that crowned it, refreshed on each later check. */
  championRate: number;
  championGames: number;
  /** Live weights on the newest check. */
  latestExamRate: number;
  latestExamGames: number;
  /** Champion and live scores, newest last, from each same-deal check. */
  examHistory: { live: number; champion: number }[];
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
    version: 3,
    champion: null,
    championRate: 0,
    championGames: 0,
    latestExamRate: 0,
    latestExamGames: 0,
    examHistory: [],
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
  parsed.champion ??= null;
  parsed.championRate ??= 0;
  parsed.championGames ??= 0;
  parsed.latestExamRate ??= 0;
  parsed.latestExamGames ??= 0;
  parsed.examHistory ??= [];
  if (parsed.champion && parsed.champion.w1.length !== INPUTS * H1) parsed.champion = null;
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
    championRate: model.championRate ?? 0,
    championGames: model.championGames ?? 0,
    latestExamRate: model.latestExamRate ?? 0,
    latestExamGames: model.latestExamGames ?? 0,
    examHistory: model.examHistory ?? [],
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
  try {
    localStorage.setItem(STORE_KEY, learnerJson());
    return true;
  } catch {
    return false;
  }
}

function loadFromStorage(): boolean {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as LearnerModel;
    if (parsed.version !== 3 || parsed.w1.length !== INPUTS * H1) return false;
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
    if (parsed.version !== 3 || parsed.w1.length !== INPUTS * H1) return false;
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

/** When set, scoring reads the champion. Training always writes the live weights. */
let reading: Weights | null = null;

function params(): Weights {
  return reading ?? model;
}

function forward(input: number[]) {
  const net = params();
  const h1 = new Array<number>(H1);
  const active: number[] = [];
  for (let i = 0; i < input.length; i++) if (input[i]) active.push(i);
  for (let j = 0; j < H1; j++) {
    let s = net.b1[j]!;
    const base = j * INPUTS;
    for (const i of active) s += net.w1[base + i]! * input[i]!;
    h1[j] = tanh(s);
  }
  const h2 = new Array<number>(H2);
  for (let j = 0; j < H2; j++) {
    let s = net.b2[j]!;
    const base = j * H1;
    for (let i = 0; i < H1; i++) s += net.w2[base + i]! * h1[i]!;
    h2[j] = tanh(s);
  }
  let y = net.b3[0]!;
  for (let i = 0; i < H2; i++) y += net.w3[i]! * h2[i]!;
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

/** First value is 1 when the identity is known. A zero there means unknown, not "none". */
function pushKnownHot(out: number[], ids: readonly string[], id: string | undefined, known: boolean) {
  out.push(known ? 1 : 0);
  for (let i = 0; i < ids.length; i++) out.push(known && id !== undefined && ids[i] === id ? 1 : 0);
}

function abilityOf(seat: PlayerState): string {
  return getSequence(seat.pathwayId, seat.sequence).abilityId;
}

function recipeProgress(seat: PlayerState): number {
  const recipe = matchRecipe(seat);
  if (!recipe || recipe.needed.length === 0) return 0;
  return (recipe.needed.length - recipe.remaining.length) / recipe.needed.length;
}

function seatKnown(state: GameState, seat: PlayerState, viewerId: string): boolean {
  if (seat.id === viewerId) return true;
  if (!state.arcanaConcealment) return true;
  return !!seat.revealed;
}

function pushGearSlot(out: number[], card: CardInstance | undefined, slotKnown: boolean, identityKnown: boolean) {
  out.push(slotKnown ? 1 : 0, slotKnown && card ? 1 : 0);
  pushKnownHot(out, CARD_IDS, identityKnown ? card?.defId : undefined, identityKnown);
}

function pushSeat(out: number[], state: GameState, seat: PlayerState | undefined, viewerId: string) {
  if (!seat) {
    for (let i = 0; i < SEAT_BLOCK; i++) out.push(0);
    return;
  }
  const board = seatKnown(state, seat, viewerId);
  const self = seat.id === viewerId;
  out.push(
    1,
    seat.hp / 20,
    1,
    seat.sanity / 20,
    board ? 1 : 0,
    board ? seat.sp / 20 : 0,
    board ? 1 : 0,
    board ? seat.sequence / 9 : 0,
    board ? 1 : 0,
    seat.hand.length / 7,
    board ? Math.min(seat.status.block, 8) / 8 : 0,
    board ? Math.min(seat.status.evade, 3) / 3 : 0,
    board ? Math.min(Math.max(seat.status.attackModifier, 0), 6) / 6 : 0,
    board && seat.actingMet ? 1 : 0,
    board && matchRecipe(seat)?.canPay ? 1 : 0,
    board ? recipeProgress(seat) : 0,
    currentPlayer(state).id === seat.id ? 1 : 0,
    board ? 1 : 0,
    seat.alive ? 1 : 0,
    seat.mad ? 1 : 0,
    seat.sanityBroken ? 1 : 0,
  );
  for (let i = 0; i < HAND_SLOTS; i++) pushKnownHot(out, CARD_IDS, seat.hand[i]?.defId, board);
  pushGearSlot(out, seat.weapon, board, board);
  pushGearSlot(out, seat.artifact, board, board);
  pushGearSlot(out, seat.trap, board, self);
  pushGearSlot(out, seat.charms[0], board, board);
  pushGearSlot(out, seat.charms[1], board, board);
  pushKnownHot(out, ABILITY_IDS, board ? abilityOf(seat) : undefined, board);
  out.push(board ? 1 : 0);
  const path = pathwayIndex(seat.pathwayId);
  for (let i = 0; i < PATHS; i++) out.push(board && path === i ? 1 : 0);
}

/** Public position from one seat. Hidden facts carry a known-bit of 0. */
export function positionVector(state: GameState, seatId: string): number[] {
  const out: number[] = [];
  const me = state.players.find((p) => p.id === seatId)!;
  pushSeat(out, state, me, seatId);
  const opps = state.players.filter((p) => p.id !== seatId);
  for (let i = 0; i < OPP_SLOTS; i++) pushSeat(out, state, opps[i], seatId);

  out.push(1, state.discard.length / 78);
  const discarded = new Set(state.discard.map((card) => card.defId));
  for (const id of CARD_IDS) out.push(discarded.has(id) ? 1 : 0);

  out.push(0, state.deck.length / 78);

  const trace = state.learnerTrace ?? [];
  for (let i = 0; i < TRACE_SLOTS; i++) {
    const event = trace[i];
    out.push(event ? 1 : 0);
    for (const kind of TRACE_KINDS) out.push(event?.kind === kind ? 1 : 0);
    pushKnownHot(out, CARD_IDS, event?.cardId, !!event?.cardId);
  }

  out.push(
    Math.min(state.turnNumber, 80) / 80,
    state.arcanaConcealment ? 1 : 0,
    state.actionsUsed.standard ? 1 : 0,
    state.actionsUsed.sequence ? 1 : 0,
    state.actionsUsed.attack ? 1 : 0,
    state.potionDrunk ? 1 : 0,
  );
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
  const before = liteBoard(clone);
  if (!choice.apply(clone)) return null;
  noteAction(clone, before);
  return sigmoid(forward(positionVector(clone, seatId)).y);
}

function usingChampion<T>(fn: () => T): T {
  if (!model.champion) return fn();
  reading = model.champion;
  try {
    return fn();
  } finally {
    reading = null;
  }
}

/**
 * One action from the network. It tries every legal move with the real rules
 * and keeps the one that leaves the higher chance of winning. explore is only
 * for training; a finished game uses 0. A saved champion is the player.
 */
export function playNetworkTurn(state: GameState, explore = 0): boolean {
  if (!model.champion && model.played + model.watched === 0) return false;
  const choices = legalChoices(state);
  if (!choices.length) return false;
  const before = liteBoard(state);
  const picked = usingChampion(() => pickByValue(state, choices, explore));
  if (!picked) return false;
  const ok = picked.apply(state);
  if (ok) noteAction(state, before);
  return ok;
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

/**
 * The finished game, blended with the value of the next position this seat
 * reached. The next value is detached, so the target is a number, not a guess
 * about what a card is supposed to do.
 */
function tdTargets(rows: number[][], outcome: number): number[] {
  const next = rows.map((row) => sigmoid(forward(row).y));
  const blend = model.played + model.watched < 48 ? 0.85 : 0.6;
  return rows.map((_, i) => {
    if (i + 1 >= rows.length) return outcome;
    const mixed = blend * outcome + (1 - blend) * next[i + 1]!;
    return Math.max(0, Math.min(1, mixed));
  });
}

function snapshotWeights(): Weights {
  return {
    w1: model.w1.slice(),
    b1: model.b1.slice(),
    w2: model.w2.slice(),
    b2: model.b2.slice(),
    w3: model.w3.slice(),
    b3: model.b3.slice(),
  };
}

/** A short game against the frozen search AI. Nothing here is trained. */
function examOnce(seed: number, nnFirst: boolean): "nn" | "ai" | "draw" {
  const state = openDuel(seed);
  const kinds: [SeatController, SeatController] = nnFirst ? ["nn", "ai"] : ["ai", "nn"];
  const byId = new Map<string, SeatController>();
  state.players.forEach((p, i) => byId.set(p.id, kinds[i]!));
  let guard = 0;
  while ((state.phase as string) !== "gameover" && guard < 240) {
    const seat = currentPlayer(state);
    const choices = legalChoices(state);
    const before = liteBoard(state);
    if (!choices.length) {
      endTurn(state, getRng(state));
      noteAction(state, before);
      guard += 1;
      continue;
    }
    const kind = byId.get(seat.id) ?? "ai";
    const choice = kind === "nn" ? pickByValue(state, choices, 0) : searchChoice(state, choices);
    if (!choice || !choice.apply(state)) endTurn(state, getRng(state));
    noteAction(state, before);
    guard += 1;
  }
  const winner = state.players.findIndex((p) => p.id === state.winnerId);
  if (winner < 0) return "draw";
  return kinds[winner] === "nn" ? "nn" : "ai";
}

function considerChampion() {
  const games = 8;
  const seeds: number[] = [];
  for (let i = 0; i < games; i++) seeds.push((Math.floor(Math.random() * 1_000_000_000) + i * 17 + 3) >>> 0 || 1);
  let liveWins = 0;
  for (let i = 0; i < games; i++) {
    if (examOnce(seeds[i]!, i % 2 === 0) === "nn") liveWins += 1;
  }
  let champWins = 0;
  if (model.champion) {
    reading = model.champion;
    try {
      for (let i = 0; i < games; i++) {
        if (examOnce(seeds[i]!, i % 2 === 0) === "nn") champWins += 1;
      }
    } finally {
      reading = null;
    }
  }
  model.latestExamRate = liveWins / games;
  model.latestExamGames = games;
  model.examHistory = [...(model.examHistory ?? []), { live: liveWins / games, champion: model.champion ? champWins / games : liveWins / games }].slice(-12);
  if (!model.champion || liveWins > champWins) {
    model.champion = snapshotWeights();
    model.championRate = liveWins / games;
    model.championGames = games;
  } else {
    model.championRate = champWins / games;
    model.championGames = games;
  }
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
      const before = liteBoard(state);
      let applied = false;
      if (kind === "nn") {
        const choice = pickByValue(state, choices, explore);
        if (choice && choice.apply(state)) applied = true;
      } else {
        const best = searchChoice(state, choices);
        if (best.apply(state)) applied = true;
      }
      if (!applied) endTurn(state, getRng(state));
      noteAction(state, before);
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
      const kept = thinSamples(rows);
      const targets = tdTargets(kept, outcome);
      const rate = model.played + model.watched < 48 ? 0.006 : 0.002;
      for (let i = 0; i < kept.length; i++) {
        remember(kept[i]!, targets[i]!);
        learnValue(kept[i]!, targets[i]!, rate);
      }
    }
    rehearse();
    if (bothAi) model.watched += 1;
    else model.played += 1;
    if ((g + 1) % 16 === 0 || (g + 1 === total && total % 16 !== 0)) considerChampion();
    onProgress?.(g + 1, total);
    if ((g + 1) % 8 === 0) saveLearnerLocal();
    await stepYield();
  }
  saveLearnerLocal();
}
