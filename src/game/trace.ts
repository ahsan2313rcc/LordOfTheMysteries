import type { GameState } from "./types";

export const TRACE_KINDS = ["draw", "discard", "play", "cast", "attack", "drink", "steal", "other"] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

export interface TraceEvent {
  kind: TraceKind;
  /** Card definition involved, when one was seen. */
  cardId?: string;
}

export interface LiteSeat {
  id: string;
  seq: number;
  hp: number;
  sanity: number;
  sp: number;
  hand: string[];
  defs: string[];
  weapon?: string;
  artifact?: string;
  trap?: string;
  charms: string[];
}

export interface LiteBoard {
  seatId: string;
  deck: number;
  discard: number;
  standard: boolean;
  sequenceUsed: boolean;
  attack: boolean;
  potion: boolean;
  seats: LiteSeat[];
}

function seatLite(state: GameState, id: string): LiteSeat {
  const p = state.players.find((seat) => seat.id === id)!;
  return {
    id,
    seq: p.sequence,
    hp: p.hp,
    sanity: p.sanity,
    sp: p.sp,
    hand: p.hand.map((card) => card.instanceId),
    defs: p.hand.map((card) => card.defId),
    weapon: p.weapon?.defId,
    artifact: p.artifact?.defId,
    trap: p.trap?.defId,
    charms: p.charms.map((card) => card.defId),
  };
}

export function liteBoard(state: GameState): LiteBoard {
  const seat = state.players[state.currentPlayerIndex]!;
  return {
    seatId: seat.id,
    deck: state.deck.length,
    discard: state.discard.length,
    standard: state.actionsUsed.standard,
    sequenceUsed: state.actionsUsed.sequence,
    attack: state.actionsUsed.attack,
    potion: !!state.potionDrunk,
    seats: state.players.map((p) => seatLite(state, p.id)),
  };
}

function lostDef(before: LiteSeat, after: LiteSeat): string | undefined {
  const afterIds = new Set(after.hand);
  for (let i = 0; i < before.hand.length; i++) {
    if (!afterIds.has(before.hand[i]!)) return before.defs[i];
  }
  return undefined;
}

/** Record what just changed, without being told what a card or ability is supposed to do. */
export function noteAction(state: GameState, before: LiteBoard) {
  const actor = before.seats.find((seat) => seat.id === before.seatId);
  const afterActor = state.players.find((seat) => seat.id === before.seatId);
  if (!actor || !afterActor) return;
  const now = seatLite(state, actor.id);
  const cardId = lostDef(actor, now);
  let kind: TraceKind = "other";
  if (now.seq < actor.seq) kind = "drink";
  else if (!before.sequenceUsed && state.actionsUsed.sequence && state.currentPlayerIndex === state.players.findIndex((p) => p.id === actor.id))
    kind = "cast";
  else if (!before.attack && state.actionsUsed.attack) kind = "attack";
  else if (cardMovedToSomeoneElse(before, state, actor.id)) kind = "steal";
  else if (state.deck.length < before.deck && now.hand.length > actor.hand.length) kind = "draw";
  else if (now.hand.length < actor.hand.length && state.discard.length > before.discard) kind = "play";
  else if (now.hand.length < actor.hand.length) kind = "discard";
  const trace = state.learnerTrace ?? [];
  trace.push({ kind, cardId });
  state.learnerTrace = trace.slice(-6);
}

function cardMovedToSomeoneElse(before: LiteBoard, after: GameState, actorId: string): boolean {
  const prev = before.seats.find((seat) => seat.id === actorId);
  if (!prev) return false;
  const gone = prev.defs.filter((def, i) => {
    const id = prev.hand[i];
    const actor = after.players.find((seat) => seat.id === actorId)!;
    return !actor.hand.some((card) => card.instanceId === id);
  });
  if (!gone.length) return false;
  return after.players.some((seat) => {
    if (seat.id === actorId) return false;
    const held = [
      ...seat.hand.map((card) => card.defId),
      seat.weapon?.defId,
      seat.artifact?.defId,
      seat.trap?.defId,
      ...seat.charms.map((card) => card.defId),
    ];
    return gone.some((def) => held.includes(def));
  });
}
