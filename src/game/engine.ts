import {
  bankTurnProgress,
  emptyFlags,
  evaluateActing,
  refreshActingMet,
  resetActingForNewSequence,
} from "./acting";
import { heldCards, matchRecipe } from "./ascension";
import { buildMainDeckCounts, getCardDef, playCost } from "./cards";
import { abilitySanityCost, getPathway, getSequence, pathwayCurve, spGainFor } from "./pathways";
import { scriptUniqueAbility } from "./unique-abilities";
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
  if (state.simQuiet) return;
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
    detail: `Taken from ${from.name}.`,
  });
  log(state, `${to.name} steals ${d.name} from ${from.name}!`, "ascend");
}

function detachEquipped(owner: PlayerState, card: CardInstance) {
  if (owner.weapon?.instanceId === card.instanceId) owner.weapon = undefined;
  else if (owner.artifact?.instanceId === card.instanceId) owner.artifact = undefined;
  else owner.charms = owner.charms.filter((c) => c.instanceId !== card.instanceId);
}

/** Bribe takes a common equipped piece. Error's Theft takes the highest-value one. */
function stealEquipped(
  state: GameState,
  thief: PlayerState,
  target: PlayerState,
  mode: "common" | "best",
): boolean {
  const pieces: { card: CardInstance; score: number }[] = [];
  const push = (card: CardInstance | undefined, kind: "weapon" | "charm" | "artifact") => {
    if (!card) return;
    const rare = kind === "artifact" || getCardDef(card.defId).rarity === "rare";
    let score = 0;
    if (mode === "common") {
      score = rare ? -1 : kind === "weapon" ? 2 : 1;
    } else if (kind === "weapon" && rare) score = 6;
    else if (kind === "artifact") score = 5;
    else if (kind === "charm" && rare) score = 4;
    else if (kind === "weapon") score = 2;
    else score = 1;
    if (score > 0) pieces.push({ card, score });
  };
  push(target.weapon, "weapon");
  for (const c of target.charms) push(c, "charm");
  push(target.artifact, "artifact");
  pieces.sort((a, b) => b.score - a.score);
  const pick = pieces[0]?.card;
  if (!pick) {
    log(
      state,
      mode === "common"
        ? `${target.name} has no common Weapon or Charm to bribe.`
        : `${target.name} has nothing equipped to steal.`,
      "system",
    );
    return false;
  }
  detachEquipped(target, pick);
  thief.hand.push(pick);
  thief.turnFlags.stoleResource = true;
  announceSteal(state, pick, target, thief);
  return true;
}

function log(state: GameState, text: string, tone: GameLogEntry["tone"] = "neutral") {
  if (state.simQuiet) return;
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

/** Draw one card. Drawing the last card immediately reshuffles the discard. */
function drawOne(state: GameState, rng: Rng): CardInstance | undefined {
  ensureDeck(state, rng);
  const card = state.deck.pop();
  if (card && state.deck.length === 0) ensureDeck(state, rng);
  return card;
}

export function drawCards(
  state: GameState,
  player: PlayerState,
  n: number,
  rng: Rng,
  extra = false,
) {
  for (let i = 0; i < n; i++) {
    const card = drawOne(state, rng);
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
  if (state.discard.some((c) => c.instanceId === card.instanceId)) return;
  state.deck = state.deck.filter((c) => c.instanceId !== card.instanceId);
  state.discard.push(card);
}

function cardSearchScore(p: PlayerState, defId: string): number {
  const d = getCardDef(defId);
  const recipe = matchRecipe(p);
  let s = 0;
  if (recipe && p.actingMet) {
    const bag = [...d.ingredients];
    for (const tag of recipe.remaining) {
      const at = bag.indexOf(tag);
      if (at >= 0) {
        bag.splice(at, 1);
        s += 20;
      }
    }
  }
  if (d.type === "weapon" && !p.weapon) s += 8;
  if (d.type === "trap" && !p.trap) s += 6;
  if (d.type === "charm" && p.charms.length < 2) s += 5;
  if (d.type === "spell") s += 4;
  if (d.type === "utility") s += 3;
  if (d.rarity === "rare") s += 2;
  return s;
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
  if (dtype === "hp" && target.marks?.ironBody) {
    log(state, `${target.name} is indestructible — the blow lands nowhere.`, "system");
    return 0;
  }
  if (dtype === "sanity" && target.marks?.sanityImmune) {
    log(state, `${target.name} sheds the Sanity loss.`, "system");
    return 0;
  }

  // Melee / ranged immunities
  if (opts.melee) {
    for (const c of target.charms) {
      if (getCardDef(c.defId).charm?.meleeImmune) {
        log(state, `${target.name}'s armor nullifies the melee blow.`, "system");
        return 0;
      }
    }
  }
  if (opts.ranged && !opts.unblockable && !opts.ignoreEvade) {
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
    const nullified = maybeTriggerTraps(state, target, "evade", rng);
    if (!nullified) return 0;
    log(state, `Distorted Space nullifies the Evade — the blow lands.`, "damage");
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
    if (state.simPlays && source && dmg > 0) state.simBuf = (state.simBuf ?? 0) + dmg;
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
  if (state.simPlays && source && dmg > 0) {
    state.simBuf = (state.simBuf ?? 0) + dmg;
    state.simSanityDealt = (state.simSanityDealt ?? 0) + dmg;
  }
  return dmg;
}

function updateMadness(p: PlayerState, state: GameState) {
  if (!p.alive || p.sanityBroken) {
    if (p.sanityBroken) {
      p.sanity = 0;
      p.mad = true;
    }
    return;
  }
  if (p.sanity > 0) {
    if (p.mad) {
      p.mad = false;
      log(state, `${p.name} claws back to Sanity.`, "heal");
    }
    return;
  }
  const anchored =
    !p.sanityAnchorUsed &&
    (p.status.madnessImmune ||
      p.charms.some((c) => getCardDef(c.defId).charm?.madnessImmune));
  if (anchored) {
    p.sanity = 1;
    p.sanityAnchorUsed = true;
    p.mad = false;
    log(state, `${p.name}'s Cogitation holds at 1 Sanity.`, "heal");
    return;
  }
  p.sanity = 0;
  p.mad = true;
  p.sanityBroken = true;
  log(
    state,
    `${p.name} falls to 0 Sanity and is lost. The body still strikes everyone for 1 HP until it falls.`,
    "damage",
  );
}

function checkElimination(
  state: GameState,
  target: PlayerState,
  source: PlayerState | null,
  rng: Rng,
) {
  if (target.hp > 0 || !target.alive) return;

  if (target.marks?.redirectFatalTo) {
    const other = state.players.find(
      (pl) => pl.id === target.marks?.redirectFatalTo && pl.alive && pl.id !== target.id,
    );
    target.marks.redirectFatalTo = undefined;
    if (other) {
      target.hp = 1;
      target.turnFlags.survivedFatal = true;
      log(state, `${target.name} grafts the fatal blow onto ${other.name}.`, "heal");
      dealDamage(state, target, other, 6, { unblockable: true }, rng);
      return;
    }
  }

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

  resolveMatch(state);
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

function destroyEquipped(state: GameState, actor: PlayerState, instanceId?: string) {
  if (!instanceId) return;
  if (actor.weapon?.instanceId === instanceId) {
    discardToPile(state, actor.weapon);
    actor.weapon = undefined;
    return;
  }
  const charm = actor.charms.find((c) => c.instanceId === instanceId);
  if (charm) {
    actor.charms = actor.charms.filter((c) => c.instanceId !== instanceId);
    discardToPile(state, charm);
  }
}

export function maybeTriggerTraps(
  state: GameState,
  actor: PlayerState,
  trigger: TrapTrigger,
  rng: Rng,
  meta?: { targetId?: string; equippedId?: string; skipDefIds?: string[] },
): boolean {
  if (actor.marks?.ignoreTraps) return false;
  let nullifyEvade = false;
  for (const owner of state.players) {
    if (!owner.alive || !owner.trap || owner.id === actor.id) continue;
    const def = getCardDef(owner.trap.defId);
    if (def.trap?.trigger !== trigger) continue;
    if (meta?.skipDefIds?.includes(def.id)) continue;
    if (owner.sp < 1) continue; // pay 1 SP to trigger
    owner.sp -= 1;
    const trapCard = owner.trap;
    owner.trap = undefined;
    owner.turnFlags.triggeredTrap = true;
    actor.turnFlags.triggeredTrap = true;
    log(state, `${owner.name} springs ${def.name}!`, "system");
    if (owner.marks?.trapBonus) {
      dealDamage(state, owner, actor, owner.marks.trapBonus, { unblockable: true }, rng);
      owner.marks.trapBonus = 0;
    }

    switch (trigger) {
      case "attacked":
        if (def.id === "shadow_snare") {
          owner.status.evade += 1;
          dealDamage(state, owner, actor, 1, { unblockable: true }, rng);
        } else if (def.id === "mind_prison") {
          dealDamage(state, owner, actor, 1, { type: "sanity", unblockable: true }, rng);
        }
        break;
      case "spell":
        if (def.id === "sun_flare") {
          actor.status.stunned = true;
          actor.status.fizzleSpell = true;
          log(state, `${actor.name} is Stunned — the Spell fizzles.`, "system");
        } else if (def.id === "concealment_boundary") {
          actor.status.fizzleSpell = true;
          dealDamage(state, owner, actor, 1, { unblockable: true }, rng);
          log(state, `${def.name} negates ${actor.name}'s Spell or Utility.`, "system");
        }
        break;
      case "equip":
        if (def.id === "grafted_chains") {
          destroyEquipped(state, actor, meta?.equippedId);
          actor.sp = Math.max(0, actor.sp - 1);
          log(state, `${actor.name}'s equipment is discarded and they lose 1 SP.`, "damage");
        }
        break;
      case "equipRare":
        if (def.id === "sefirah_rejection") {
          destroyEquipped(state, actor, meta?.equippedId);
          dealDamage(state, owner, actor, 2, { unblockable: true }, rng);
          log(state, `${def.name} destroys the Rare and strikes for 2.`, "damage");
        }
        break;
      case "draw2":
        dealDamage(state, owner, actor, 2, { type: "sanity" }, rng);
        break;
      case "gainSp": {
        const steal = Math.min(2, actor.sp);
        actor.sp -= steal;
        owner.sp = Math.min(20, owner.sp + steal);
        log(state, `${owner.name} siphons ${steal} SP.`, "damage");
        break;
      }
      case "evade":
        if (def.id === "distorted_space") nullifyEvade = true;
        dealDamage(state, owner, actor, 1, { unblockable: true }, rng);
        break;
      case "endTurn": {
        for (const c of actor.hand) discardToPile(state, c);
        actor.hand = [];
        drawCards(state, actor, 3, rng, true);
        log(state, `${actor.name}'s hand loops — discarded, then drew 3.`, "system");
        break;
      }
      case "ascension":
        break;
      default:
        break;
    }
    discardToPile(state, trapCard);
  }
  return nullifyEvade;
}

export function createGame(opts: {
  humanPathwayId: string;
  aiPathwayIds: string[];
  seed?: number;
  humanName?: string;
  /** Players start concealed. The deck stays the same 78 cards. */
  arcanaConcealment?: boolean;
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
      revealed: opts.arcanaConcealment ? false : undefined,
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
    potionDrunk: false,
    turnNumber: 1,
    // Seed as "taken" so the opening Begin does not grant free recovery.
    cycleDamage: Object.fromEntries(
      players.map((p) => [p.id, { hpTaken: true, sanityTaken: true }]),
    ),
    log: [],
    reveals: [],
    seed,
    arcanaConcealment: !!opts.arcanaConcealment,
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

/**
 * A sanity-broken body is still alive and still hitting. They cannot win.
 * The match ends when one contender is the only one left alive, or when no contender remains.
 */
function resolveMatch(state: GameState) {
  if (isGameOver(state)) return;
  const living = alivePlayers(state);
  const racing = living.filter((p) => !p.sanityBroken);
  if (living.length === 0) {
    state.phase = "gameover";
    log(state, "All have fallen into the fog…", "system");
    return;
  }
  if (racing.length === 0) {
    state.phase = "gameover";
    state.winReason = "madness";
    state.winnerId = undefined;
    log(state, "No contender remains. Madness takes the board.", "system");
    return;
  }
  if (racing.length === 1 && living.length === 1) {
    state.winnerId = racing[0]!.id;
    state.winReason = "lastStanding";
    state.phase = "gameover";
    log(state, `${racing[0]!.name} is the Last One Standing!`, "ascend");
  }
}

/** If only one (or zero) living players remain, lock the win immediately. */
function ensureLastStanding(state: GameState) {
  resolveMatch(state);
}

export function runBeginPhase(state: GameState, rng: Rng) {
  if (isGameOver(state)) return;
  const p = currentPlayer(state);
  if (!p.alive) {
    advanceTurn(state, rng);
    return;
  }

  if (p.sanityBroken) {
    log(state, `${p.name} is lost. The body deals 1 HP to everyone.`, "damage");
    for (const t of alivePlayers(state)) {
      if (t.id === p.id) continue;
      dealDamage(state, p, t, 1, { unblockable: true }, rng);
      if (isGameOver(state)) return;
    }
    if (p.alive) {
      dealDamage(state, p, p, 1, { unblockable: true }, rng);
      if (isGameOver(state)) return;
    }
    resolveMatch(state);
    if (isGameOver(state)) return;
    runEndPhase(state, rng);
    return;
  }

  state.phase = "begin";
  if (p.marks) {
    p.marks.ironBody = false;
    p.marks.sanityImmune = false;
    p.marks.redirectFatalTo = undefined;
    p.marks.ignoreHandLimit = false;
    p.marks.untouchable = false;
    p.marks.ignoreBlockNext = false;
    p.marks.echoNextCard = false;
  }
  // Turn-local flags reset; Acting bank + actingMet persist until Ascension.
  p.turnFlags = emptyFlags();
  state.actionsUsed = { standard: false, sequence: false, attack: false };
  state.extraStandard = 0;
  state.potionDrunk = false;

  // Groselle-style lasting Block expires at the start of your next Begin
  if ((p.lastingBlock ?? 0) > 0) {
    log(state, `${p.name}'s lasting Block fades with the new dawn.`, "system");
    p.lastingBlock = 0;
  }

  // Ongoing curses
  if (p.beginBleed) {
    p.beginBleed = false;
    dealDamage(state, null, p, 1, { unblockable: true }, rng);
    log(state, `${p.name} bleeds from Lacerate.`, "damage");
    if (isGameOver(state)) return;
  }
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
  p.requiemUsed = false;

  // Lingering effects last until the source player's next Begin.
  for (const pl of state.players) {
    if (pl.rustSourceId === p.id) {
      pl.rustSourceId = undefined;
      pl.status.weaponDisabled = false;
    }
    if (pl.shriekSourceId === p.id) {
      pl.shriekSourceId = undefined;
      pl.status.attackModifier = 0;
      pl.status.blockModifier = 0;
    }
  }
  if (p.shareSourceId === p.id) {
    p.shareSourceId = undefined;
    p.status.damageShareWith = undefined;
  }

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
  const blockedHeal = !!p.cannotHealNextBegin;
  if (p.cannotHealNextBegin) p.cannotHealNextBegin = false;
  const grantHp = (amount: number, why: string) => {
    if (blockedHeal || amount <= 0) return;
    const thiefId = p.marks?.stealHealFor;
    if (thiefId) {
      p.marks!.stealHealFor = undefined;
      const thief = state.players.find((pl) => pl.id === thiefId && pl.alive);
      if (thief) {
        thief.hp = Math.min(thief.maxHp, thief.hp + amount);
        log(state, `${thief.name} steals ${p.name}'s heal (${amount} HP).`, "heal");
        return;
      }
    }
    p.hp = Math.min(p.maxHp, p.hp + amount);
    log(state, why, "heal");
  };
  if (!cycle.hpTaken) grantHp(1, `${p.name} recovers 1 HP (no HP damage last cycle).`);
  if (!cycle.sanityTaken) {
    p.sanity = Math.min(20, p.sanity + 1);
    updateMadness(p, state);
    log(state, `${p.name} steadies 1 Sanity (no Sanity damage last cycle).`, "heal");
  }
  if (!blockedHeal && p.sequence <= 6 && p.hp < p.maxHp) {
    grantHp(1, `${p.name}'s deeper Sequence knits 1 HP.`);
  }
  if (p.pathwayId === "mother" && p.hp <= 10) {
    grantHp(2, `${p.name}'s blood answers the wound (+2 HP).`);
  }
  state.cycleDamage[p.id] = { hpTaken: false, sanityTaken: false };

  // Always generate SP from Pathway Sequence (Spirit Bullet may still tax via status).
  {
    let gain = spGainFor(p.pathwayId, p.sequence);
    if (p.status.noPassiveSp) {
      gain = 0;
      log(state, `${p.name} generates no passive SP (Spirit Bullet).`, "system");
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

  // Reset temporary combat status. Lingering debuffs survive until their source's Begin.
  p.status.block = 0;
  p.status.sanityBlock = 0;
  p.status.evade = 0;
  p.status.unblockableAttack = false;
  if (!p.shriekSourceId) {
    p.status.attackModifier = 0;
    p.status.blockModifier = 0;
  }
  if (!p.shareSourceId) p.status.damageShareWith = undefined;
  p.status.onceEvadeUsed = false;
  if (!p.rustSourceId) p.status.weaponDisabled = false;

  trimHand(state, p);
  if (p.marks) {
    p.marks.ignoreTraps = false;
    p.marks.spellLock = false;
    p.marks.negateNextSpell = false;
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

  if (p.marks?.extraTurn && p.alive && !isGameOver(state)) {
    p.marks.extraTurn = false;
    log(state, `${p.name} takes the extra turn.`, "system");
    runBeginPhase(state, rng);
    return;
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

/** Drop cards that are not paying the current potion once the hand is over its limit. */
function trimHand(state: GameState, p: PlayerState) {
  if (p.marks?.ignoreHandLimit) return;
  const lim = handLimit(p);
  const recipe = matchRecipe(p);
  const keep = new Set(recipe?.discardInstanceIds ?? []);
  while (p.hand.length > lim) {
    let idx = p.hand.findIndex((c) => !keep.has(c.instanceId));
    if (idx < 0) idx = p.hand.length - 1;
    const [card] = p.hand.splice(idx, 1);
    if (card) {
      discardToPile(state, card);
      log(state, `${p.name} sets aside a card to stay at ${lim}.`, "system");
    }
  }
}

/** Spend the Standard action to draw. Cards are separate: play as many as Spirituality allows. */
export function drawAsStandard(state: GameState, rng: Rng): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (p.sanityBroken) return { ok: false, error: "Lost to Madness" };
  if (!canUseBucket(state, "standard")) return { ok: false, error: "Standard action already used" };
  const before = p.hand.length;
  drawCards(state, p, 1, rng, true);
  if (p.hand.length === before) return { ok: false, error: "Nothing left to draw" };
  trimHand(state, p);
  state.actionsUsed.standard = true;
  log(state, `${p.name} spends the Standard action to draw.`, "system");
  noteActing(state, p);
  return { ok: true };
}

export function playCardFromHand(
  state: GameState,
  cardInstanceId: string,
  targetId: string | undefined,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (p.sanityBroken) return { ok: false, error: "Lost to Madness" };
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
    if (state.arcanaConcealment && def.rarity === "rare") {
      const foe = opponentsOf(state, p.id)[0];
      if (foe) revealBoard(state, p, foe);
    }
    noteActing(state, p);
    return { ok: true };
  }

  if (p.marks?.spellLock && (def.type === "spell" || def.type === "weapon")) {
    return { ok: false, error: "Spells and weapons are locked this turn" };
  }
  if (targetId) {
    const aimed = state.players.find((x) => x.id === targetId);
    if (aimed && aimed.id !== p.id && aimed.marks?.untouchable && (def.type === "spell" || def.type === "weapon")) {
      return { ok: false, error: `${aimed.name} cannot be targeted` };
    }
  }

  const tax = p.nextCardTax ?? 0;
  const printed = card.free ? 0 : playCost(def, p.sequence);
  const totalCost = printed + tax;
  if (!paySp(p, totalCost, state)) {
    return { ok: false, error: tax ? `Not enough SP (tax +${tax})` : "Not enough SP" };
  }
  if (tax) {
    p.nextCardTax = 0;
    log(state, `${p.name} pays +${tax} SP tax.`, "system");
  }

  // Spell / Utility traps (Sun Flare is spells only; Concealment hits both)
  if (def.type === "spell" || def.type === "utility") {
    maybeTriggerTraps(state, p, "spell", rng, {
      skipDefIds: def.type === "utility" ? ["sun_flare"] : undefined,
    });
    if (p.status.stunned || p.status.fizzleSpell) {
      p.status.fizzleSpell = false;
      p.hand.splice(idx, 1);
      discardToPile(state, card);
      if (state.simPlays) {
        state.simPlays.push({
          defId: def.id,
          playerId: p.id,
          pathwayId: p.pathwayId,
          turn: state.turnNumber,
          damage: state.simBuf ?? 0,
        });
        state.simBuf = 0;
      }
      log(state, `${p.name}'s ${def.type} was negated by a Trap.`, "system");
      return { ok: true };
    }
  }

  p.hand.splice(idx, 1);
  p.turnFlags.cardsPlayed += 1;
  state.simBuf = 0;

  const target =
    (targetId && state.players.find((x) => x.id === targetId)) ||
    opponentsOf(state, p.id)[0];

  if (
    target &&
    target.id !== p.id &&
    target.marks?.negateNextSpell &&
    (def.type === "spell" || def.type === "utility")
  ) {
    target.marks.negateNextSpell = false;
    discardToPile(state, card);
    log(state, `${target.name} notarizes ${def.name} away.`, "system");
    noteActing(state, p);
    return { ok: true };
  }

  resolveCardEffect(state, p, card, def.effectId, target, rng);
  if (p.marks?.echoNextCard) {
    p.marks.echoNextCard = false;
    resolveCardEffect(state, p, card, def.effectId, target, rng, 1);
    log(state, `${def.name} resolves a second time.`, "system");
  }
  if (card.free) card.free = false;
  if (state.arcanaConcealment && def.rarity === "rare") {
    const foe =
      target && target.id !== p.id && target.alive ? target : opponentsOf(state, p.id)[0];
    if (foe) revealBoard(state, p, foe);
  }
  noteActing(state, p);
  if (state.simPlays) {
    state.simPlays.push({
      defId: def.id,
      playerId: p.id,
      pathwayId: p.pathwayId,
      turn: state.turnNumber,
      damage: state.simBuf ?? 0,
    });
    state.simBuf = 0;
  }
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

/** Open a concealed player's board. The actor stays concealed. */
function revealBoard(state: GameState, actor: PlayerState, target: PlayerState) {
  const already = !!target.revealed;
  target.revealed = true;
  const board = [
    ...target.hand,
    ...(target.trap ? [target.trap] : []),
    ...(target.weapon ? [target.weapon] : []),
    ...(target.artifact ? [target.artifact] : []),
    ...target.charms,
  ];
  pushReveal(state, {
    kind: "hand",
    title: already ? `${target.name}'s board` : `${target.name} is exposed`,
    subjectName: target.name,
    cards: board.map(cardSnapshot),
    detail: already
      ? "Already exposed. Hand, trap, and equipment are shown."
      : "Direct attacks may target them. Attacking them exposes you. Abilities and items are unchanged.",
  });
  const selfNote = actor.revealed ? "" : ` ${actor.name} stays concealed.`;
  log(
    state,
    already
      ? `${actor.name} reads ${target.name}'s board again.`
      : `${actor.name} exposes ${target.name}.${selfNote}`,
    "system",
  );
}

function resolveCardEffect(
  state: GameState,
  p: PlayerState,
  card: CardInstance,
  effectId: string,
  target: PlayerState | undefined,
  rng: Rng,
  depth = 0,
) {
  const def = getCardDef(card.defId);

  switch (effectId) {
    case "equip_weapon": {
      if (p.weapon) discardToPile(state, p.weapon);
      p.weapon = card;
      maybeTriggerTraps(state, p, "equip", rng, { equippedId: card.instanceId });
      if (def.rarity === "rare") {
        maybeTriggerTraps(state, p, "equipRare", rng, { equippedId: card.instanceId });
      }
      log(state, `${p.name} equips ${def.name}.`, "system");
      return;
    }
    case "equip_charm": {
      if (p.charms.length >= 2) {
        const old = p.charms.shift()!;
        discardToPile(state, old);
      }
      p.charms.push(card);
      maybeTriggerTraps(state, p, "equip", rng, { equippedId: card.instanceId });
      if (def.rarity === "rare") {
        maybeTriggerTraps(state, p, "equipRare", rng, { equippedId: card.instanceId });
      }
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
        target.shriekSourceId = p.id;
        log(state, `${target.name} is shrouded until ${p.name}'s next Begin (−1 Attack, −1 Block).`, "system");
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "spirit_entanglement":
      if (target) {
        dealDamage(state, p, target, 2, {}, rng);
        p.status.damageShareWith = target.id;
        p.shareSourceId = p.id;
        log(state, `${p.name} entangles fate with ${target.name} until their next Begin.`, "system");
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
        let mineIdx = 0;
        let theirsIdx = 0;
        for (let i = 1; i < p.hand.length; i++) {
          if (cardSearchScore(p, p.hand[i]!.defId) < cardSearchScore(p, p.hand[mineIdx]!.defId)) {
            mineIdx = i;
          }
        }
        for (let i = 1; i < target.hand.length; i++) {
          if (
            cardSearchScore(p, target.hand[i]!.defId) > cardSearchScore(p, target.hand[theirsIdx]!.defId)
          ) {
            theirsIdx = i;
          }
        }
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
      if (target) stealEquipped(state, p, target, "common");
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
        dealDamage(state, p, target, 2, { type: "sanity" }, rng);
      }
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      return;
    case "rust_ruin":
      if (target?.weapon) {
        target.status.weaponDisabled = true;
        target.rustSourceId = p.id;
        log(state, `${target.name}'s weapon deals 0 until ${p.name}'s next Begin.`, "system");
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
      if (target) stealEquipped(state, p, target, "best");
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
      p.turnFlags.playedSpells += 1;
      discardToPile(state, card);
      // A mimicry must not replay another mimicry. Two of them otherwise call each other forever.
      if (depth > 0) return;
      const last = [...state.discard].reverse().find(
        (c) =>
          c.instanceId !== card.instanceId &&
          c.defId !== "scribes_mimicry" &&
          getCardDef(c.defId).type === "spell",
      );
      if (last) {
        p.turnFlags.copiedEffect = true;
        resolveCardEffect(state, p, last, getCardDef(last.defId).effectId, target, rng, depth + 1);
      }
      return;
    }

    // Utilities
    case "shadow_hiding":
      p.status.evade += 1;
      p.status.block += 2;
      p.status.unblockableAttack = true;
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "paper_figurine":
      p.status.evade += 1;
      drawCards(state, p, 2, rng, true);
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
      drawCards(state, p, 1, rng, true);
      p.status.block += 1;
      p.turnFlags.evadedOrBlocked = true;
      p.turnFlags.playedUtility = true;
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
      if (target?.id === p.id) {
        p.status.sanityBlock += 2;
        log(state, `${p.name} shields their mind (+2 Sanity Block).`, "heal");
      } else {
        p.status.block += 2;
        log(state, `${p.name} raises Aegis (+2 Block).`, "heal");
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    case "dreamwalker_util": {
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      const top = state.deck.splice(-4);
      if (top.length) {
        const ranked = [...top].sort(
          (a, b) => cardSearchScore(p, b.defId) - cardSearchScore(p, a.defId),
        );
        const keep = ranked[0]!;
        const rest = top.filter((c) => c.instanceId !== keep.instanceId);
        p.hand.push(keep);
        state.deck = [...rest, ...state.deck];
        pushReveal(state, {
          kind: "deck",
          title: "Dreamwalker — Top 4",
          cards: top.map(cardSnapshot),
          detail: `Kept ${getCardDef(keep.defId).name}. The rest go to the bottom.`,
        });
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "deep_scavenge": {
      p.turnFlags.usedDiscard = true;
      const top = state.discard.splice(-3);
      if (top.length) {
        const ranked = [...top].sort(
          (a, b) => cardSearchScore(p, b.defId) - cardSearchScore(p, a.defId),
        );
        const kept = ranked.slice(0, Math.min(2, ranked.length));
        const keptIds = new Set(kept.map((c) => c.instanceId));
        const rest = top.filter((c) => !keptIds.has(c.instanceId));
        for (const c of kept) p.hand.push(c);
        state.deck.push(...rest);
        pushReveal(state, {
          kind: "deck",
          title: "Deep Scavenge — Discard",
          cards: top.map(cardSnapshot),
          detail: `Kept ${kept.map((c) => getCardDef(c.defId).name).join(" and ")}. The rest return to the top of the deck.`,
        });
      }
      p.turnFlags.playedUtility = true;
      discardToPile(state, card);
      return;
    }
    case "divination_card": {
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      const top = state.deck.splice(-3);
      const ranked = [...top].sort(
        (a, b) => cardSearchScore(p, b.defId) - cardSearchScore(p, a.defId),
      );
      state.deck.push(...ranked.reverse());
      pushReveal(state, {
        kind: "deck",
        title: "Divination — Rearranged",
        cards: top.map(cardSnapshot),
        detail: ranked[0]
          ? `${getCardDef(ranked[0].defId).name} set on top, then drawn.`
          : "The deck is thin.",
      });
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
      let idx = -1;
      for (let i = state.discard.length - 1; i >= 0; i--) {
        const t = getCardDef(state.discard[i]!.defId).type;
        if (t === "weapon" || t === "charm") {
          idx = i;
          break;
        }
      }
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
          pushReveal(state, {
            kind: "info",
            title: "Historical Projection",
            cards: [cardSnapshot(c)],
            detail: `Equipped ${d.name} from the discard for 0 SP.`,
          });
          log(state, `${p.name} projects ${d.name} from history.`, "system");
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
      const ranked = [...state.deck].sort(
        (a, b) => cardSearchScore(p, b.defId) - cardSearchScore(p, a.defId),
      );
      const take = ranked.slice(0, 2);
      const ids = new Set(take.map((c) => c.instanceId));
      state.deck = rng.shuffle(state.deck.filter((c) => !ids.has(c.instanceId)));
      for (const c of take) p.hand.push(c);
      if (take.length) {
        pushReveal(state, {
          kind: "deck",
          title: "Sefirah Castle's Aura — Searched",
          cards: take.map(cardSnapshot),
          detail: "Two cards pulled from the deck. The rest are shuffled.",
        });
      }
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
  if (p.sanityBroken) return { ok: false, error: "Lost to Madness" };
  if (!canUseBucket(state, "attack")) return { ok: false, error: "Attack already used" };
  const target = state.players.find((x) => x.id === targetId);
  if (!target?.alive) return { ok: false, error: "Invalid target" };
  if (target.marks?.untouchable) return { ok: false, error: `${target.name} cannot be targeted` };
  if (state.arcanaConcealment && !target.revealed) {
    return { ok: false, error: "That Beyonder is still concealed" };
  }
  if (state.arcanaConcealment && !p.revealed) {
    p.revealed = true;
    log(state, `${p.name} attacks ${target.name} and steps out of concealment.`, "system");
  }

  const armed = p.weapon && !p.status.weaponDisabled ? getCardDef(p.weapon.defId) : null;
  const weaponStrike = armed?.weapon?.attack ?? 0;
  if (weaponStrike + p.status.attackModifier <= 0 && !p.status.unblockableAttack) {
    return { ok: false, error: "Nothing to strike with" };
  }
  const ignoreTraps = !!armed?.weapon?.ignoreTrap;
  // Trap on attacked (Poisoned Revolver ignores traps)
  let negated = false;
  if (!ignoreTraps && target.trap) {
    const td = getCardDef(target.trap.defId);
    if (td.trap?.trigger === "attacked" && target.sp >= 1) {
      maybeTriggerTraps(state, p, "attacked", rng);
      if (td.id === "mind_prison") negated = true;
    }
  }
  if (negated) {
    state.actionsUsed.attack = true;
    return { ok: true };
  }

  let dmg = 0;
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
      sanity = !!w.weapon.sanityDamage;
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
      if (w.id === "assassins_blade") {
        const blk =
          target.status.block +
          (target.lastingBlock ?? 0) +
          charmBlock(target) +
          target.status.blockModifier;
        if (blk <= 0) dmg = 2;
      }
      p.turnFlags.attackedWithWeapon = true;
    }
  }

  dmg += p.status.attackModifier;
  dmg = Math.max(0, dmg);
  if (p.marks?.ignoreBlockNext) {
    p.marks.ignoreBlockNext = false;
    ignoreBlock = 99;
    ignoreEvade = true;
    unblockable = true;
  }

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

  if (
    dealt > 0 &&
    !sanity &&
    w?.weapon &&
    p.charms.some((c) => getCardDef(c.defId).charm?.weaponSanity)
  ) {
    dealDamage(state, p, target, 1, { type: "sanity", unblockable: true }, rng);
  }
  if (dealt > 0 && w?.weapon?.kicker === "lifesteal") {
    p.hp = Math.min(p.maxHp, p.hp + 1);
  }
  if (dealt > 0 && w?.weapon?.kicker === "discard" && target.hand.length) {
    discardToPile(state, target.hand.pop()!);
  }
  if (dealt > 0 && w?.weapon?.kicker === "revealTrap" && target.trap) {
    const td = getCardDef(target.trap.defId);
    pushReveal(state, {
      kind: "trap",
      title: `Unshadowed Spear — ${target.name}'s Trap`,
      cards: [cardSnapshot(target.trap)],
      detail: td.text,
    });
    log(state, `${target.name}'s Trap is revealed: ${td.name}`, "system");
  }

  p.status.unblockableAttack = false;
  state.actionsUsed.attack = true;
  if (state.simPlays) {
    state.simAttacks = (state.simAttacks ?? 0) + 1;
    if (!armed?.weapon) state.simUnarmed = (state.simUnarmed ?? 0) + 1;
    if (!sanity) state.simHpDealt = (state.simHpDealt ?? 0) + dealt;
  }
  noteActing(state, p);
  if (state.simPlays && p.weapon && !p.status.weaponDisabled) {
    state.simPlays.push({
      defId: p.weapon.defId,
      playerId: p.id,
      pathwayId: p.pathwayId,
      turn: state.turnNumber,
      damage: dealt,
      swing: true,
    });
  }
  return { ok: true };
}

export function castSequenceAbility(
  state: GameState,
  targetId: string | undefined,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (p.sanityBroken) return { ok: false, error: "Lost to Madness" };
  if (!canUseBucket(state, "sequence"))
    return { ok: false, error: "Sequence action already used" };
  const seq = getSequence(p.pathwayId, p.sequence);
  const sanityCost = abilitySanityCost(p.sequence);
  if (p.sanity < sanityCost) return { ok: false, error: "Not enough Sanity" };
  if (sanityCost > 0) {
    p.sanity -= sanityCost;
    updateMadness(p, state);
    log(state, `${p.name} pays ${sanityCost} Sanity to cast ${seq.abilityName}.`, "system");
  }

  const target =
    (targetId && state.players.find((x) => x.id === targetId)) ||
    opponentsOf(state, p.id)[0];

  resolveAbility(state, p, seq.abilityId, target, rng);
  if (state.simPlays) state.simAbilities = (state.simAbilities ?? 0) + 1;
  const curveNow = pathwayCurve(p.pathwayId);
  if (curveNow === "late" && p.sequence <= 6) drawCards(state, p, 1, rng, true);
  if (curveNow === "mid" && p.sequence <= 6 && p.sequence >= 4) drawCards(state, p, 1, rng, true);
  state.actionsUsed.sequence = true;
  p.turnFlags.cardsPlayed += 1;
  noteActing(state, p);
  // The cast is the Acting for this Sequence, even when the written checklist
  // asks for a board state a duel never produces.
  if (!p.actingMet && p.sequence > 0) {
    p.actingMet = true;
    log(
      state,
      `${p.name} fulfills the Acting Condition for ${seq.title} by casting ${seq.abilityName}.`,
      "ascend",
    );
  }
  return { ok: true };
}

/** Steal an active Artifact (Contention). Uses Standard action. */
export function contendArtifact(
  state: GameState,
  targetId: string,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (p.sanityBroken) return { ok: false, error: "Lost to Madness" };
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
/** Destroy Requiem Charm to heal 1. Free, once per turn. */
export function sacrificeRequiem(state: GameState): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (state.phase !== "action") return { ok: false, error: "Not your action" };
  if (p.requiemUsed) return { ok: false, error: "Requiem already used this turn" };
  const idx = p.charms.findIndex((c) => c.defId === "requiem_charm");
  if (idx < 0) return { ok: false, error: "No Requiem Charm" };
  const [c] = p.charms.splice(idx, 1);
  if (c) discardToPile(state, c);
  p.requiemUsed = true;
  p.hp = Math.min(p.maxHp, p.hp + 3);
  log(state, `${p.name} shatters Requiem Charm to heal 3.`, "heal");
  return { ok: true };
}

export function activateArtifactPower(
  state: GameState,
  targetId: string | undefined,
  rng: Rng,
  wish?: "hp" | "sanity" | "sp",
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
      const mode =
        wish ??
        (p.maxHp - p.hp >= 2 ? "hp" : 20 - p.sanity >= 2 ? "sanity" : "sp");
      if (mode === "sanity") {
        p.sanity = Math.min(20, p.sanity + 2);
        updateMadness(p, state);
        log(state, `${p.name} wishes for 2 Sanity.`, "heal");
      } else if (mode === "sp") {
        p.sp = Math.min(20, p.sp + 3);
        log(state, `${p.name} wishes for 3 SP.`, "system");
      } else {
        p.hp = Math.min(p.maxHp, p.hp + 2);
        p.turnFlags.healedHp += 2;
        log(state, `${p.name} wishes for 2 HP.`, "heal");
      }
      break;
    }
    case "die_probability": {
      const drawn: CardInstance[] = [];
      for (let i = 0; i < 2; i++) {
        const c = drawOne(state, rng);
        if (!c) break;
        p.hand.push(c);
        drawn.push(c);
      }
      p.turnFlags.drewExtra = true;
      const equip = drawn.find((c) => {
        const t = getCardDef(c.defId).type;
        return t === "weapon" || t === "charm";
      });
      if (equip) {
        const d = getCardDef(equip.defId);
        p.hand = p.hand.filter((c) => c.instanceId !== equip.instanceId);
        if (d.type === "weapon") {
          if (p.weapon) discardToPile(state, p.weapon);
          p.weapon = equip;
        } else {
          if (p.charms.length >= 2) discardToPile(state, p.charms.shift()!);
          p.charms.push(equip);
        }
        log(state, `${p.name} rolls the Die and freely equips ${d.name}.`, "system");
      } else {
        log(state, `${p.name} draws 2 from the Die of Probability.`, "system");
      }
      break;
    }
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
        const c = target.hand[rng.int(target.hand.length)]!;
        p.turnFlags.lookedAtHand = true;
        pushReveal(state, {
          kind: "hand",
          title: `Sleight of Hand — one card from ${target.name}`,
          cards: [cardSnapshot(c)],
          detail: `${getCardDef(c.defId).name} stays in their hand.`,
        });
      } else {
        p.turnFlags.lookedAtHand = true;
        log(state, `${p.name}'s Sleight finds an empty hand.`, "system");
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
        dealDamage(state, p, target, 3, {}, rng);
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
      p.status.block += 3;
      p.turnFlags.evadedOrBlocked = true;
      log(state, `${p.name} finds Balance and gains 3 Block.`, "system");
      break;
    case "tyrant_rage":
      p.status.attackModifier += 3;
      p.turnFlags.sacrificedHp = true;
      dealDamage(state, p, p, 1, { type: "sanity", unblockable: true }, rng);
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
        dealDamage(state, p, o, 3, {}, rng);
        o.sp = Math.max(0, o.sp - 1);
      }
      break;
    case "giant_mastery":
      p.status.attackModifier += 2;
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
        dealDamage(state, p, target, 3, {}, rng);
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
      if (target) dealDamage(state, p, target, 3, { type: "sanity" }, rng);
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
      if (target) dealDamage(state, p, target, 1, { type: "sanity" }, rng);
      drawCards(state, p, 1, rng, true);
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
        const bottom = state.deck.shift()!;
        state.deck.push(bottom);
        p.turnFlags.lookedAtDeck = true;
        pushReveal(state, {
          kind: "deck",
          title: "Magic Door — bottom card",
          cards: [cardSnapshot(bottom)],
          detail: `${getCardDef(bottom.defId).name} moves to the top of the deck.`,
        });
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
      p.status.block += 1;
      p.turnFlags.evadedOrBlocked = true;
      drawCards(state, p, 1, rng, true);
      log(state, `${p.name} watches through the night, gains 1 Block, and draws.`, "system");
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
        if (target.hand.length) {
          const [c] = target.hand.splice(rng.int(target.hand.length), 1);
          if (c) discardToPile(state, c);
        }
        target.sp = Math.max(0, target.sp - 1);
        p.turnFlags.forcedSkip = true;
        log(state, `${target.name} is pulled under — discards and loses 1 SP.`, "system");
      }
      break;
    case "dark_pacify":
      if (target) {
        target.sanity = Math.min(20, target.sanity + 4);
        p.turnFlags.sanityRestored += 4;
        updateMadness(target, state);
        if (!target.sanityBroken) log(state, `${target.name}'s mind is steadied.`, "heal");
      }
      break;
    case "death_scavenge":
      p.turnFlags.usedDiscard = true;
      if (state.discard.length) {
        const c = state.discard.pop()!;
        p.hand.push(c);
        p.turnFlags.drewExtra = true;
        log(state, `${p.name} scavenges ${getCardDef(c.defId).name} from the discard.`, "system");
      } else {
        drawCards(state, p, 1, rng, true);
        log(state, `${p.name} scavenges an empty grave and draws from the deck.`, "system");
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
          resolveCardEffect(state, p, c, getCardDef(c.defId).effectId, target, rng, 1);
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
        dealDamage(state, p, target, 2, {}, rng);
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
      p.sp = Math.min(20, p.sp + 3);
      break;
    case "hanged_whispers":
      dealDamage(state, p, p, 1, { type: "sanity", unblockable: true }, rng);
      drawCards(state, p, 2, rng, true);
      break;
    case "hanged_hide":
      p.status.evade += 1;
      p.status.block += 1;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "hanged_flesh":
      if (target) {
        const d = dealDamage(state, p, target, 3, {}, rng);
        p.hp = Math.min(p.maxHp, p.hp + d);
        p.turnFlags.healedHp += d;
      }
      break;
    case "hanged_graze":
    case "tower_mimic":
    case "moon_channel": {
      p.turnFlags.usedDiscard = true;
      const idx = state.discard.findIndex(
        (c) => c.defId !== "scribes_mimicry" && getCardDef(c.defId).type === "spell",
      );
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
          resolveCardEffect(state, p, c, getCardDef(c.defId).effectId, target, rng, 1);
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
      dealDamage(state, p, p, 4, { unblockable: true }, rng);
      {
        let hits = 0;
        for (const o of opponentsOf(state, p.id)) {
          dealDamage(state, p, o, 6, {}, rng);
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
      p.status.attackModifier += 1;
      log(state, `${p.name} arms Shadow Strike (+1 next Attack).`, "system");
      break;
    case "demoness_incite":
      if (target) {
        if (target.trap) {
          discardToPile(state, target.trap);
          target.trap = undefined;
          p.turnFlags.forcedSkip = true;
          log(state, `${target.name}'s Trap is discarded by Incite.`, "system");
        } else {
          dealDamage(state, p, target, 1, { type: "sanity", unblockable: true }, rng);
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
        dealDamage(state, p, o, 2, {}, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "demoness_mirror":
      p.fatalSafetyHp = 6;
      p.turnFlags.evadedOrBlocked = true;
      log(state, `${p.name} prepares Mirror Substitution.`, "heal");
      break;
    case "demoness_frostfire": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        for (let i = 0; i < 1 && o.hand.length; i++) {
          const idx = rng.int(o.hand.length);
          const [c] = o.hand.splice(idx, 1);
          if (c) discardToPile(state, c);
        }
        dealDamage(state, p, o, 3, {}, rng);
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
      drawCards(state, p, 1, rng, true);
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
      if (state.deck.length === 0) ensureDeck(state, rng);
      p.turnFlags.playedSpells += 1;
      break;
    }
    case "tower_foresight":
      p.status.evade += 1;
      p.status.block += 2;
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
      p.status.block += 1;
      p.reflectNextHit = true;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "tower_akashic":
      drawCards(state, p, 5, rng, true);
      break;

    case "wheel_premonition": {
      p.status.block += 2;
      p.turnFlags.lookedAtDeck = true;
      ensureDeck(state, rng);
      const seen = state.deck.splice(-2);
      if (seen.length) {
        const keep = seen[seen.length - 1]!;
        const rest = seen.slice(0, -1);
        state.deck.unshift(...rest);
        keep.free = true;
        p.hand.push(keep);
        p.turnFlags.drewExtra = true;
        pushReveal(state, {
          kind: "deck",
          title: "Premonition",
          cards: seen.map(cardSnapshot),
          detail: `${getCardDef(keep.defId).name} comes to hand. The other card goes to the bottom.`,
        });
      }
      break;
    }
    case "wheel_calc":
      p.status.block += 6;
      p.turnFlags.evadedOrBlocked = true;
      drawCards(state, p, 1, rng, true);
      break;
    case "moon_beast":
      p.status.block += 2;
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "wheel_luck": {
      const before = p.hand.length;
      drawCards(state, p, 2, rng, true);
      const drawn = p.hand.slice(before);
      let healed = drawn.length ? 5 : 0;
      if (
        drawn.length === 2 &&
        getCardDef(drawn[0]!.defId).type === getCardDef(drawn[1]!.defId).type
      ) {
        healed = 6;
      }
      if (healed) {
        p.hp = Math.min(p.maxHp, p.hp + healed);
        p.turnFlags.healedHp += healed;
        log(state, `Stroke of Luck heals ${healed}.`, "heal");
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
        dealDamage(state, p, target, 2, {}, rng);
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
      p.status.evade += 2;
      p.status.block += 2;
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
      drawCards(state, p, 3, rng, true);
      p.sp = 10;
      break;
    case "wheel_reboot":
      p.hp = Math.min(p.maxHp, 18);
      p.sanity = 18;
      p.turnFlags.sanityRestored += 3;
      p.turnFlags.healedHp += 5;
      updateMadness(p, state);
      break;

    case "mother_sow":
      {
        const t = target ?? p;
        t.hp = Math.min(t.maxHp, t.hp + 4);
        t.status.block += 1;
        p.turnFlags.healedHp += 4;
        p.sp = Math.min(20, p.sp + 1);
        drawCards(state, p, 1, rng, true);
        if (t.id !== p.id) p.turnFlags.healedAlly = true;
      }
      break;
    case "mother_cure":
      {
        const t = target ?? p;
        t.hp = Math.min(t.maxHp, t.hp + 6);
        t.status.stunned = false;
        t.status.skipAction = false;
        p.turnFlags.healedHp += 6;
        p.sp = Math.min(20, p.sp + 1);
        drawCards(state, p, 1, rng, true);
        p.turnFlags.healedAlly = true;
      }
      break;
    case "mother_harvest": {
      const missing = Math.max(2, Math.floor((p.maxHp - p.hp) / 4) || 2);
      drawCards(state, p, missing, rng, true);
      p.hp = Math.min(p.maxHp, p.hp + 2);
      p.turnFlags.healedHp += 2;
      break;
    }
    case "mother_mutate":
      if (p.hand.length) {
        discardToPile(state, p.hand.pop()!);
        p.turnFlags.discardedVoluntarily = true;
      }
      drawCards(state, p, 3, rng, true);
      break;
    case "mother_hide":
      p.status.block += 4;
      p.status.attackModifier += 2;
      drawCards(state, p, 1, rng, true);
      p.turnFlags.evadedOrBlocked = true;
      break;
    case "mother_vitality": {
      const before = p.hp;
      p.hp += 7;
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
      drawCards(state, p, 2, rng, true);
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
          if (state.deck.length === 0) ensureDeck(state, rng);
          p.turnFlags.drewExtra = true;
          log(state, `${p.name} brews ${getCardDef(top.defId).name} into hand.`, "heal");
        }
      }
      break;
    }
    case "moon_lifesteal":
    case "abyss_feast":
      if (target) {
        const amt = abilityId === "abyss_feast" ? 3 : 2;
        const d = dealDamage(state, p, target, amt, {}, rng);
        p.hp = Math.min(p.maxHp, p.hp + d);
        p.turnFlags.healedHp += d;
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
        dealDamage(state, p, target, 2, {}, rng);
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
      p.status.attackModifier += 3;
      dealDamage(state, p, p, 1, { type: "sanity", unblockable: true }, rng);
      p.turnFlags.sacrificedHp = true;
      break;
    case "chained_lacerate":
      if (target) {
        dealDamage(state, p, target, 2, {}, rng);
        target.beginBleed = true;
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
      p.status.attackModifier += 1;
      log(state, `${p.name} marks prey for death (+1 Attack).`, "system");
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
      drawCards(state, p, 1, rng, true);
      break;
    case "abyss_ignite":
      if (target) {
        dealDamage(state, p, target, 2, { type: "sanity" }, rng);
        if (target.mad) p.sp = Math.min(20, p.sp + 2);
      }
      break;
    case "abyss_corrupt_env": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        o.sp = Math.max(0, o.sp - 1);
        dealDamage(state, p, o, 1, {}, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      p.turnFlags.stoleResource = true;
      break;
    }
    case "abyss_blasphemy": {
      let hits = 0;
      for (const o of opponentsOf(state, p.id)) {
        dealDamage(state, p, o, 5, { type: "sanity", unblockable: true }, rng);
        hits++;
      }
      p.turnFlags.targetsHitInAction = hits;
      break;
    }
    case "abyss_descent":
      if (target && target.sanity <= 3) {
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
        drawCards(state, p, 1, rng, true);
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

    default: {
      const seqDef = getSequence(p.pathwayId, p.sequence);
      const scripted = scriptUniqueAbility(state, p, abilityId, target, rng, {
        damage: (who, amount, opts) => dealDamage(state, p, who, amount, opts ?? {}, rng),
        draw: (who, count) => drawCards(state, who, count, rng, true),
        discard: (card) => discardToPile(state, card),
        opponents: () => opponentsOf(state, p.id),
        log: (text, tone) => log(state, text, tone),
        replay: (card, who) => resolveCardEffect(state, p, card, getCardDef(card.defId).effectId, who, rng, 1),
      });
      if (scripted) {
        log(state, `${p.name} uses ${seqDef.abilityName}.`, "system");
        break;
      }
      // Safety net if an ability id has no effect of its own.
      const curve = pathwayCurve(p.pathwayId);
      const early = curve === "early";
      const mid = curve === "mid";
      const late = curve === "late";
      const foe = target && target.id !== p.id ? target : undefined;
      if (p.sequence >= 7) {
        if (early && foe) dealDamage(state, p, foe, 2, {}, rng);
        else if (foe) dealDamage(state, p, foe, 1, { type: "sanity" }, rng);
      } else if (p.sequence >= 4) {
        if (late) {
          drawCards(state, p, 2, rng, true);
          if (foe) dealDamage(state, p, foe, 2, { type: "sanity" }, rng);
        } else if (mid) {
          drawCards(state, p, 1, rng, true);
          if (foe) dealDamage(state, p, foe, 2, {}, rng);
        } else if (early && foe) {
          dealDamage(state, p, foe, 2, {}, rng);
        } else {
          drawCards(state, p, 1, rng, true);
          if (foe) dealDamage(state, p, foe, 1, { type: "sanity" }, rng);
        }
      } else if (late) {
        drawCards(state, p, 2, rng, true);
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + 2);
        p.turnFlags.healedHp += p.hp - before;
        if (foe) dealDamage(state, p, foe, 2, { type: "sanity" }, rng);
      } else if (early && foe) {
        dealDamage(state, p, foe, 1, { type: "sanity" }, rng);
      } else {
        drawCards(state, p, 1, rng, true);
        if (foe) dealDamage(state, p, foe, 2, { type: "sanity" }, rng);
      }
      log(state, `${p.name} uses ${seqDef.abilityName}.`, "system");
      break;
    }
  }
}

export function attemptAscension(
  state: GameState,
  rng: Rng,
): { ok: boolean; error?: string } {
  const p = currentPlayer(state);
  if (p.sanityBroken) return { ok: false, error: "Lost to Madness" };
  if (state.phase !== "action") return { ok: false, error: "Not your action" };
  if (state.potionDrunk) return { ok: false, error: "Potion already drunk this turn" };
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
      state.potionDrunk = true;
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

  // Show the recipe. The cards stay in hand and can be played or shown again.
  const owned = heldCards(p);
  const shown = recipe.discardInstanceIds
    .map((id) => owned.find((c) => c.instanceId === id))
    .filter((c): c is CardInstance => !!c);
  for (const c of shown) {
    c.revealed = true;
    c.potionSeq = p.sequence;
  }
  if (shown.length) {
    const names = shown.map((c) => getCardDef(c.defId).name).join(", ");
    pushReveal(state, {
      kind: "hand",
      title: `${p.name} shows the potion`,
      subjectName: p.name,
      cards: shown.map(cardSnapshot),
      detail: `Revealed to the table for Sequence ${nextSeq} — ${next.title}. Shown cards stay where they are: in hand or equipped.`,
    });
    log(state, `${p.name} reveals ${names} for the potion. The ingredients stay in hand.`, "ascend");
  }
  if (recipe.universalUsed) p.universalReagent = false;

  p.turnFlags.drankPotion = true;
  p.sequence = nextSeq;
  drawCards(state, p, 1, rng, true);
  if (p.pathwayId === "mother" && p.sequence > 0) {
    ensureDeck(state, rng);
    const look = state.deck.slice(-3);
    const need = new Set(matchRecipe(p)?.remaining ?? []);
    const hit = [...look].reverse().find((c) => getCardDef(c.defId).ingredients.some((ing) => need.has(ing)));
    if (hit) {
      state.deck = state.deck.filter((c) => c.instanceId !== hit.instanceId);
      p.hand.push(hit);
      log(state, `${p.name} harvests ${getCardDef(hit.defId).name} for the next potion.`, "ascend");
    }
  }
  if (state.simPlays) state.simAscensions = (state.simAscensions ?? 0) + 1;
  state.potionDrunk = true;

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
