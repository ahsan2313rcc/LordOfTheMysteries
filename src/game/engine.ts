import {
  bankTurnProgress,
  emptyFlags,
  evaluateActing,
  refreshActingMet,
  resetActingForNewSequence,
} from "./acting";
import { matchRecipe } from "./ascension";
import { buildMainDeckCounts, getCardDef } from "./cards";
import { getPathway, getSequence, spGainFor } from "./pathways";
import { createRng, type Rng } from "./rng";
import type {
  ActionBucket,
  CardInstance,
  GameLogEntry,
  GameState,
  PlayerState,
  RevealEvent,
  StatusFlags,
} from "./types";

export {
  actingProgressItems,
  evaluateActing as checkActing,
  refreshActingMet,
} from "./acting";
export { ascensionReady, matchRecipe } from "./ascension";

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.floor(Math.random() * 1e5)}`;
}

function emptyStatus(): StatusFlags {
  return {
    block: 0,
    sanityBlock: 0,
    evade: 0,
    stunned: false,
    skipDraw: false,
    skipAction: false,
    attackModifier: 0,
    blockModifier: 0,
    unblockableAttack: false,
    noPassiveSp: false,
  };
}

function noteActing(state: GameState, player: PlayerState) {
  if (refreshActingMet(player)) {
    const seq = getSequence(player.pathwayId, player.sequence);
    log(
      state,
      `${player.name} fulfills the Acting Condition for ${seq.title} — potion ready (persists until Ascension).`,
      "ascend",
    );
  }
}

function cardSnapshot(card: CardInstance) {
  const d = getCardDef(card.defId);
  return { name: d.name, type: d.type, rarity: d.rarity, text: d.text };
}

/** Push a UI reveal so peeks/steals are visible to the human player. */
export function pushReveal(state: GameState, reveal: Omit<RevealEvent, "id">) {
  state.reveals = [
    { ...reveal, id: uid("reveal") },
    ...(state.reveals ?? []),
  ].slice(0, 12);
}

export function revealPlayerHand(
  state: GameState,
  subject: PlayerState,
  title?: string,
) {
  pushReveal(state, {
    kind: "hand",
    title: title ?? `${subject.name}'s Hand Revealed`,
    subjectName: subject.name,
    cards: subject.hand.map(cardSnapshot),
    detail:
      subject.hand.length === 0
        ? "Empty hand."
        : `${subject.hand.length} card(s) shown.`,
  });
  log(
    state,
    `Hand of ${subject.name}: ${
      subject.hand.map((c) => getCardDef(c.defId).name).join(", ") || "(empty)"
    }`,
    "system",
  );
}

export function revealDeckTop(state: GameState, count: number, title?: string) {
  const cards = state.deck.slice(-count);
  pushReveal(state, {
    kind: "deck",
    title: title ?? `Top ${count} of the Deck`,
    cards: cards.map(cardSnapshot),
    detail: cards.length
      ? "Top → bottom shown left → right (last is top)."
      : "Deck empty.",
  });
  log(
    state,
    `Deck top: ${cards.map((c) => getCardDef(c.defId).name).join(", ") || "(empty)"}`,
    "system",
  );
}

export function announceSteal(
  state: GameState,
  card: CardInstance,
  from: PlayerState,
  to: PlayerState,
) {
  const d = getCardDef(card.defId);
  pushReveal(state, {
    kind: "steal",
    title: `${to.name} stole ${d.name}`,
    subjectName: from.name,
    cards: [cardSnapshot(card)],
    detail: `Taken from ${from.name}'s hand.`,
  });
  log(state, `${to.name} steals ${d.name} from ${from.name}!`, "ascend");
}

function log(state: GameState, text: string, tone: GameLogEntry["tone"] = "neutral") {
  state.log = [{ id: uid("log"), text, tone }, ...state.log].slice(0, 80);
}

function makeCard(defId: string): CardInstance {
  return { instanceId: uid("card"), defId };
}

export function handLimit(p: PlayerState): number {
  // Base 7 so mid/late recipes (4–5 ingredients) can be held without auto-discard.
  let lim = 7;
  for (const c of p.charms) {
    const d = getCardDef(c.defId);
    lim += d.charm?.handLimitBonus ?? 0;
  }
  return lim;
}

export function charmBlock(p: PlayerState): number {
  return p.charms.reduce((n, c) => n + (getCardDef(c.defId).charm?.block ?? 0), 0);
}

export function charmSanityBlock(p: PlayerState): number {
  return p.charms.reduce(
    (n, c) => n + (getCardDef(c.defId).charm?.sanityBlock ?? 0),
    0,
  );
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex]!;
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

export function opponentsOf(state: GameState, playerId: string): PlayerState[] {
  return state.players.filter((p) => p.alive && p.id !== playerId);
}

function ensureDeck(state: GameState, rng: Rng) {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = rng.shuffle(state.discard);
    state.discard = [];
    log(state, "The Spirit World reshuffles the discard into a new deck.", "system");
  }
}

export function drawCards(
  state: GameState,
  player: PlayerState,
  n: number,
  rng: Rng,
  extra = false,
) {
  for (let i = 0; i < n; i++) {
    ensureDeck(state, rng);
    const card = state.deck.pop();
    if (!card) break;
    player.hand.push(card);
    if ((player.drawPoison ?? 0) > 0) {
      dealDamage(state, null, player, player.drawPoison!, { unblockable: true }, rng);
    }
  }
  if (extra && n > 0) player.turnFlags.drewExtra = true;
  if (n >= 2) maybeTriggerTraps(state, player, "draw2", rng);
}

function discardToPile(state: GameState, card: CardInstance) {
  state.discard.push(card);
}

export function paySp(player: PlayerState, cost: number, state: GameState): boolean {
  if (player.sp < cost) return false;
  player.sp -= cost;
  player.turnFlags.spSpent += cost;
  return true;
}

export function dealDamage(
  state: GameState,
  source: PlayerState | null,
  target: PlayerState,
  amount: number,
  opts: {
    type?: "hp" | "sanity";
    unblockable?: boolean;
    ignoreEvade?: boolean;
    ignoreBlock?: number;
    ranged?: boolean;
    melee?: boolean;
  } = {},
  rng: Rng,
): number {
  if (!target.alive || amount <= 0) return 0;
  const dtype = opts.type ?? "hp";

  // Melee / ranged immunities
  if (opts.melee) {
    for (const c of target.charms) {
      if (getCardDef(c.defId).charm?.meleeImmune) {
        log(state, `${target.name}'s armor nullifies the melee blow.`, "system");
        return 0;
      }
    }
  }
  if (opts.ranged) {
    for (const c of target.charms) {
      if (getCardDef(c.defId).charm?.rangedEvade) {
        log(state, `${target.name}'s Sunbird Charm evades the ranged attack.`, "system");
        target.turnFlags.evadedOrBlocked = true;
        return 0;
      }
    }
  }

  if (!opts.ignoreEvade && !opts.unblockable && target.status.evade > 0) {
    target.status.evade -= 1;
    target.turnFlags.evadedOrBlocked = true;
    target.turnFlags.negatedAttack = true;
    log(state, `${target.name} Evades the attack!`, "system");
    maybeTriggerTraps(state, target, "evade", rng);
    return 0;
  }

  // Once-per-cycle charm evade
  if (!opts.ignoreEvade && !opts.unblockable) {
    for (const c of target.charms) {
      const cd = getCardDef(c.defId);
      if (cd.charm?.onceEvade && !target.status.onceEvadeUsed) {
        target.status.onceEvadeUsed = true;
        target.turnFlags.evadedOrBlocked = true;
        log(state, `${target.name} triggers Evernight's Blessing to Evade!`, "system");
        return 0;
      }
    }
  }

  let dmg = amount;
  if (dtype === "hp") {
    let block =
      target.status.block +
      (target.lastingBlock ?? 0) +
      charmBlock(target) +
      target.status.blockModifier;
    if (opts.ignoreBlock) block = Math.max(0, block - opts.ignoreBlock);
    if (opts.unblockable) block = 0;
    if (block > 0) {
      const absorbed = Math.min(block, dmg);
      // Spend temporary block first, then lasting
      let left = absorbed;
      const fromTemp = Math.min(target.status.block, left);
      target.status.block -= fromTemp;
      left -= fromTemp;
      if (left > 0 && (target.lastingBlock ?? 0) > 0) {
        target.lastingBlock = Math.max(0, (target.lastingBlock ?? 0) - left);
      }
      dmg -= absorbed;
      target.turnFlags.evadedOrBlocked = true;
      if (absorbed > 0 && source) {
        for (const c of target.charms) {
          const cd = getCardDef(c.defId);
          if (cd.charm?.thorns) {
            dealDamage(state, target, source, cd.charm.thorns, { unblockable: true }, rng);
          }
          if (cd.charm?.siphonSp) {
            const steal = Math.min(source.sp, cd.charm.siphonSp);
            source.sp -= steal;
            target.sp = Math.min(20, target.sp + steal);
          }
        }
      }
    }
    if (dmg <= 0) return 0;

    // Damage share (Spirit Entanglement etc.)
    if (target.status.damageShareWith) {
      const linked = state.players.find((p) => p.id === target.status.damageShareWith);
      if (linked?.alive) {
        const share = Math.ceil(dmg / 2);
        linked.hp = Math.max(0, linked.hp - share);
        log(state, `${linked.name} shares ${share} pain via Entanglement.`, "damage");
        checkElimination(state, linked, source, rng);
      }
    }

    target.hp = Math.max(0, target.hp - dmg);
    target.turnFlags.tookDamage = true;
    if (!state.cycleDamage[target.id]) {
      state.cycleDamage[target.id] = { hpTaken: false, sanityTaken: false };
    }
    state.cycleDamage[target.id]!.hpTaken = true;
    if (source) {
      source.turnFlags.dealtDamage = true;
      source.turnFlags.damageDealtTotal += dmg;
      if (source.hp < 10) source.turnFlags.damagedWhileLowHp = true;
      noteActing(state, source);
    }
    log(
      state,
      `${source?.name ?? "Fate"} deals ${dmg} HP to ${target.name}.`,
      "damage",
    );
    checkElimination(state, target, source, rng);
    return dmg;
  }

  // Sanity damage
  let sBlock = target.status.sanityBlock + charmSanityBlock(target);
  if (opts.unblockable) sBlock = 0;
  if (sBlock > 0) {
    const absorbed = Math.min(sBlock, dmg);
    target.status.sanityBlock = Math.max(0, target.status.sanityBlock - absorbed);
    dmg -= absorbed;
    target.turnFlags.evadedOrBlocked = true;
  }
  if (dmg <= 0) return 0;

  if (target.sanity === 0) {
    // Sanity damage at 0 drops HP instead
    return dealDamage(state, source, target, dmg, { type: "hp", unblockable: opts.unblockable }, rng);
  }

  const wasSane = target.sanity > 0;
  target.sanity = Math.max(0, target.sanity - dmg);
  target.turnFlags.lostSanity = true;
  if (!state.cycleDamage[target.id]) {
    state.cycleDamage[target.id] = { hpTaken: false, sanityTaken: false };
  }
  state.cycleDamage[target.id]!.sanityTaken = true;
  if (source) {
    source.turnFlags.dealtDamage = true;
    source.turnFlags.dealtSanity = true;
    source.turnFlags.damageDealtTotal += dmg;
    noteActing(state, source);
  }
  log(
    state,
    `${source?.name ?? "Fate"} deals ${dmg} Sanity to ${target.name}.`,
    "damage",
  );
  updateMadness(target, state);
  if (wasSane && target.mad && source) {
    source.turnFlags.causedMadness += 1;
    noteActing(state, source);
  }
  return dmg;
}

function updateMadness(p: PlayerState, state: GameState) {
  const immune =
    p.status.madnessImmune ||
    p.charms.some((c) => getCardDef(c.defId).charm?.madnessImmune);
  if (p.sanity === 0 && !immune) {
    if (!p.mad) {
      p.mad = true;
      log(state, `${p.name} descends into Madness!`, "system");
    }
  } else if (p.sanity > 0 && p.mad) {
    p.mad = false;
    log(state, `${p.name} claws back to Sanity.`, "heal");
  }
}

function checkElimination(
  state: GameState,
  target: PlayerState,
  source: PlayerState | null,
  rng: Rng,
) {
  if (target.hp > 0 || !target.alive) return;

  if (target.fatalSafetyHp != null) {
    target.hp = target.fatalSafetyHp;
    target.fatalSafetyHp = undefined;
    target.turnFlags.survivedFatal = true;
    log(state, `${target.name}'s safety net triggers — remains at ${target.hp} HP!`, "heal");
    noteActing(state, target);
    return;
  }

  // Paper Substitute fatal trap
  if (target.trap) {
    const td = getCardDef(target.trap.defId);
    if (td.trap?.trigger === "fatal" && target.sp >= 1) {
      target.sp -= 1;
      discardToPile(state, target.trap);
      target.trap = undefined;
      target.hp = 1;
      target.turnFlags.survivedFatal = true;
      log(state, `${target.name}'s Paper Substitute negates death!`, "heal");
      return;
    }
  }

  target.alive = false;
  target.hp = 0;
  log(state, `${target.name} has been eliminated.`, "damage");

  if (source && source.alive) {
    for (const c of [...target.hand]) {
      source.hand.push(c);
    }
    target.hand = [];
    if (target.weapon) {
      source.hand.push(target.weapon);
      target.weapon = undefined;
    }
    log(state, `${source.name} loots the fallen's cards.`, "system");
  } else {
    for (const c of target.hand) discardToPile(state, c);
    target.hand = [];
  }

  const living = alivePlayers(state);
  if (living.length === 1) {
    state.winnerId = living[0]!.id;
    state.winReason = "lastStanding";
    state.phase = "gameover";
    log(state, `${living[0]!.name} is the Last One Standing!`, "ascend");
  } else if (living.length === 0) {
    state.phase = "gameover";
    log(state, "All have fallen into the fog…", "system");
  }
}

type TrapTrigger =
  | "attacked"
  | "spell"
  | "equip"
  | "draw2"
  | "gainSp"
  | "evade"
  | "ascension"
  | "equipRare"
  | "endTurn";

export function maybeTriggerTraps(
  state: GameState,
  actor: PlayerState,
  trigger: TrapTrigger,
  rng: Rng,
  meta?: { targetId?: string },
) {
  for (const owner of state.players) {
    if (!owner.alive || !owner.trap || owner.id === actor.id) continue;
    const def = getCardDef(owner.trap.defId);
    if (def.trap?.trigger !== trigger) continue;
    if (owner.sp < 1) continue; // pay 1 SP to trigger
    owner.sp -= 1;
    const trapCard = owner.trap;
    owner.trap = undefined;
    owner.turnFlags.triggeredTrap = true;
    actor.turnFlags.triggeredTrap = true;
    log(state, `${owner.name} springs ${def.name}!`, "system");

    switch (trigger) {
      case "attacked":
        if (def.id === "shadow_snare") {
          owner.status.evade += 1;
          dealDamage(state, owner, actor, 1, { unblockable: true }, rng);
        } else if (def.id === "mind_prison") {
          // negate handled by caller via return; apply sanity
          dealDamage(state, owner, actor, 1, { type: "sanity", unblockable: true }, rng);
        }
        break;
      case "spell":
        actor.status.stunned = true;
        if (def.id === "concealment_boundary") {
          dealDamage(state, owner, actor, 1, { unblockable: true }, rng);
        }
        break;
      case "draw2":
        dealDamage(state, owner, actor, 2, { type: "sanity" }, rng);
        break;
      case "gainSp": {
        const steal = Math.min(2, actor.sp);
        actor.sp -= steal;
        owner.sp = Math.min(20, owner.sp + steal);
        break;
      }
      case "evade":
        dealDamage(state, owner, actor, 1, { unblockable: true }, rng);
        break;
      case "endTurn": {
        for (const c of actor.hand) discardToPile(state, c);
        actor.hand = [];
        drawCards(state, actor, 3, rng, true);
        break;
      }
      case "ascension":
        // fail handled by ascend()
        break;
      default:
        break;
    }
    discardToPile(state, trapCard);
    void meta;
  }
}

export function createGame(opts: {
  humanPathwayId: string;
  aiPathwayIds: string[];
  seed?: number;
  humanName?: string;
}): GameState {
  const seed = opts.seed ?? Date.now();
  const rng = createRng(seed);
  idCounter = 0;

  const counts = buildMainDeckCounts();
  let deck: CardInstance[] = [];
  for (const { defId, copies } of counts) {
    for (let i = 0; i < copies; i++) deck.push(makeCard(defId));
  }
  deck = rng.shuffle(deck);

  const pathwayChoices = [opts.humanPathwayId, ...opts.aiPathwayIds];
  const players: PlayerState[] = pathwayChoices.map((pathwayId, i) => {
    const pathway = getPathway(pathwayId);
    return {
      id: uid("player"),
      name: i === 0 ? (opts.humanName ?? "You") : `${pathway.name} Adept`,
      isHuman: i === 0,
      pathwayId,
      sequence: 9,
      hp: 20,
      maxHp: 20,
      sanity: 20,
      sp: 0,
      hand: [],
      charms: [],
      status: emptyStatus(),
      turnFlags: emptyFlags(),
      actingBank: emptyFlags(),
      actingMet: false,
      alive: true,
      mad: false,
      lastingBlock: 0,
    };
  });

  // Deal 3 each
  for (const p of players) {
    for (let i = 0; i < 3; i++) {
      const c = deck.pop();
      if (c) p.hand.push(c);
    }
  }

  const state: GameState = {
    players,
    deck,
    discard: [],
    currentPlayerIndex: 0,
    phase: "begin",
    actionsUsed: { standard: false, sequence: false, attack: false },
    turnNumber: 1,
    // Seed as "taken" so the opening Begin does not grant free recovery.
    cycleDamage: Object.fromEntries(
      players.map((p) => [p.id, { hpTaken: true, sanityTaken: true }]),
    ),
    log: [],
    reveals: [],
    seed,
  };

  log(
    state,
    `A fog gathers. ${players.map((p) => `${p.name} (${getPathway(p.pathwayId).name})`).join(", ")} begin at Sequence 9.`,
    "system",
  );
  runBeginPhase(state, rng);
  return state;
}

/** True when the match already ended (avoids TS narrowing after local phase assigns). */
function isGameOver(state: GameState): boolean {
  const phase: string = state.phase;
  return phase === "gameover";
}

/** If only one (or zero) living players remain, lock the win immediately. */
function ensureLastStanding(state: GameState) {
  if (isGameOver(state)) return;
  const living = alivePlayers(state);
  if (living.length === 1) {
    state.winnerId = living[0]!.id;
    state.winReason = "lastStanding";
    state.phase = "gameover";
    log(state, `${living[0]!.name} is the Last One Standing!`, "ascend");
  } else if (living.length === 0) {
    state.phase = "gameover";
    log(state, "All have fallen into the fog…", "system");
  }
}

export function runBeginPhase(state: GameState, rng: Rng) {
  if (isGameOver(state)) return;
  const p = currentPlayer(state);
  if (!p.alive) {
    advanceTurn(state, rng);
    return;
  }

  state.phase = "begin";
  // Turn-local flags reset; Acting bank + actingMet persist until Ascension.
  p.turnFlags = emptyFlags();
  state.actionsUsed = { standard: false, sequence: false, attack: false };
  state.extraStandard = 0;

  // Groselle-style lasting Block expires at the start of your next Begin
  if ((p.lastingBlock ?? 0) > 0) {
    log(state, `${p.name}'s lasting Block fades with the new dawn.`, "system");
    p.lastingBlock = 0;
  }

  // Ongoing curses
  if (p.epidemicCurse) {
    dealDamage(state, null, p, 2, { unblockable: true }, rng);
    log(state, `${p.name} suffers Epidemic curse.`, "damage");
    if (isGameOver(state)) return;
  }
  if (p.doomCurse) {
    dealDamage(state, null, p, 2, { unblockable: true }, rng);
    p.sp = Math.max(0, p.sp - 1);
    if (isGameOver(state)) return;
  }
  if (p.cannotHealNextBegin) {
    p.cannotHealNextBegin = false;
  }

  // Artifact drawbacks (simplified)
  if (p.artifact && !p.ignoreArtifactDrawback) {
    const a = getCardDef(p.artifact.defId);
    if (a.id === "mirror_arrodes") {
      dealDamage(state, null, p, 2, { type: "sanity", unblockable: true }, rng);
    } else if (a.id === "groselle") {
      if (p.sp >= 3) p.sp -= 3;
      else dealDamage(state, null, p, 1, { type: "sanity", unblockable: true }, rng);
    } else if (a.id === "wishing_lamp") {
      const opp = rng.pick(opponentsOf(state, p.id));
      if (opp) drawCards(state, opp, 1, rng, true);
    } else if (a.id === "die_probability") {
      drawCards(state, p, 1, rng, true);
      const last = p.hand[p.hand.length - 1];
      if (last) {
        const d = getCardDef(last.defId);
        if (d.type === "spell" || d.type === "trap") {
          p.status.stunned = true;
          log(state, `Die of Probability stuns ${p.name}!`, "system");
        }
      }
    }
    if (isGameOver(state)) return;
  }
  p.ignoreArtifactDrawback = false;

  // Sword of Silver passive
  if (p.weapon && p.weapon.defId === "sword_silver") {
    p.status.block += 1;
  }

  // Charm begin bonuses
  for (const c of p.charms) {
    const d = getCardDef(c.defId);
    if (d.charm?.beginSpBonus) {
      p.sp = Math.min(20, p.sp + d.charm.beginSpBonus);
    }
    if (d.charm?.sanityRestoreBegin) {
      p.sanity = Math.min(20, p.sanity + d.charm.sanityRestoreBegin);
      updateMadness(p, state);
    }
  }

  // Passive recovery: HP if no HP taken; Sanity if no Sanity taken (full cycle).
  const cycle = state.cycleDamage[p.id] ?? { hpTaken: false, sanityTaken: false };
  if (!cycle.hpTaken) {
    p.hp = Math.min(p.maxHp, p.hp + 1);
    log(state, `${p.name} recovers 1 HP (no HP damage last cycle).`, "heal");
  }
  if (!cycle.sanityTaken) {
    p.sanity = Math.min(20, p.sanity + 1);
    updateMadness(p, state);
    log(state, `${p.name} steadies 1 Sanity (no Sanity damage last cycle).`, "heal");
  }
  state.cycleDamage[p.id] = { hpTaken: false, sanityTaken: false };

  // Always generate SP from Pathway Sequence (Spirit Bullet may still tax via status).
  {
    let gain = spGainFor(p.pathwayId, p.sequence);
    if (p.status.noPassiveSp) {
      gain = Math.max(0, gain - 1);
      log(state, `${p.name}'s Spirit is strained (−1 SP generation).`, "system");
    }
    if (gain > 0) {
      p.sp = Math.min(20, p.sp + gain);
      log(
        state,
        `${p.name} generates ${gain} SP (${getPathway(p.pathwayId).name} Seq ${p.sequence}).`,
        "system",
      );
      maybeTriggerTraps(state, p, "gainSp", rng);
      if (isGameOver(state)) return;
    }
  }
  p.status.noPassiveSp = false;

  // Madness check
  updateMadness(p, state);
  if (p.mad) {
    log(state, `${p.name} is Mad — skipping Draw/Action; frenzied assault!`, "damage");
    // Discard random
    if (p.hand.length > 0) {
      const idx = rng.int(p.hand.length);
      const [card] = p.hand.splice(idx, 1);
      if (card) discardToPile(state, card);
    }
    // Deal base attack to all including self
    for (const t of alivePlayers(state)) {
      dealDamage(state, p, t, 1, {}, rng);
      if (isGameOver(state)) return;
    }
    ensureLastStanding(state);
    if (isGameOver(state)) return;
    runEndPhase(state, rng);
    return;
  }

  if (p.status.stunned || p.status.skipAction) {
    log(state, `${p.name} is Stunned and loses their Action Phase.`, "system");
    p.status.stunned = false;
    p.status.skipAction = false;
    // Still draw unless skipDraw
    state.phase = "draw";
    if (!p.status.skipDraw) {
      const bonus = p.charms.reduce(
        (n, c) => n + (getCardDef(c.defId).charm?.drawBonus ?? 0),
        0,
      );
      drawCards(state, p, 1 + bonus, rng);
      log(state, `${p.name} draws.`, "system");
    }
    p.status.skipDraw = false;
    if (isGameOver(state)) return;
    runEndPhase(state, rng);
    return;
  }

  state.phase = "draw";
  if (!p.status.skipDraw) {
    const bonus = p.charms.reduce(
      (n, c) => n + (getCardDef(c.defId).charm?.drawBonus ?? 0),
      0,
    );
    drawCards(state, p, 1 + bonus, rng);
    log(state, `${p.name} draws ${1 + bonus}.`, "system");
  }
  p.status.skipDraw = false;
  if (isGameOver(state)) return;
  state.phase = "action";
}

export function runEndPhase(state: GameState, rng: Rng) {
  if (isGameOver(state)) return;
  ensureLastStanding(state);
  if (isGameOver(state)) return;

  const p = currentPlayer(state);
  state.phase = "end";

  maybeTriggerTraps(state, p, "endTurn", rng);
  if (isGameOver(state)) return;

  // Reset temporary combat status
  p.status.block = 0;
  p.status.sanityBlock = 0;
  p.status.evade = 0;
  p.status.attackModifier = 0;
  p.status.blockModifier = 0;
  p.status.unblockableAttack = false;
  p.status.damageShareWith = undefined;
  p.status.onceEvadeUsed = false;
  p.status.weaponDisabled = false;

  // Hand limit — discard non-recipe cards first when Acting is locked
  const lim = handLimit(p);
  const recipe = matchRecipe(p);
  const needed = new Set(recipe?.remaining ?? []);
  while (p.hand.length > lim) {
    let idx = p.hand.length - 1;
    if (p.actingMet && needed.size > 0) {
      const soft = p.hand.findIndex((c) => {
        if (c.defId === "potion_ingredients") return false;
        const ings = getCardDef(c.defId).ingredients;
        return !ings.some((ing) => needed.has(ing));
      });
      if (soft >= 0) idx = soft;
    }
    const [card] = p.hand.splice(idx, 1);
    if (card) {
      discardToPile(state, card);
      log(state, `${p.name} discards down to ${lim}.`, "system");
    }
  }

  // Bank Acting progress across rounds — does NOT clear actingMet
  const wasMet = p.actingMet;
  bankTurnProgress(p);
  if (!wasMet && p.actingMet) {
    const seq = getSequence(p.pathwayId, p.sequence);
    log(
      state,
      `${p.name}'s Acting Condition for ${seq.title} is locked in for future turns.`,
      "ascend",
    );
  }

  advanceTurn(state, rng);
}

function advanceTurn(state: GameState, rng: Rng) {
  if (isGameOver(state)) return;
  ensureLastStanding(state);
  if (isGameOver(state)) return;
  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % n;
    if (state.players[state.currentPlayerIndex]!.alive) break;
  }
  state.turnNumber += 1;
  runBeginPhase(state, rng);
}

export function canUseBucket(state: GameState, bucket: ActionBucket): boolean {
  return state.phase === "action" && !state.actionsUsed[bucket];
}

export function playCardFromHand(
  state: GameState,
  cardInstanceId: string,
  targetId: string | undefined,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (state.phase !== "action") return { ok: false, error: "Not action phase" };
  const idx = p.hand.findIndex((c) => c.instanceId === cardInstanceId);
  if (idx < 0) return { ok: false, error: "Card not in hand" };
  const card = p.hand[idx]!;
  const def = getCardDef(card.defId);

  if (def.type === "trap") {
    if (!canUseBucket(state, "attack"))
      return { ok: false, error: "Attack action already used" };
    if (p.trap) return { ok: false, error: "Already have a Trap" };
    p.hand.splice(idx, 1);
    p.trap = card;
    state.actionsUsed.attack = true;
    p.turnFlags.cardsPlayed += 1;
    log(state, `${p.name} sets a face-down Trap.`, "system");
    noteActing(state, p);
    return { ok: true };
  }

  // Weapons/charms/artifacts/spells/utilities use Standard
  if (!canUseBucket(state, "standard")) {
    if (!(state.extraStandard && state.extraStandard > 0)) {
      return { ok: false, error: "Standard action already used" };
    }
  }

  const tax = p.nextCardTax ?? 0;
  const totalCost = def.spCost + tax;
  if (!paySp(p, totalCost, state)) {
    return { ok: false, error: tax ? `Not enough SP (tax +${tax})` : "Not enough SP" };
  }
  if (tax) {
    p.nextCardTax = 0;
    log(state, `${p.name} pays +${tax} SP tax.`, "system");
  }

  // Spell traps
  if (def.type === "spell") {
    maybeTriggerTraps(state, p, "spell", rng);
    if (p.status.stunned) {
      // card still spent
      p.hand.splice(idx, 1);
      discardToPile(state, card);
      markStandard(state);
      log(state, `${p.name}'s Spell was interrupted by a Trap!`, "system");
      return { ok: true };
    }
  }

  p.hand.splice(idx, 1);
  p.turnFlags.cardsPlayed += 1;

  const target =
    (targetId && state.players.find((x) => x.id === targetId)) ||
    opponentsOf(state, p.id)[0];

  resolveCardEffect(state, p, card, def.effectId, target, rng);
  markStandard(state);
  noteActing(state, p);
  return { ok: true };
}

function markStandard(state: GameState) {
  const extra = state.extraStandard ?? 0;
  if (extra > 0) {
    state.extraStandard = extra - 1;
  } else {
    state.actionsUsed.standard = true;
  }
}

function resolveCardEffect(
  state: GameState,
  p: PlayerState,
  card: CardInstance,
  effectId: string,
  target: PlayerState | undefined,
  rng: Rng,
) {
  const def = getCardDef(card.defId);

  switch (effectId) {
    case "equip_weapon": {
      if (p.weapon) discardToPile(state, p.weapon);
      p.weapon = card;
      maybeTriggerTraps(state, p, "equip", rng);
      if (def.rarity === "rare") maybeTriggerTraps(state, p, "equipRare", rng);
      log(state, `${p.name} equips ${def.name}.`, "system");
      return;
    }
    case "equip_charm": {
      if (p.charms.length >= 2) {
        const old = p.charms.shift()!;
        discardToPile(state, old);
      }
      p.charms.push(card);
      maybeTriggerTraps(state, p, "equip", rng);
      if (def.rarity === "rare") maybeTriggerTraps(state, p, "equipRare", rng);
      // Apply passive block to status for clarity
      p.status.block += def.charm?.block ?? 0;
      p.status.sanityBlock += def.charm?.sanityBlock ?? 0;
      log(state, `${p.name} equips charm ${def.name}.`, "system");
      return;
    }
    case "equip_artifact": {
      if (p.artifact) discardToPile(state, p.artifact);
      p.artifact = card;
      log(state, `${p.name} unseals ${def.name}!`, "ascend");
      return;
    }
    case "flaming_spear":
      if (target) {
        const amt = target.sp === 0 ? 3 : 2;
        dealDamage(state, p, target, amt, {}, rng);
        p.turnFlags.playedSpells += 1;
      }
      discardToPile(state, card);
      return;
    case "frost_armor":
      p.status.block += 2;
      for (const o of opponentsOf(state, p.id).slice(0, 2)) {
        dealDamage(state, p, o, 1, {}, rng);
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "mental_piercing":
      if (target) {
        dealDamage(state, p, target, 2, { type: "sanity" }, rng);
        if (target.sanity < p.sanity) {
          p.turnFlags.lookedAtHand = true;
          revealPlayerHand(state, target, `Mental Piercing — ${target.name}'s Hand`);
        }
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "vampiric":
      if (target) {
        const dealt = dealDamage(state, p, target, 2, {}, rng);
        p.hp = Math.min(p.maxHp, p.hp + dealt);
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "spirit_bullet":
      if (target) {
        target.sp = Math.max(0, target.sp - 3);
        if (target.sp === 0) target.status.noPassiveSp = true;
        log(state, `${target.name} loses Spirituality.`, "damage");
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "wind_blade":
      if (target) {
        const piece = target.weapon ?? target.charms[0];
        if (piece) {
          if (target.weapon?.instanceId === piece.instanceId) target.weapon = undefined;
          else target.charms = target.charms.filter((c) => c.instanceId !== piece.instanceId);
          state.deck.push(piece); // top of their "deck" — shared deck approximation: top of main deck
          log(state, `${def.name} returns ${getCardDef(piece.defId).name} to the deck.`, "system");
        }
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "wraith_shriek":
      if (target) {
        target.status.attackModifier -= 1;
        target.status.blockModifier -= 1;
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "spirit_entanglement":
      if (target) {
        p.status.damageShareWith = target.id;
        log(state, `${p.name} entangles fate with ${target.name}.`, "system");
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "crimson_moon":
      if (target) {
        dealDamage(state, p, target, 1, { type: "sanity" }, rng);
        if (target.hand.length) {
          const c = target.hand.pop()!;
          discardToPile(state, c);
        }
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "hurricane_light": {
      const opps = opponentsOf(state, p.id).slice(0, 2);
      for (const o of opps) dealDamage(state, p, o, 1, { unblockable: true }, rng);
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    }
    case "ritual_unmaking":
      if (target && target.charms.length) {
        const c = target.charms.pop()!;
        discardToPile(state, c);
        target.sp = Math.max(0, target.sp - 1);
        log(state, `${target.name}'s charm is unmade.`, "damage");
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "spirit_world_guide":
      if (target && p.hand.length && target.hand.length) {
        const mineIdx = rng.int(p.hand.length);
        const theirsIdx = rng.int(target.hand.length);
        const mine = p.hand[mineIdx]!;
        const theirs = target.hand[theirsIdx]!;
        p.hand[mineIdx] = theirs;
        target.hand[theirsIdx] = mine;
        p.turnFlags.stoleResource = true;
        pushReveal(state, {
          kind: "steal",
          title: "Spirit World Guide — Cards Swapped",
          cards: [cardSnapshot(mine), cardSnapshot(theirs)],
          detail: `You gave ${getCardDef(mine.defId).name}; received ${getCardDef(theirs.defId).name} from ${target.name}.`,
        });
        log(
          state,
          `${p.name} swaps ${getCardDef(mine.defId).name} for ${getCardDef(theirs.defId).name} with ${target.name}.`,
          "system",
        );
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "summon_void": {
      p.turnFlags.usedDiscard = true;
      const n = alivePlayers(state).length;
      const taken: CardInstance[] = [];
      for (let i = 0; i < n; i++) {
        const c = state.discard.pop();
        if (c) taken.push(c);
      }
      alivePlayers(state).forEach((pl, i) => {
        if (taken[i]) pl.hand.push(taken[i]!);
      });
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    }
    case "bribe":
      if (target) {
        const piece = target.weapon ?? target.charms[0];
        if (piece) {
          if (target.weapon?.instanceId === piece.instanceId) target.weapon = undefined;
          else target.charms = target.charms.filter((c) => c.instanceId !== piece.instanceId);
          p.hand.push(piece);
          p.turnFlags.stoleResource = true;
          announceSteal(state, piece, target, p);
          const give = p.hand.find((c) => {
            if (c.instanceId === piece.instanceId) return false;
            const t = getCardDef(c.defId).type;
            return t === "weapon" || t === "charm";
          });
          if (give) {
            p.hand = p.hand.filter((c) => c.instanceId !== give.instanceId);
            target.hand.push(give);
            log(
              state,
              `${p.name} bribes with ${getCardDef(give.defId).name}.`,
              "system",
            );
          }
        }
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "astrology":
      if (target) {
        p.turnFlags.lookedAtHand = true;
        revealPlayerHand(state, target, `Astrology — ${target.name}'s Hand`);
        if (target.hand.length) {
          const c = target.hand.pop()!;
          discardToPile(state, c);
          pushReveal(state, {
            kind: "info",
            title: "Astrology — Forced Discard",
            cards: [cardSnapshot(c)],
            detail: `${target.name} discards ${getCardDef(c.defId).name}.`,
          });
        }
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "rust_ruin":
      if (target?.weapon) {
        target.status.weaponDisabled = true;
        log(state, `${target.name}'s weapon rusts to uselessness.`, "system");
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "lightning_storm":
      for (const pl of state.players) {
        if (pl.weapon) {
          discardToPile(state, pl.weapon);
          pl.weapon = undefined;
        }
        for (const c of pl.charms) discardToPile(state, c);
        pl.charms = [];
      }
      dealDamage(state, p, p, 2, { unblockable: true }, rng);
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "errors_theft":
      if (target) {
        const piece = target.weapon ?? target.charms[0];
        if (piece) {
          if (target.weapon?.instanceId === piece.instanceId) target.weapon = undefined;
          else target.charms = target.charms.filter((c) => c.instanceId !== piece.instanceId);
          p.hand.push(piece);
          p.turnFlags.stoleResource = true;
          announceSteal(state, piece, target, p);
        } else {
          log(state, `${target.name} has no Weapon or Charm to steal.`, "system");
        }
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "steal_thoughts":
      if (target) {
        const tmp = p.hand;
        p.hand = target.hand;
        target.hand = tmp;
        p.turnFlags.stoleResource = true;
        pushReveal(state, {
          kind: "steal",
          title: "Steal Thoughts — Hands Swapped",
          cards: p.hand.map(cardSnapshot),
          detail: `You now hold ${target.name}'s former hand (${p.hand.length} cards).`,
        });
        log(state, `${p.name} swaps entire hands with ${target.name}!`, "ascend");
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "scribes_mimicry": {
      const last = [...state.discard].reverse().find((c) => getCardDef(c.defId).type === "spell");
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      if (last) {
        p.turnFlags.copiedEffect = true;
        resolveCardEffect(state, p, last, getCardDef(last.defId).effectId, target, rng);
      }
      return;
    }

    // Utilities
    case "shadow_hiding":
      p.status.evade += 1;
      p.status.unblockableAttack = true;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "paper_figurine":
      p.status.evade += 1;
      drawCards(state, p, 1, rng, true);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "holy_light_shield":
      p.status.block += 3;
      p.hp = Math.min(p.maxHp, p.hp + 1);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "potion_ingredients":
      log(state, `${p.name} prepares universal potion reagents.`, "system");
      p.turnFlags.playedUtility = true;
      // Keep in a soft "reagent" sense — discard but flag
      p.universalReagent = true;
      discardToPile(state, card);
      return;
    case "decipher_hermes":
      drawCards(state, p, 2, rng, true);
      if (p.sp < 2) p.sp = Math.min(20, p.sp + 1);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "grave_robbing": {
      p.turnFlags.usedDiscard = true;
      const c = state.discard.pop();
      if (c) p.hand.push(c);
      p.sp = Math.min(20, p.sp + 1);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "apothecary_salve": {
      const t = target ?? p;
      t.hp = Math.min(t.maxHp, t.hp + 2);
      t.status.block += 1;
      if (t.id !== p.id) p.turnFlags.healedAlly = true;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "psychiatrist_placate": {
      const t = target ?? p;
      t.sanity = Math.min(20, t.sanity + 2);
      updateMadness(t, state);
      drawCards(state, t, 1, rng, true);
      if (t.id !== p.id) p.turnFlags.healedAlly = true;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "aegis_mind":
      p.status.block += 2;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "dreamwalker_util": {
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      const top = state.deck.splice(-4);
      if (top.length) {
        const keep = top.pop()!;
        p.hand.push(keep);
        state.deck = [...top, ...state.deck];
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "deep_scavenge": {
      p.turnFlags.usedDiscard = true;
      const top = state.discard.splice(-3);
      if (top.length) {
        const keep = top.pop()!;
        p.hand.push(keep);
        state.deck.push(...top);
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "divination_card": {
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      // rearrange randomly then draw (AI-friendly)
      const top = state.deck.splice(-3);
      state.deck.push(...rng.shuffle(top));
      drawCards(state, p, 1, rng, true);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "alchemist_exchange": {
      let discarded = 0;
      while (discarded < 2 && p.hand.length) {
        const c = p.hand.pop()!;
        discardToPile(state, c);
        discarded++;
      }
      p.turnFlags.discardedVoluntarily = true;
      drawCards(state, p, 3, rng, true);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "seers_intuition":
      p.sanity = Math.min(20, p.sanity + 2);
      updateMadness(p, state);
      log(
        state,
        `${p.name} reveals: ${p.hand.map((c) => getCardDef(c.defId).name).join(", ")}`,
        "system",
      );
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "blood_sacrifice":
      dealDamage(state, p, p, 1, { unblockable: true }, rng);
      p.sp = Math.min(20, p.sp + 3);
      p.turnFlags.sacrificedHp = true;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "item_refinement": {
      const piece = p.weapon ?? p.charms[0];
      if (piece) {
        if (p.weapon?.instanceId === piece.instanceId) p.weapon = undefined;
        else p.charms = p.charms.filter((c) => c.instanceId !== piece.instanceId);
        discardToPile(state, piece);
        drawCards(state, p, 2, rng, true);
        p.sp = Math.min(20, p.sp + 1);
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "historical_projection": {
      p.turnFlags.usedDiscard = true;
      const idx = state.discard.findIndex((c) => {
        const t = getCardDef(c.defId).type;
        return t === "weapon" || t === "charm";
      });
      if (idx >= 0) {
        const [c] = state.discard.splice(idx, 1);
        if (c) {
          const d = getCardDef(c.defId);
          if (d.type === "weapon") {
            if (p.weapon) discardToPile(state, p.weapon);
            p.weapon = c;
          } else {
            if (p.charms.length >= 2) discardToPile(state, p.charms.shift()!);
            p.charms.push(c);
          }
        }
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "clockhand":
      p.sp = Math.min(20, p.sp + 2);
      state.extraStandard = (state.extraStandard ?? 0) + 1;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "miracle_wish":
      p.hp = Math.min(p.maxHp, p.hp + 3);
      p.sanity = Math.min(20, p.sanity + 3);
      updateMadness(p, state);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "sefirah_aura": {
      ensureDeck(state, rng);
      for (let i = 0; i < 2; i++) {
        if (!state.deck.length) break;
        const c = state.deck.pop()!;
        p.hand.push(c);
      }
      state.deck = rng.shuffle(state.deck);
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    default:
      discardToPile(state, card);
      log(state, `${p.name} plays ${def.name}.`, "system");
  }
}

export function performAttack(
  state: GameState,
  targetId: string,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (!canUseBucket(state, "attack")) return { ok: false, error: "Attack already used" };
  const target = state.players.find((x) => x.id === targetId);
  if (!target?.alive) return { ok: false, error: "Invalid target" };

  // Trap on attacked
  let negated = false;
  if (target.trap) {
    const td = getCardDef(target.trap.defId);
    if (td.trap?.trigger === "attacked" && target.sp >= 1) {
      maybeTriggerTraps(state, p, "attacked", rng);
      if (td.id === "mind_prison" || td.id === "shadow_snare") {
        // shadow_snare still allows attack unless evade consumed; mind_prison negates
        if (td.id === "mind_prison") negated = true;
      }
    }
  }
  if (negated) {
    state.actionsUsed.attack = true;
    return { ok: true };
  }

  let dmg = 1;
  let ranged = false;
  let melee = true;
  let unblockable = p.status.unblockableAttack;
  let ignoreBlock = 0;
  let ignoreEvade = false;
  let sanity = false;

  const w = p.weapon ? getCardDef(p.weapon.defId) : null;
  if (w?.weapon) {
    if (p.status.weaponDisabled) {
      dmg = 0;
      log(state, `${p.name}'s weapon is disabled by Rust & Ruin.`, "system");
    } else {
      dmg = w.weapon.attack;
      ranged = w.weapon.range === "ranged";
      melee = w.weapon.range === "melee";
      unblockable = unblockable || !!w.weapon.unblockable;
      ignoreBlock = w.weapon.ignoreBlock ?? 0;
      ignoreEvade = !!w.weapon.unblockable;
      sanity =
        !!w.weapon.sanityDamage ||
        p.charms.some((c) => getCardDef(c.defId).charm?.weaponSanity);
      if (w.weapon.swingSpCost && !paySp(p, w.weapon.swingSpCost, state)) {
        return { ok: false, error: "Need SP to swing" };
      }
      if (w.weapon.selfHpCost) {
        dealDamage(state, p, p, w.weapon.selfHpCost, { unblockable: true }, rng);
      }
      if (w.weapon.selfSanityCost) {
        dealDamage(state, p, p, w.weapon.selfSanityCost, {
          type: "sanity",
          unblockable: true,
        }, rng);
      }
      if (w.id === "assassins_blade" && target.status.block + charmBlock(target) === 0) {
        dmg = 2;
      }
      p.turnFlags.attackedWithWeapon = true;
    }
  }

  dmg += p.status.attackModifier;
  dmg = Math.max(0, dmg);

  const dealt = dealDamage(
    state,
    p,
    target,
    dmg,
    {
      type: sanity ? "sanity" : "hp",
      unblockable,
      ignoreEvade,
      ignoreBlock,
      ranged,
      melee,
    },
    rng,
  );

  if (dealt > 0 && w?.weapon?.kicker === "lifesteal") {
    p.hp = Math.min(p.maxHp, p.hp + 1);
  }
  if (dealt > 0 && w?.weapon?.kicker === "discard" && target.hand.length) {
    discardToPile(state, target.hand.pop()!);
  }
  if (dealt > 0 && w?.weapon?.kicker === "revealTrap" && target.trap) {
    log(state, `${target.name}'s Trap is revealed: ${getCardDef(target.trap.defId).name}`, "system");
  }

  p.status.unblockableAttack = false;
  state.actionsUsed.attack = true;
  noteActing(state, p);
  return { ok: true };
}

export function castSequenceAbility(
  state: GameState,
  targetId: string | undefined,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (!canUseBucket(state, "sequence"))
    return { ok: false, error: "Sequence action already used" };
  const seq = getSequence(p.pathwayId, p.sequence);
  if (seq.abilityCost > 0 && !paySp(p, seq.abilityCost, state))
    return { ok: false, error: "Not enough SP" };

  const target =
    (targetId && state.players.find((x) => x.id === targetId)) ||
    opponentsOf(state, p.id)[0];

  resolveAbility(state, p, seq.abilityId, target, rng);
  state.actionsUsed.sequence = true;
  p.turnFlags.cardsPlayed += 1;
  noteActing(state, p);
  return { ok: true };
}

/** Steal an active Artifact (Contention). Uses Standard action. */
export function contendArtifact(
  state: GameState,
  targetId: string,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (!canUseBucket(state, "standard"))
    return { ok: false, error: "Standard action already used" };
  const target = state.players.find((x) => x.id === targetId);
  if (!target?.alive || !target.artifact)
    return { ok: false, error: "Target has no Artifact" };
  if (p.sp < 5) return { ok: false, error: "Need 5 SP" };

  const seqDiff = target.sequence - p.sequence; // positive if target is higher Seq number... wait Seq 9 is lower rank
  // Rule: your Sequence Level must be equal or higher (lower number = higher rank)
  // Seq 5 is higher than Seq 7. So p.sequence <= target.sequence means equal or higher rank.
  const needSanity = p.sequence > target.sequence ? p.sequence - target.sequence : 0;
  if (needSanity > 0 && p.sanity < needSanity) {
    return {
      ok: false,
      error: `Need ${needSanity} Sanity to force-steal from higher Sequence`,
    };
  }

  if (!paySp(p, 5, state)) return { ok: false, error: "Need 5 SP" };
  if (needSanity > 0) {
    dealDamage(state, p, p, needSanity, { type: "sanity", unblockable: true }, rng);
  }

  if (p.artifact) discardToPile(state, p.artifact);
  p.artifact = target.artifact;
  target.artifact = undefined;
  markStandard(state);
  p.turnFlags.stoleResource = true;
  p.turnFlags.cardsPlayed += 1;
  log(state, `${p.name} contends and steals ${getCardDef(p.artifact.defId).name}!`, "ascend");
  noteActing(state, p);
  return { ok: true };
}

/** Activate equipped Artifact power (still Standard, 0 extra SP beyond equip). */
export function activateArtifactPower(
  state: GameState,
  targetId: string | undefined,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (!p.artifact) return { ok: false, error: "No Artifact equipped" };
  if (!canUseBucket(state, "standard"))
    return { ok: false, error: "Standard action already used" };
  const def = getCardDef(p.artifact.defId);
  const target =
    (targetId && state.players.find((x) => x.id === targetId)) ||
    opponentsOf(state, p.id)[0];

  switch (def.id) {
    case "groselle":
      p.lastingBlock = Math.max(p.lastingBlock ?? 0, 3);
      log(state, `${p.name} gains 3 lasting Block from Groselle's Travels.`, "heal");
      break;
    case "wishing_lamp": {
      // Choose heal 2 by default
      p.hp = Math.min(p.maxHp, p.hp + 2);
      p.turnFlags.healedHp += 2;
      log(state, `${p.name} wishes for healing.`, "heal");
      break;
    }
    case "die_probability":
      drawCards(state, p, 2, rng, true);
      break;
    case "mirror_arrodes":
      if (target) {
        const piece = target.weapon ?? target.charms[0];
        if (piece) {
          if (target.weapon?.instanceId === piece.instanceId) target.weapon = undefined;
          else target.charms = target.charms.filter((c) => c.instanceId !== piece.instanceId);
          // seize then sacrifice next begin — put in hand for now
          p.hand.push(piece);
          p.turnFlags.stoleResource = true;
        }
      }
      break;
    default:
      log(state, `${p.name} invokes ${def.name}.`, "system");
  }

  markStandard(state);
  noteActing(state, p);
  return { ok: true };
}

function resolveAbility(
  state: GameState,
  p: PlayerState,
  abilityId: string,
  target: PlayerState | undefined,
  rng: Rng,
) {
  switch (abilityId) {
    case "fool_divination":
      p.turnFlags.lookedAtDeck = true;
      p.turnFlags.lookedAtHand = true;
      ensureDeck(state, rng);
      revealDeckTop(state, 3, "Divination — Top of the Deck");
      if (target) {
        revealPlayerHand(state, target, `Divination — ${target.name}'s Hand`);
      }
      break;
    case "fool_acrobatics":
      p.status.evade += 1;
      p.turnFlags.evadedOrBlocked = true; // prepared defense counts for Acting
      break;
    case "fool_paper":
      p.status.evade += 1;
      p.turnFlags.evadedOrBlocked = true;
      p.turnFlags.playedSpells += 1;
      drawCards(state, p, 1, rng, true);
      break;
    case "error_sleight":
      if (target?.hand.length) {
        const i = rng.int(target.hand.length);
        const [c] = target.hand.splice(i, 1);
        if (c) {
          p.hand.push(c);
          p.turnFlags.cardsFromOpponent += 1;
          announceSteal(state, c, target, p);
        }
        p.turnFlags.drewExtra = true;
        p.turnFlags.stoleResource = true;
      } else {
        drawCards(state, p, 1, rng, true);
        log(state, `${p.name}'s Sleight finds nothing — draws from the deck instead.`, "system");
      }
      break;
    case "error_fraud":
      if (target) {
        const take = Math.min(2, Math.max(0, target.sp));
        target.sp -= take;
        p.sp = Math.min(20, p.sp + take);
        p.turnFlags.stoleResource = true;
        log(state, `${p.name} fraudulently drains ${take} SP.`, "system");
      }
      break;
    case "error_decrypt":
      p.turnFlags.lookedAtHand = true;
      if (target) revealPlayerHand(state, target, `Decrypt — ${target.name}'s Hand`);
      for (const pl of state.players) {
        if (pl.trap) {
          p.turnFlags.triggeredTrap = true;
          pushReveal(state, {
            kind: "trap",
            title: `Decrypt — Trap on ${pl.name}`,
            cards: [cardSnapshot(pl.trap)],
          });
        }
      }
      break;
    case "sun_courage":
      if (target) {
        target.status.attackModifier += 1;
        p.turnFlags.healedAlly = true; // buff always completes Seq 9 Acting
        log(state, `${p.name} inspires ${target.name} (+1 Attack).`, "heal");
      }
      break;
    case "sun_light":
      if (target) {
        dealDamage(state, p, target, 2, {}, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "sun_purify":
      if (target) {
        target.sanity = Math.min(20, target.sanity + 3);
        p.turnFlags.sanityRestored += 3;
        updateMadness(target, state);
        p.turnFlags.healedAlly = true;
      }
      break;
    case "tyrant_balance":
      p.status.block += 1;
      p.turnFlags.evadedOrBlocked = true;
      log(state, `${p.name} finds Balance — gains 1 Block, ignores Traps.`, "system");
      break;
    case "tyrant_rage":
      p.status.attackModifier += 2;
      p.turnFlags.sacrificedHp = true;
      dealDamage(state, p, p, 1, { unblockable: true }, rng);
      break;
    case "tyrant_shield":
      p.status.block += 3;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "tyrant_gale":
      drawCards(state, p, 2, rng, true);
      if (p.hand.length) {
        discardToPile(state, p.hand.pop()!);
        p.turnFlags.discardedVoluntarily = true;
      }
      break;
    case "tyrant_song":
      for (const o of opponentsOf(state, p.id)) {
        dealDamage(state, p, o, 2, {}, rng);
        o.sp = Math.max(0, o.sp - 1);
      }
      break;
    case "giant_mastery":
      p.status.attackModifier += 1;
      log(state, `${p.name}'s Weapon Mastery empowers the next attack.`, "system");
      break;
    case "giant_provoke":
      p.status.block += 1;
      p.turnFlags.evadedOrBlocked = true;
      p.turnFlags.forcedSkip = true; // marked a foe — Acting complete
      if (target) log(state, `${target.name} is Provoked into attacking ${p.name}.`, "system");
      break;
    case "giant_shatter":
      if (target) {
        target.status.block = 0;
        target.status.evade = 0;
        dealDamage(state, p, target, 1, {}, rng);
      }
      break;
    case "giant_dawn":
      p.status.block += 4;
      break;
    case "vis_observe":
      if (target) {
        p.turnFlags.lookedAtHand = true;
        revealPlayerHand(state, target, `Observe — ${target.name}'s Hand`);
      }
      break;
    case "vis_pierce":
      if (target) dealDamage(state, p, target, 2, { type: "sanity" }, rng);
      break;
    case "vis_placate":
      if (target) {
        target.sanity = Math.min(20, target.sanity + 3);
        p.turnFlags.sanityRestored += 3;
        updateMadness(target, state);
        p.turnFlags.healedAlly = true;
      }
      break;
    case "vis_hypnosis":
      if (target?.hand.length) {
        const i = rng.int(target.hand.length);
        const [c] = target.hand.splice(i, 1);
        if (c) discardToPile(state, c);
      }
      break;
    case "vis_nightmare":
      if (target) {
        dealDamage(state, p, target, 3, { type: "sanity" }, rng);
        target.status.skipDraw = true;
      }
      break;
    case "door_magic":
      ensureDeck(state, rng);
      if (state.deck.length) {
        p.hand.push(state.deck.shift()!);
        p.turnFlags.drewExtra = true;
      }
      break;
    case "door_trick":
      if (rng.next() > 0.5 && target) {
        dealDamage(state, p, target, 1, {}, rng);
      } else {
        p.status.block += 1;
        p.turnFlags.evadedOrBlocked = true;
      }
      p.turnFlags.playedSpells += 1;
      break;
    case "door_star":
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      {
        const top = state.deck.splice(-3);
        state.deck.push(...rng.shuffle(top));
      }
      drawCards(state, p, 1, rng, true);
      break;
    case "dark_vision":
      p.status.stunned = false;
      // Quiet night: Sequence Ability itself is a non-Weapon action
      log(state, `${p.name} watches through the night, immune to Stun.`, "system");
      break;
    case "dark_lullaby":
      if (target) {
        dealDamage(state, p, target, 1, { type: "sanity" }, rng);
        p.sanity = Math.min(20, p.sanity + 1);
        p.turnFlags.sanityRestored += 1;
        updateMadness(p, state);
      }
      break;
    case "dark_sleep":
      if (target) {
        target.status.skipAction = true;
        p.turnFlags.forcedSkip = true;
      }
      break;
    case "dark_pacify":
      if (target) {
        target.sanity = Math.min(20, target.sanity + 4);
        updateMadness(target, state);
      }
      break;
    case "death_scavenge":
      p.turnFlags.usedDiscard = true;
      if (state.discard.length) {
        const c = state.discard.pop()!;
        state.deck.unshift(c);
        log(state, `${p.name} scavenges the discard into the deck's depths.`, "system");
      } else {
        log(state, `${p.name} scavenges an empty grave — the ritual still counts.`, "system");
      }
      break;
    case "death_bury":
      if (p.hand.length) {
        discardToPile(state, p.hand.pop()!);
        p.turnFlags.discardedVoluntarily = true;
        p.hp = Math.min(p.maxHp, p.hp + 2);
        p.turnFlags.healedHp += 2;
      } else {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        p.turnFlags.healedHp += 1;
        p.turnFlags.discardedVoluntarily = true;
        log(state, `${p.name} buries nothing but still knits flesh (+1 HP).`, "heal");
      }
      break;
    case "death_seance": {
      p.turnFlags.usedDiscard = true;
      const idx = state.discard.findIndex((c) => getCardDef(c.defId).type === "utility");
      if (idx >= 0) {
        const [c] = state.discard.splice(idx, 1);
        if (c) {
          p.turnFlags.discardCardsPlayed += 1;
          resolveCardEffect(state, p, c, getCardDef(c.defId).effectId, target, rng);
        }
      } else {
        log(state, `${p.name}'s Seance finds no Utility — contact with discard still counts.`, "system");
      }
      break;
    }
    case "priest_track":
      p.turnFlags.witnessedSpellOrTrap = true;
      p.turnFlags.triggeredTrap = true;
      {
        let found = false;
        for (const pl of state.players) {
          if (pl.trap) {
            found = true;
            log(state, `${pl.name}'s Trap: ${getCardDef(pl.trap.defId).name}`, "system");
          }
        }
        if (!found) log(state, `${p.name} tracks the field — no Traps visible.`, "system");
      }
      break;
    case "priest_taunt":
      if (target) {
        const spellIdx = target.hand.findIndex((c) => getCardDef(c.defId).type === "spell");
        if (spellIdx >= 0) {
          const [c] = target.hand.splice(spellIdx, 1);
          if (c) discardToPile(state, c);
          p.turnFlags.forcedSkip = true;
        } else {
          dealDamage(state, p, target, 1, { type: "sanity", unblockable: true }, rng);
        }
      }
      break;
    case "priest_fire":
      if (target) {
        dealDamage(state, p, target, 3, { unblockable: true }, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "priest_cull":
      if (target && target.hp <= 10) dealDamage(state, p, target, 5, {}, rng);
      break;

    // —— Extra Arcana abilities ——
    case "hanged_blood":
      dealDamage(state, p, p, 1, { unblockable: true }, rng);
      p.turnFlags.sacrificedHp = true;
      p.sp = Math.min(20, p.sp + 2);
      break;
    case "hanged_whispers":
      dealDamage(state, p, p, 1, { type: "sanity", unblockable: true }, rng);
      drawCards(state, p, 2, rng, true);
      break;
    case "hanged_hide":
      p.status.evade += 1;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "hanged_flesh":
      if (target) {
        const d = dealDamage(state, p, target, 2, {}, rng);
        p.hp = Math.min(p.maxHp, p.hp + d);
        p.turnFlags.healedHp += d;
      }
      break;
    case "hanged_graze":
    case "tower_mimic":
    case "moon_channel": {
      p.turnFlags.usedDiscard = true;
      const idx = state.discard.findIndex((c) => getCardDef(c.defId).type === "spell");
      if (idx >= 0) {
        const [c] = state.discard.splice(idx, 1);
        if (c) {
          p.turnFlags.copiedEffect = true;
          p.turnFlags.discardCardsPlayed += 1;
          pushReveal(state, {
            kind: "info",
            title: "Copied Spell from Discard",
            cards: [cardSnapshot(c)],
          });
          resolveCardEffect(state, p, c, getCardDef(c.defId).effectId, target, rng);
        }
      } else log(state, "No Spell in discard to copy.", "system");
      break;
    }
    case "hanged_blade":
      if (target) {
        p.turnFlags.sacrificedHp = true;
        dealDamage(state, p, target, 6, {}, rng);
        dealDamage(state, p, p, 2, { unblockable: true }, rng);
      }
      break;
    case "hanged_bomb":
      p.turnFlags.sacrificedHp = true;
      dealDamage(state, p, p, 5, { unblockable: true }, rng);
      {
        let hits = 0;
        for (const o of opponentsOf(state, p.id)) {
          dealDamage(state, p, o, 5, {}, rng);
          hits++;
        }
        p.turnFlags.targetsHitInAction = hits;
      }
      break;
    case "hanged_corrupt":
      if (target) {
        const lost = Math.min(5, target.sp);
        target.sp -= lost;
        p.turnFlags.stoleResource = true;
        dealDamage(state, p, target, lost || 1, {}, rng);
      }
      break;
    case "hanged_degen":
      if (target) {
        target.status.block = 0;
        target.status.evade = 0;
        if (target.hp > 1) {
          const drop = target.hp - 1;
          dealDamage(state, p, target, drop, { unblockable: true }, rng);
        }
      }
      break;

    case "demoness_shadow":
      p.status.attackModifier += 2;
      log(state, `${p.name} arms Shadow Strike (+2 next Attack).`, "system");
      break;
    case "demoness_incite":
      if (target) {
        if (target.trap) {
          discardToPile(state, target.trap);
          target.trap = undefined;
          p.turnFlags.forcedSkip = true;
          log(state, `${target.name}'s Trap is discarded by Incite.`, "system");
        } else {
          dealDamage(state, p, target, 2, { type: "sanity", unblockable: true }, rng);
        }
      }
      break;
    case "demoness_flame":
      if (target) {
        dealDamage(state, p, target, 2, {}, rng);
        target.cannotHealNextBegin = true;
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "demoness_web":
      if (target) {
        target.nextCardTax = (target.nextCardTax ?? 0) + 2;
        p.turnFlags.forcedSkip = true;
        log(state, `${target.name}'s next card costs +2 SP.`, "system");
      }
      break;
    case "demoness_epidemic":
      if (target) {
        target.epidemicCurse = true;
        p.turnFlags.forcedSkip = true;
        log(state, `${target.name} is cursed with Epidemic!`, "damage");
      }
      break;
    case "demoness_plague": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        dealDamage(state, p, o, 3, {}, rng);
        dealDamage(state, p, o, 1, { type: "sanity", unblockable: true }, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "demoness_mirror":
      p.fatalSafetyHp = 10;
      p.turnFlags.evadedOrBlocked = true;
      log(state, `${p.name} prepares Mirror Substitution.`, "heal");
      break;
    case "demoness_frostfire": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        for (let i = 0; i < 2 && o.hand.length; i++) {
          const idx = rng.int(o.hand.length);
          const [c] = o.hand.splice(idx, 1);
          if (c) discardToPile(state, c);
        }
        dealDamage(state, p, o, 5, {}, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "demoness_doom": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        o.doomCurse = true;
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      log(state, `${p.name} utters Doomsday — permanent curses fall.`, "damage");
      break;
    }

    case "tower_analyze":
      p.turnFlags.lookedAtDeck = true;
      revealDeckTop(state, 3, "Analyze — Top of the Deck");
      break;
    case "tower_deduce":
    case "just_interrogate":
      if (target) {
        p.turnFlags.lookedAtHand = true;
        revealPlayerHand(state, target, `Interrogation — ${target.name}'s Hand`);
        const trapIdx = target.hand.findIndex((c) => getCardDef(c.defId).type === "trap");
        if (trapIdx >= 0) {
          const [c] = target.hand.splice(trapIdx, 1);
          if (c) {
            discardToPile(state, c);
            pushReveal(state, {
              kind: "info",
              title: "Trap Confiscated",
              cards: [cardSnapshot(c)],
              detail: `${target.name} discards ${getCardDef(c.defId).name}.`,
            });
          }
        }
      }
      break;
    case "tower_expose":
      if (target?.trap) {
        p.turnFlags.triggeredTrap = true;
        pushReveal(state, {
          kind: "trap",
          title: `Exposed Trap — ${target.name}`,
          cards: [cardSnapshot(target.trap)],
        });
        discardToPile(state, target.trap);
        target.trap = undefined;
        target.sp = Math.max(0, target.sp - 1);
      } else {
        p.turnFlags.triggeredTrap = true;
        log(state, "No Trap to expose on that target.", "system");
      }
      break;
    case "tower_create": {
      ensureDeck(state, rng);
      const seen: CardInstance[] = [];
      while (state.deck.length) {
        const c = state.deck.pop()!;
        if (getCardDef(c.defId).type === "spell") {
          p.hand.push(c);
          p.turnFlags.drewExtra = true;
          pushReveal(state, {
            kind: "info",
            title: "Spell Creation",
            cards: [cardSnapshot(c)],
            detail: `Found ${getCardDef(c.defId).name}.`,
          });
          break;
        }
        seen.push(c);
      }
      state.deck.push(...seen);
      p.turnFlags.playedSpells += 1;
      break;
    }
    case "tower_foresight":
      p.status.evade += 1;
      p.turnFlags.evadedOrBlocked = true;
      for (const o of opponentsOf(state, p.id)) {
        p.turnFlags.lookedAtHand = true;
        revealPlayerHand(state, o, `Foresight — ${o.name}`);
      }
      break;
    case "tower_omni":
    case "emperor_gag":
    case "just_prohibit":
    case "chained_bind":
    case "wheel_badroll":
      if (target) {
        target.status.skipAction = true;
        p.turnFlags.forcedSkip = true;
        log(state, `${target.name} is locked out of their next Action.`, "system");
      }
      break;
    case "tower_counter":
      p.status.evade += 1;
      p.reflectNextHit = true;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "tower_akashic":
      drawCards(state, p, 5, rng, true);
      break;

    case "wheel_premonition": {
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      const top = state.deck[state.deck.length - 1];
      if (top) {
        revealDeckTop(state, 1, "Premonition");
        if (getCardDef(top.defId).type === "trap") {
          state.deck.pop();
          discardToPile(state, top);
          log(state, "Premonition discards a Trap from the top.", "system");
        }
      }
      break;
    }
    case "wheel_calc":
    case "moon_beast":
      p.status.block += 2;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "wheel_luck": {
      const before = p.hand.length;
      drawCards(state, p, 2, rng, true);
      const drawn = p.hand.slice(before);
      if (
        drawn.length === 2 &&
        getCardDef(drawn[0]!.defId).type === getCardDef(drawn[1]!.defId).type
      ) {
        p.hp = Math.min(p.maxHp, p.hp + 3);
        p.turnFlags.healedHp += 3;
        log(state, "Stroke of Luck! Matching types — heal 3.", "heal");
      }
      pushReveal(state, {
        kind: "info",
        title: "Stroke of Luck — Drawn",
        cards: drawn.map(cardSnapshot),
      });
      break;
    }
    case "wheel_misfortune":
      if (target?.hand.length) {
        const sorted = [...target.hand].sort(
          (a, b) =>
            (getCardDef(b.defId).rarity === "rare" ? 1 : 0) -
            (getCardDef(a.defId).rarity === "rare" ? 1 : 0),
        );
        const victim = sorted[0]!;
        target.hand = target.hand.filter((c) => c.instanceId !== victim.instanceId);
        discardToPile(state, victim);
        p.turnFlags.forcedSkip = true;
        pushReveal(state, {
          kind: "info",
          title: "Misfortune — Discarded",
          cards: [cardSnapshot(victim)],
          detail: `${target.name} loses ${getCardDef(victim.defId).name}.`,
        });
      }
      break;
    case "wheel_armor":
      p.status.evade += 1;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "wheel_randomize": {
      let hits = 0;
      for (const pl of alivePlayers(state)) {
        for (const c of pl.hand) discardToPile(state, c);
        pl.hand = [];
        drawCards(state, pl, 4, rng, true);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "wheel_weave":
      drawCards(state, p, 2, rng, true);
      p.sp = 10;
      break;
    case "wheel_reboot":
      p.hp = Math.min(p.maxHp, 15);
      p.sanity = 15;
      p.turnFlags.sanityRestored += 3;
      p.turnFlags.healedHp += 5;
      updateMadness(p, state);
      break;

    case "mother_sow":
      {
        const t = target ?? p;
        t.hp = Math.min(t.maxHp, t.hp + 1);
        p.turnFlags.healedHp += 1;
        if (t.id !== p.id) p.turnFlags.healedAlly = true;
      }
      break;
    case "mother_cure":
      {
        const t = target ?? p;
        t.hp = Math.min(t.maxHp, t.hp + 3);
        t.status.stunned = false;
        t.status.skipAction = false;
        p.turnFlags.healedHp += 3;
        p.turnFlags.healedAlly = true;
      }
      break;
    case "mother_harvest": {
      const missing = Math.max(1, Math.floor((p.maxHp - p.hp) / 5) || 1);
      drawCards(state, p, missing, rng, true);
      break;
    }
    case "mother_mutate":
      if (p.hand.length) {
        discardToPile(state, p.hand.pop()!);
        p.turnFlags.discardedVoluntarily = true;
      }
      drawCards(state, p, 2, rng, true);
      break;
    case "mother_hide":
      p.status.block += 2;
      p.status.attackModifier += 1;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "mother_vitality": {
      const before = p.hp;
      p.hp += 5;
      if (p.hp > p.maxHp) {
        const over = p.hp - p.maxHp;
        p.maxHp = Math.min(p.maxHp + over, p.maxHp + 5);
        p.hp = p.maxHp;
      }
      p.turnFlags.healedHp += Math.max(0, p.hp - before);
      break;
    }
    case "mother_link":
      if (target) {
        target.hp = p.hp;
        p.turnFlags.healedAlly = true;
        log(state, `${target.name}'s HP equals ${p.name}'s (${p.hp}).`, "system");
      }
      break;
    case "mother_fecundity": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        o.drawPoison = 2;
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "mother_rebirth":
      p.hp = p.maxHp;
      p.sanity = 20;
      p.status.evade += 1;
      p.turnFlags.sanityRestored += 5;
      p.turnFlags.healedHp += 10;
      updateMadness(p, state);
      break;

    case "moon_brew": {
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      const top = state.deck[state.deck.length - 1];
      if (top) {
        revealDeckTop(state, 1, "Brew");
        if (getCardDef(top.defId).type === "utility") {
          state.deck.pop();
          p.hand.push(top);
          p.turnFlags.drewExtra = true;
          log(state, `${p.name} brews ${getCardDef(top.defId).name} into hand.`, "heal");
        }
      }
      break;
    }
    case "moon_lifesteal":
    case "abyss_feast":
      if (target) {
        const amt = abilityId === "abyss_feast" ? 4 : 2;
        const d = dealDamage(state, p, target, amt, {}, rng);
        p.hp = Math.min(p.maxHp, p.hp + (abilityId === "abyss_feast" ? 4 : d));
        p.turnFlags.healedHp += abilityId === "abyss_feast" ? 4 : d;
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "moon_toxic":
      if (p.hand.length) {
        discardToPile(state, p.hand.pop()!);
        p.turnFlags.discardedVoluntarily = true;
      }
      if (target) dealDamage(state, p, target, 3, { type: "sanity" }, rng);
      break;
    case "moon_blood":
      p.turnFlags.lookedAtDeck = true;
      revealDeckTop(state, 3, "Blood Moon");
      {
        let hits = 0;
        for (const o of opponentsOf(state, p.id)) {
          dealDamage(state, p, o, 2, {}, rng);
          hits++;
        }
        p.turnFlags.targetsHitInAction = hits;
      }
      break;
    case "moon_void":
      p.status.attackModifier += 3;
      p.status.block += 3;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "moon_undying":
      p.fatalSafetyHp = 10;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "moon_eclipse": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        for (const c of o.hand) discardToPile(state, c);
        o.hand = [];
        o.status.skipAction = true;
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      p.turnFlags.forcedSkip = true;
      break;
    }

    case "hermit_pry":
      if (target?.trap) {
        p.turnFlags.lookedAtHand = true;
        p.turnFlags.triggeredTrap = true;
        pushReveal(state, {
          kind: "trap",
          title: `Pry — ${target.name}'s Trap`,
          cards: [cardSnapshot(target.trap)],
        });
      } else if (target) {
        p.turnFlags.lookedAtHand = true;
        revealPlayerHand(state, target, `Pry — ${target.name}'s Hand`);
      }
      break;
    case "hermit_blade":
      if (target) {
        dealDamage(state, p, target, 3, {}, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "hermit_double":
      state.extraStandard = (state.extraStandard ?? 0) + 1;
      log(state, `${p.name} prepares Double Cast (+1 Standard).`, "system");
      break;
    case "hermit_copy": {
      p.turnFlags.usedDiscard = true;
      const idx = state.discard.findIndex((c) => getCardDef(c.defId).type === "spell");
      if (idx >= 0) {
        const c = state.discard[idx]!;
        // Add a fresh instance copy into hand
        const copy = { instanceId: uid("card"), defId: c.defId };
        p.hand.push(copy);
        p.turnFlags.copiedEffect = true;
        p.turnFlags.drewExtra = true;
        announceSteal(state, copy, p, p);
        pushReveal(state, {
          kind: "info",
          title: "Copy Scroll",
          cards: [cardSnapshot(copy)],
          detail: "A copy enters your hand.",
        });
      }
      break;
    }
    case "hermit_redirect":
      if (target) {
        const others = opponentsOf(state, target.id).filter((o) => o.id !== p.id);
        const victim = others[0] ?? opponentsOf(state, p.id)[0];
        if (victim) {
          dealDamage(state, target, victim, 1, {}, rng);
          p.turnFlags.forcedSkip = true;
          log(state, `${p.name} redirects strife onto ${victim.name}.`, "system");
        }
      }
      break;
    case "hermit_tale":
      drawCards(state, p, p.turnFlags.dealtDamage ? 3 : 1, rng, true);
      break;
    case "hermit_arcane":
      if (target) {
        dealDamage(state, p, target, 5, { unblockable: true }, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "hermit_library": {
      ensureDeck(state, rng);
      const top = state.deck.splice(-5);
      const keep = top.splice(-2);
      for (const c of keep) {
        p.hand.push(c);
      }
      state.deck = [...top, ...state.deck];
      p.turnFlags.drewExtra = true;
      pushReveal(state, {
        kind: "info",
        title: "Forbidden Library — Taken",
        cards: keep.map(cardSnapshot),
      });
      break;
    }
    case "hermit_overload":
      if (target) dealDamage(state, p, target, 15, { type: "sanity", unblockable: true }, rng);
      break;

    case "paragon_identify": {
      drawCards(state, p, 1, rng, true);
      const last = p.hand[p.hand.length - 1];
      if (last) {
        const d = getCardDef(last.defId);
        if (d.type === "artifact" || d.type === "utility") {
          pushReveal(state, {
            kind: "info",
            title: "Identify — Kept",
            cards: [cardSnapshot(last)],
          });
        }
      }
      break;
    }
    case "paragon_excavate": {
      p.turnFlags.usedDiscard = true;
      const idx = state.discard.findIndex((c) => {
        const t = getCardDef(c.defId).type;
        return t === "weapon" || t === "utility";
      });
      if (idx >= 0) {
        const [c] = state.discard.splice(idx, 1);
        if (c) {
          p.hand.push(c);
          p.turnFlags.drewExtra = true;
          pushReveal(state, {
            kind: "info",
            title: "Excavate",
            cards: [cardSnapshot(c)],
          });
        }
      }
      break;
    }
    case "paragon_optimize":
      p.ignoreArtifactDrawback = true;
      p.sp = Math.min(20, p.sp + 1);
      break;
    case "paragon_tinker": {
      let n = 0;
      while (n < 2 && p.hand.length) {
        discardToPile(state, p.hand.pop()!);
        n++;
      }
      p.turnFlags.discardedVoluntarily = true;
      p.status.block += 3;
      p.turnFlags.evadedOrBlocked = true;
      break;
    }
    case "paragon_chart": {
      p.turnFlags.lookedAtDeck = true;
      revealDeckTop(state, 3, "Star Chart");
      const top = state.deck.slice(-3);
      const spells = top.filter((c) => getCardDef(c.defId).type === "spell").length;
      if (target && spells > 0) {
        dealDamage(state, p, target, spells, {}, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    }
    case "paragon_catalyst":
      if (target && target.id === p.id) {
        p.hp = Math.min(p.maxHp, p.hp + 4);
        p.turnFlags.healedHp += 4;
      } else if (target) {
        dealDamage(state, p, target, 4, {}, rng);
      }
      break;
    case "paragon_deconstruct":
      if (target) {
        if (target.weapon) {
          discardToPile(state, target.weapon);
          pushReveal(state, {
            kind: "info",
            title: "Deconstructed",
            cards: [cardSnapshot(target.weapon)],
          });
          target.weapon = undefined;
          p.turnFlags.trapsDestroyed += 1;
        } else if (target.trap) {
          discardToPile(state, target.trap);
          pushReveal(state, {
            kind: "trap",
            title: "Deconstructed Trap",
            cards: [cardSnapshot(target.trap)],
          });
          target.trap = undefined;
          p.turnFlags.trapsDestroyed += 1;
          p.turnFlags.triggeredTrap = true;
        }
      }
      break;
    case "paragon_override":
      if (target?.artifact) {
        if (p.artifact) discardToPile(state, p.artifact);
        p.artifact = target.artifact;
        target.artifact = undefined;
        p.turnFlags.stoleResource = true;
        announceSteal(state, p.artifact, target, p);
      }
      break;
    case "paragon_god":
      p.maxHp += 5;
      p.hp += 5;
      p.status.attackModifier += 3;
      p.status.block += 3;
      p.turnFlags.healedAlly = true;
      p.turnFlags.evadedOrBlocked = true;
      break;

    case "chained_restraint":
      dealDamage(state, p, p, 1, { type: "sanity", unblockable: true }, rng);
      p.status.block += 2;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "chained_outburst":
      p.status.attackModifier += 2;
      dealDamage(state, p, p, 1, { type: "sanity", unblockable: true }, rng);
      p.turnFlags.sacrificedHp = true;
      break;
    case "chained_lacerate":
      if (target) {
        dealDamage(state, p, target, 2, {}, rng);
        target.epidemicCurse = true; // reuse as bleed-at-begin
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "chained_iron":
      p.status.block += 4;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "chained_possess":
      if (target?.hand.length) {
        const i = rng.int(target.hand.length);
        const [c] = target.hand.splice(i, 1);
        if (c) {
          discardToPile(state, c);
          p.turnFlags.forcedSkip = true;
          pushReveal(state, {
            kind: "info",
            title: "Possession — Discarded",
            cards: [cardSnapshot(c)],
          });
          if (getCardDef(c.defId).type === "spell") {
            dealDamage(state, p, target, 2, {}, rng);
          }
        }
      }
      break;
    case "chained_silent":
      if (target) {
        dealDamage(state, p, target, 5, { unblockable: true, ignoreEvade: true }, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "chained_cursed": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        dealDamage(state, p, o, 3, {}, rng);
        dealDamage(state, p, o, 3, { type: "sanity", unblockable: true }, rng);
        hits++;
      }
      p.hp = Math.min(p.maxHp, p.hp + 3);
      p.turnFlags.healedHp += 3;
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "chained_absolute": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        o.status.skipAction = true;
        dealDamage(state, p, o, 3, {}, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      p.turnFlags.forcedSkip = true;
      break;
    }

    case "abyss_ruthless":
      p.status.attackModifier += 1;
      break;
    case "abyss_malice":
      if (target) {
        dealDamage(state, p, target, 1, {}, rng);
        dealDamage(state, p, target, 1, { type: "sanity" }, rng);
        p.turnFlags.sanityRestored += 0;
        // swap_sanity needs sanityRestored — grant 0 heal but mark dealtSanity; soft-complete via dealtSanity+fake
        p.turnFlags.sanityRestored += 1; // malice satisfies thematic dual hit
      }
      break;
    case "abyss_mark":
      p.status.attackModifier += 2;
      log(state, `${p.name} marks prey for death (+2 Attack).`, "system");
      break;
    case "abyss_intuition":
      if (target?.trap) {
        p.turnFlags.triggeredTrap = true;
        pushReveal(state, {
          kind: "trap",
          title: `Danger Intuition — ${target.name}`,
          cards: [cardSnapshot(target.trap)],
        });
        discardToPile(state, target.trap);
        target.trap = undefined;
      } else {
        p.turnFlags.triggeredTrap = true;
        log(state, "No Trap found.", "system");
      }
      break;
    case "abyss_ignite":
      if (target) {
        dealDamage(state, p, target, 4, { type: "sanity" }, rng);
        if (target.mad) p.sp = Math.min(20, p.sp + 2);
      }
      break;
    case "abyss_corrupt_env": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        o.sp = Math.max(0, o.sp - 2);
        dealDamage(state, p, o, 2, {}, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      p.turnFlags.stoleResource = true;
      break;
    }
    case "abyss_blasphemy": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        dealDamage(state, p, o, 8, { type: "sanity", unblockable: true }, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "abyss_descent":
      if (target && target.sanity <= 5) {
        target.hp = 0;
        checkElimination(state, target, p, rng);
        p.turnFlags.dealtDamage = true;
      } else if (target) {
        log(state, `${target.name}'s Sanity is too high for Abyss Descent.`, "system");
      }
      break;

    case "emperor_loophole":
      if (target) {
        const victim =
          opponentsOf(state, target.id).find((o) => o.id !== p.id) ??
          opponentsOf(state, p.id)[0];
        if (victim) {
          dealDamage(state, target, victim, 1, {}, rng);
          p.turnFlags.forcedSkip = true;
        }
      }
      break;
    case "emperor_overrule":
      if (target) {
        target.status.block = 0;
        target.status.evade = 0;
        dealDamage(state, p, target, 1, {}, rng);
      }
      break;
    case "emperor_extort":
      if (target) {
        if (target.sp >= 2) {
          target.sp -= 2;
          p.sp = Math.min(20, p.sp + 2);
          p.turnFlags.stoleResource = true;
          log(state, `${p.name} extorts 2 SP from ${target.name}.`, "system");
        } else {
          dealDamage(state, p, target, 3, {}, rng);
          p.turnFlags.stoleResource = true;
        }
      }
      break;
    case "emperor_graft":
      p.hp = Math.min(p.maxHp, p.hp + 2);
      p.turnFlags.healedHp += 2;
      break;
    case "emperor_distort":
    case "emperor_exploit":
    case "just_verdict":
      if (target) {
        dealDamage(state, p, target, 2, {}, rng);
        p.turnFlags.playedSpells += 1;
      }
      break;
    case "emperor_seize":
      if (target) {
        for (const c of target.hand) discardToPile(state, c);
        pushReveal(state, {
          kind: "info",
          title: `Asset Seizure — ${target.name}`,
          cards: [],
          detail: `Hand discarded (${target.hand.length} was held); SP wiped.`,
        });
        target.hand = [];
        target.sp = 0;
        p.turnFlags.stoleResource = true;
      }
      break;
    case "emperor_veto":
      if (target) {
        target.status.skipAction = true;
        p.turnFlags.forcedSkip = true;
        if (target.artifact) {
          discardToPile(state, target.artifact);
          pushReveal(state, {
            kind: "info",
            title: "Veto — Artifact Destroyed",
            cards: [cardSnapshot(target.artifact)],
          });
          target.artifact = undefined;
        }
      }
      break;

    case "just_deter":
      p.status.block += 1;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "just_pierce":
      if (target) {
        dealDamage(state, p, target, 2, { type: "sanity" }, rng);
        for (const pl of state.players) {
          if (pl.trap) {
            p.turnFlags.triggeredTrap = true;
            pushReveal(state, {
              kind: "trap",
              title: `Revealed — ${pl.name}`,
              cards: [cardSnapshot(pl.trap)],
            });
            break;
          }
        }
      }
      break;
    case "just_enforce":
      for (const pl of state.players) {
        pl.status.block = 0;
        pl.status.evade = 0;
        pl.status.attackModifier = 0;
        pl.status.blockModifier = 0;
      }
      log(state, `${p.name} enforces Order — all buffs cleared.`, "system");
      break;
    case "just_confine":
      if (target) {
        target.sp = 0;
        target.status.skipDraw = true;
        p.turnFlags.stoleResource = true;
        p.turnFlags.preventedDraw = true;
      }
      break;
    case "just_equilibrium": {
      const living = alivePlayers(state);
      const sum = living.reduce((n, pl) => n + pl.hp, 0);
      const avg = Math.ceil(sum / Math.max(1, living.length));
      for (const pl of living) pl.hp = Math.min(pl.maxHp, avg);
      p.turnFlags.targetsHitInAction = living.length;
      log(state, `Equilibrium — all HP set to ${avg}.`, "system");
      break;
    }
    case "just_law":
      if (target) {
        const drop = Math.max(0, target.hp - 1);
        dealDamage(state, p, target, drop, { unblockable: true }, rng);
      }
      break;

    default:
      // Generic scaling for higher sequences not fully specialized
      if (target) {
        const seq = getSequence(p.pathwayId, p.sequence);
        const power = Math.max(1, Math.floor((10 - p.sequence) / 2) + 1);
        dealDamage(state, p, target, power, {}, rng);
        log(state, `${p.name} uses ${seq.abilityName}.`, "system");
      }
  }
}

export function attemptAscension(
  state: GameState,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (!canUseBucket(state, "sequence"))
    return { ok: false, error: "Sequence action already used" };
  if (p.sequence <= 0) return { ok: false, error: "Already Sequence 0" };

  // Sticky Acting: bank progress from prior turns OR live turn flags count.
  if (!p.actingMet && !evaluateActing(p)) {
    return {
      ok: false,
      error: "Acting Condition not met yet (progress carries across turns)",
    };
  }

  const nextSeq = p.sequence - 1;
  const next = getSequence(p.pathwayId, nextSeq);

  // Fate Siphon traps
  for (const owner of state.players) {
    if (!owner.alive || !owner.trap || owner.id === p.id) continue;
    const td = getCardDef(owner.trap.defId);
    if (td.trap?.trigger === "ascension" && owner.sp >= 1) {
      owner.sp -= 1;
      discardToPile(state, owner.trap);
      owner.trap = undefined;
      log(state, `${owner.name}'s Fate Siphon rejects the potion!`, "damage");
      state.actionsUsed.sequence = true;
      return { ok: false, error: "Ascension failed — Fate Siphon" };
    }
  }

  const recipe = matchRecipe(p);
  if (!recipe) return { ok: false, error: "Cannot Ascend further" };
  if (recipe.remaining.length > 0) {
    return {
      ok: false,
      error: `Missing ingredients: ${recipe.missingLabels.join(", ")}`,
    };
  }

  const toll = recipe.toll;
  if (p.sanity < toll) {
    return { ok: false, error: `Need ${toll} Sanity (have ${p.sanity})` };
  }

  // Discard matched ingredient cards
  for (const id of recipe.discardInstanceIds) {
    const idx = p.hand.findIndex((c) => c.instanceId === id);
    if (idx >= 0) {
      const [c] = p.hand.splice(idx, 1);
      if (c) discardToPile(state, c);
    }
  }
  if (recipe.universalUsed) p.universalReagent = false;

  dealDamage(state, p, p, toll, { type: "sanity", unblockable: true }, rng);
  p.turnFlags.drankPotion = true;
  p.sequence = nextSeq;
  state.actionsUsed.sequence = true;

  // New Sequence → clear locked Acting; must fulfill the next condition fresh.
  resetActingForNewSequence(p);

  log(
    state,
    `${p.name} Ascends to Sequence ${nextSeq} — ${next.title}! Acting Condition reset.`,
    "ascend",
  );

  if (nextSeq === 0) {
    state.winnerId = p.id;
    state.winReason = "apotheosis";
    state.phase = "gameover";
    log(state, `${p.name} achieves Apotheosis!`, "ascend");
  }

  return { ok: true };
}

export function endTurn(state: GameState, rng: Rng) {
  if (isGameOver(state)) return;
  runEndPhase(state, rng);
}

export function getRng(state: GameState): Rng {
  return createRng(state.seed + state.turnNumber * 997 + state.log.length);
}
