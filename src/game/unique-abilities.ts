import { getCardDef } from "./cards";
import { pathwayCurve } from "./pathways";
import type { CardInstance, GameState, PlayerState } from "./types";
import type { Rng } from "./rng";

/**
 * Every Sequence ability has its own effect. These are the ones that used to
 * fall through to a shared curve. Numbers shrink off that pathway's peak and
 * stay full on it. The effect itself does not change.
 */
export const HANDLED_ABILITY_IDS = [
  "fool_illusion",
  "fool_threads",
  "fool_angel",
  "fool_fog",
  "fool_wish",
  "fool_graft",
  "error_fire",
  "error_thought",
  "error_host",
  "error_rules",
  "error_fate",
  "error_loop",
  "sun_notarize",
  "sun_flame",
  "sun_purge",
  "sun_scales",
  "sun_ocean",
  "sun_vow",
  "tyrant_hurricane",
  "tyrant_tsunami",
  "tyrant_matter",
  "tyrant_storm",
  "giant_indestructible",
  "giant_fatal",
  "giant_rapier",
  "giant_twilight",
  "giant_sunder",
  "vis_invis",
  "vis_cage",
  "vis_deprive",
  "vis_dictate",
  "door_record",
  "door_teleport",
  "door_conceal",
  "door_exile",
  "door_replicate",
  "door_tear",
  "dark_channel",
  "dark_conceal",
  "dark_dread",
  "dark_erase",
  "dark_eternal",
  "death_gate",
  "death_door",
  "death_rez",
  "death_reap",
  "death_army",
  "death_descent",
  "priest_ambush",
  "priest_phalanx",
  "priest_battlecry",
  "priest_storm",
  "priest_legion",
] as const;

export interface AbilityApi {
  damage(
    target: PlayerState,
    amount: number,
    opts?: { type?: "hp" | "sanity"; unblockable?: boolean; ignoreEvade?: boolean },
  ): number;
  draw(who: PlayerState, n: number): void;
  discard(card: CardInstance): void;
  opponents(): PlayerState[];
  log(text: string, tone?: "neutral" | "damage" | "heal" | "ascend" | "system"): void;
  replay(card: CardInstance, target: PlayerState | undefined): void;
}

function marks(p: PlayerState) {
  p.marks ??= {};
  return p.marks;
}

/** Scale a printed number by where this pathway is relative to its peak. */
function n(p: PlayerState, amount: number): number {
  if (amount <= 0) return 0;
  const curve = pathwayCurve(p.pathwayId);
  const band = p.sequence >= 7 ? 0 : p.sequence >= 4 ? 1 : 2;
  const scale: Record<string, number[]> = {
    early: [1, 0.75, 0.55],
    mid: [0.7, 1, 0.7],
    late: [0.55, 0.85, 1],
    even: [0.9, 0.9, 0.9],
  };
  return Math.max(1, Math.round(amount * (scale[curve]?.[band] ?? 1)));
}

function foe(target: PlayerState | undefined, p: PlayerState, api: AbilityApi): PlayerState | undefined {
  if (target && target.id !== p.id && target.alive) return target;
  return api.opponents()[0];
}

function pullDiscard(state: GameState, pred: (c: CardInstance) => boolean): CardInstance | undefined {
  for (let i = state.discard.length - 1; i >= 0; i--) {
    const c = state.discard[i];
    if (!c?.defId || !pred(c)) continue;
    state.discard.splice(i, 1);
    return c;
  }
  return undefined;
}

function destroyPiece(state: GameState, api: AbilityApi, owner: PlayerState, kind: "any" | "rare"): boolean {
  const pieces: CardInstance[] = [
    ...(owner.artifact ? [owner.artifact] : []),
    ...(owner.trap ? [owner.trap] : []),
    ...owner.charms,
    ...(owner.weapon ? [owner.weapon] : []),
  ];
  const pick = pieces.find((c) => {
    const d = getCardDef(c.defId);
    if (kind === "rare") return d.rarity === "rare" || d.type === "artifact";
    return d.type === "artifact" || d.type === "trap" || d.type === "charm" || d.type === "weapon";
  });
  if (!pick) return false;
  if (owner.artifact?.instanceId === pick.instanceId) owner.artifact = undefined;
  else if (owner.trap?.instanceId === pick.instanceId) owner.trap = undefined;
  else if (owner.weapon?.instanceId === pick.instanceId) owner.weapon = undefined;
  else owner.charms = owner.charms.filter((c) => c.instanceId !== pick.instanceId);
  api.discard(pick);
  api.log(`${owner.name} loses ${getCardDef(pick.defId).name}.`, "system");
  return true;
}

/** Returns true when this ability id has its own effect. */
export function scriptUniqueAbility(
  state: GameState,
  p: PlayerState,
  abilityId: string,
  target: PlayerState | undefined,
  _rng: Rng,
  api: AbilityApi,
): boolean {
  const t = foe(target, p, api);
  switch (abilityId) {
    case "fool_illusion": {
      const card = pullDiscard(state, (c) => getCardDef(c.defId).rarity === "common" && c.defId !== "scribes_mimicry");
      if (card) {
        p.turnFlags.copiedEffect = true;
        p.turnFlags.usedDiscard = true;
        api.replay(card, t);
        api.discard(card);
        api.log(`${p.name} copies ${getCardDef(card.defId).name} from the discard.`, "system");
      } else api.log("No common card in the discard to copy.", "system");
      return true;
    }
    case "fool_threads": {
      if (t) {
        const victim = api.opponents().find((o) => o.id !== t.id) ?? p;
        const strike = t.weapon ? getCardDef(t.weapon.defId).weapon?.attack ?? 1 : 1;
        api.damage(victim, n(p, strike), { unblockable: true });
        p.turnFlags.forcedSkip = true;
        api.log(`${t.name} is pulled into striking ${victim.name}.`, "system");
      }
      return true;
    }
    case "fool_angel": {
      marks(p).sanityImmune = true;
      for (const o of api.opponents()) api.damage(o, n(p, 2), { type: "sanity", unblockable: true });
      api.log(`${p.name} is immune to Sanity damage this cycle.`, "system");
      return true;
    }
    case "fool_fog": {
      const card = pullDiscard(state, () => true);
      if (card) {
        card.free = true;
        p.hand.push(card);
        p.turnFlags.usedDiscard = true;
        api.log(`${getCardDef(card.defId).name} returns, and the next play is free.`, "system");
      }
      return true;
    }
    case "fool_wish": {
      if (!t || t.id === p.id) {
        p.hp = Math.min(p.maxHp, p.hp + n(p, 10));
        p.turnFlags.healedHp += n(p, 10);
        api.log(`${p.name} wishes for ${n(p, 10)} HP.`, "heal");
      } else if (t.sanity < t.hp) {
        t.sanity = Math.min(20, t.sanity + n(p, 10));
        p.turnFlags.sanityRestored += n(p, 10);
        api.log(`${t.name} is granted ${n(p, 10)} Sanity.`, "heal");
      } else {
        api.damage(t, n(p, 5), { unblockable: true });
      }
      p.turnFlags.spSpent += 10;
      return true;
    }
    case "fool_graft": {
      if (t) {
        marks(p).redirectFatalTo = t.id;
        api.log(`The next fatal blow to ${p.name} leaps to ${t.name}.`, "system");
      }
      return true;
    }
    case "error_fire": {
      if (t) {
        marks(t).stealHealFor = p.id;
        const sip = Math.min(n(p, 3), t.hp - 1);
        if (sip > 0) {
          t.hp -= sip;
          p.hp = Math.min(p.maxHp, p.hp + sip);
          p.turnFlags.healedHp += sip;
        }
        api.log(`${p.name} steals the next heal meant for ${t.name}.`, "heal");
      }
      return true;
    }
    case "error_thought": {
      if (t?.hand.length) {
        const card = t.hand.splice(0, 1)[0]!;
        card.free = true;
        p.hand.push(card);
        p.turnFlags.copiedEffect = true;
        api.log(`${p.name} takes ${getCardDef(card.defId).name} and may play it free.`, "system");
      }
      return true;
    }
    case "error_host": {
      if (t) {
        p.status.damageShareWith = t.id;
        p.shareSourceId = p.id;
        api.log(`Half of ${p.name}'s damage is shared with ${t.name}.`, "system");
      }
      return true;
    }
    case "error_rules": {
      marks(p).ignoreHandLimit = true;
      api.log(`${p.name} ignores the hand limit until the next Begin.`, "system");
      return true;
    }
    case "error_fate": {
      if (t) {
        if (t.hp >= p.hp) {
          const hp = p.hp;
          p.hp = t.hp;
          t.hp = hp;
          api.log(`${p.name} swaps HP with ${t.name}.`, "system");
        } else {
          const sanity = p.sanity;
          p.sanity = t.sanity;
          t.sanity = sanity;
          api.log(`${p.name} swaps Sanity with ${t.name}.`, "system");
        }
        p.turnFlags.stoleResource = true;
      }
      return true;
    }
    case "error_loop": {
      marks(p).extraTurn = true;
      api.log(`${p.name} will take another turn.`, "system");
      return true;
    }
    case "sun_notarize": {
      marks(p).negateNextSpell = true;
      marks(p).ignoreTraps = true;
      api.log(`${p.name} notarizes a refusal of the next Spell or Trap.`, "system");
      return true;
    }
    case "sun_flame": {
      if (t) {
        const bonus = t.sanityBroken || t.mad ? n(p, 2) : 0;
        api.damage(t, n(p, 4) + bonus);
        if (t.sanityBroken || t.mad) p.turnFlags.dealtDamage = true;
      }
      return true;
    }
    case "sun_purge": {
      let nTraps = 0;
      for (const pl of [p, ...api.opponents()]) {
        if (!pl.trap) continue;
        api.discard(pl.trap);
        pl.trap = undefined;
        nTraps++;
      }
      p.turnFlags.triggeredTrap = nTraps > 0;
      api.log(nTraps ? `${nTraps} Trap${nTraps === 1 ? "" : "s"} burn away.` : "No Traps on the board.", "system");
      return true;
    }
    case "sun_scales": {
      const taken = p.turnFlags.tookDamage ? n(p, 4) : n(p, 2);
      if (t) api.damage(t, taken);
      api.log(`${p.name} returns ${taken} of the harm taken this turn.`, "damage");
      return true;
    }
    case "sun_ocean": {
      for (const o of api.opponents()) api.damage(o, n(p, 6));
      p.hp = Math.min(p.maxHp, p.hp + n(p, 6));
      p.turnFlags.healedHp += n(p, 6);
      return true;
    }
    case "sun_vow": {
      const who = !t || t.id === p.id ? p : t;
      who.hp = who.maxHp;
      who.sanity = 20;
      who.sanityBroken = false;
      who.mad = false;
      p.turnFlags.healedAlly = who.id !== p.id;
      p.turnFlags.healedHp += 6;
      api.log(`${who.name} is restored to full HP and Sanity.`, "heal");
      return true;
    }
    case "tyrant_hurricane": {
      let removed = 0;
      for (const pl of [p, ...api.opponents()]) {
        if (pl.artifact) {
          api.discard(pl.artifact);
          pl.artifact = undefined;
          removed++;
        }
        if (pl.trap) {
          api.discard(pl.trap);
          pl.trap = undefined;
          removed++;
        }
      }
      p.turnFlags.triggeredTrap = removed > 0;
      api.log(`${p.name}'s hurricane clears ${removed} Artifact${removed === 1 ? "" : "s"} and Trap${removed === 1 ? "" : "s"}.`, "system");
      return true;
    }
    case "tyrant_tsunami": {
      for (const o of api.opponents()) api.damage(o, n(p, 5));
      return true;
    }
    case "tyrant_matter": {
      if (t && t.hp > 1) {
        const drop = Math.floor(t.hp / 2);
        api.damage(t, n(p, Math.max(1, drop)), { unblockable: true });
      }
      return true;
    }
    case "tyrant_storm": {
      if (t) api.damage(t, n(p, 10), { unblockable: true, ignoreEvade: true });
      return true;
    }
    case "giant_indestructible": {
      marks(p).ironBody = true;
      api.log(`${p.name} shrugs off incoming HP damage this cycle.`, "system");
      return true;
    }
    case "giant_fatal": {
      marks(p).ignoreBlockNext = true;
      api.log(`${p.name}'s next attack ignores Block and Evade.`, "system");
      return true;
    }
    case "giant_rapier": {
      if (t) {
        api.damage(t, n(p, 6));
        if (!t.alive) {
          p.sp = Math.min(20, p.sp + 4);
          api.log(`${p.name} is refunded 4 SP.`, "system");
        }
      }
      return true;
    }
    case "giant_twilight": {
      if (t) {
        api.damage(t, n(p, 8));
        t.cannotHealNextBegin = true;
      }
      return true;
    }
    case "giant_sunder": {
      if (t) destroyPiece(state, api, t, "any");
      p.turnFlags.stoleResource = true;
      return true;
    }
    case "vis_invis": {
      marks(p).untouchable = true;
      api.log(`${p.name} cannot be targeted until the next Begin.`, "system");
      return true;
    }
    case "vis_cage": {
      if (t) {
        marks(t).spellLock = true;
        api.log(`${t.name} cannot play Spells or Weapons on their next turn.`, "system");
      }
      return true;
    }
    case "vis_deprive": {
      if (t) {
        const drop = p.sequence <= 3 ? Math.max(0, t.sanity - 1) : n(p, 6);
        api.damage(t, drop, { type: "sanity", unblockable: true });
      }
      return true;
    }
    case "vis_dictate": {
      const order = ["spell", "weapon", "utility", "charm", "trap", "artifact"] as const;
      const named = order[p.sequence % order.length]!;
      for (const o of api.opponents()) {
        const idx = o.hand.findIndex((c) => getCardDef(c.defId).type === named);
        if (idx >= 0) {
          const [c] = o.hand.splice(idx, 1);
          if (c) api.discard(c);
        } else api.damage(o, n(p, 5));
      }
      p.turnFlags.forcedSkip = true;
      return true;
    }
    case "door_record": {
      const card = pullDiscard(state, (c) => getCardDef(c.defId).type === "spell" && c.defId !== "scribes_mimicry");
      if (card) {
        const copy: CardInstance = { instanceId: `${card.instanceId}-copy`, defId: card.defId };
        state.discard.push(card);
        p.hand.push(copy);
        p.turnFlags.copiedEffect = true;
        api.log(`${p.name} records ${getCardDef(card.defId).name}.`, "system");
      }
      return true;
    }
    case "door_teleport": {
      marks(p).ignoreTraps = true;
      api.log(`${p.name} steps past Traps this turn.`, "system");
      return true;
    }
    case "door_conceal": {
      if (t) {
        t.status.skipDraw = true;
        p.turnFlags.preventedDraw = true;
        api.log(`${t.name} will not draw next turn.`, "system");
      }
      return true;
    }
    case "door_exile": {
      if (t) {
        if (t.artifact) {
          t.hand.push(t.artifact);
          t.artifact = undefined;
          api.log(`An Artifact returns to ${t.name}'s hand.`, "system");
        } else if (t.trap) {
          t.hand.push(t.trap);
          t.trap = undefined;
          api.log(`A Trap returns to ${t.name}'s hand.`, "system");
        }
        p.turnFlags.triggeredTrap = true;
      }
      return true;
    }
    case "door_replicate": {
      marks(p).echoNextCard = true;
      api.log(`The next card ${p.name} plays resolves twice.`, "system");
      return true;
    }
    case "door_tear": {
      if (t) {
        const hand = p.hand;
        const sp = p.sp;
        p.hand = t.hand;
        t.hand = hand;
        p.sp = t.sp;
        t.sp = sp;
        p.turnFlags.stoleResource = true;
        api.log(`${p.name} swaps hands and Spirituality with ${t.name}.`, "system");
      }
      return true;
    }
    case "dark_channel": {
      const card = pullDiscard(
        state,
        (c) => {
          const d = getCardDef(c.defId);
          return d.type === "spell" || d.type === "trap";
        },
      );
      if (card) {
        card.free = true;
        p.hand.push(card);
        p.turnFlags.usedDiscard = true;
        api.log(`${getCardDef(card.defId).name} is ready to play for free.`, "system");
      }
      return true;
    }
    case "dark_conceal": {
      marks(p).negateNextSpell = true;
      marks(p).ignoreTraps = true;
      api.log(`${p.name} nullifies one Artifact or Trap this cycle.`, "system");
      return true;
    }
    case "dark_dread": {
      for (const o of api.opponents()) api.damage(o, n(p, 4), { type: "sanity", unblockable: true });
      p.status.block += n(p, 4);
      p.turnFlags.evadedOrBlocked = true;
      return true;
    }
    case "dark_erase": {
      if (t) destroyPiece(state, api, t, "rare");
      return true;
    }
    case "dark_eternal": {
      for (const o of api.opponents()) {
        o.sanity = 1;
        o.status.skipDraw = true;
        p.turnFlags.dealtSanity = true;
        p.turnFlags.preventedDraw = true;
      }
      api.log("Every opponent is left at 1 Sanity and skips their next draw.", "damage");
      return true;
    }
    case "death_gate": {
      const taken: CardInstance[] = [];
      while (taken.length < 3 && state.discard.length) {
        const c = state.discard.pop();
        if (c) taken.push(c);
      }
      if (taken.length) {
        for (const c of p.hand) api.discard(c);
        p.hand = taken;
        p.turnFlags.usedDiscard = true;
        api.log(`${p.name} replaces the hand with ${taken.length} cards from the discard.`, "system");
      }
      return true;
    }
    case "death_door": {
      if (t && t.hp <= 5) {
        t.cannotHealNextBegin = true;
        api.log(`${t.name} cannot heal at their next Begin.`, "system");
      } else api.log("No one that wounded is in reach.", "system");
      return true;
    }
    case "death_rez": {
      p.fatalSafetyHp = 5;
      api.log(`The next time ${p.name} would fall, they remain at 5 HP.`, "heal");
      return true;
    }
    case "death_reap": {
      if (t && t.hp <= 5) {
        api.damage(t, Math.max(1, t.hp), { unblockable: true });
        api.log(`${t.name} is reaped.`, "damage");
      }
      return true;
    }
    case "death_army": {
      let played = 0;
      for (let i = state.discard.length - 1; i >= 0 && played < 2; i--) {
        const c = state.discard[i];
        if (!c?.defId || getCardDef(c.defId).type !== "spell" || c.defId === "scribes_mimicry") continue;
        const cost = getCardDef(c.defId).spCost;
        if (p.sp < cost) continue;
        p.sp -= cost;
        state.discard.splice(i, 1);
        api.replay(c, t);
        api.discard(c);
        played++;
      }
      p.turnFlags.playedSpells += played;
      api.log(played ? `${p.name} raises ${played} spell${played === 1 ? "" : "s"} from the discard.` : "No affordable spell in the discard.", "system");
      return true;
    }
    case "death_descent": {
      const dmg = n(p, Math.min(12, state.discard.length));
      for (const o of api.opponents()) api.damage(o, dmg);
      api.log(`The discard answers with ${dmg}.`, "damage");
      return true;
    }
    case "priest_ambush": {
      marks(p).trapBonus = n(p, 3);
      api.log(`The next Trap ${p.name} springs deals ${n(p, 3)} extra damage.`, "system");
      return true;
    }
    case "priest_phalanx": {
      const shared = n(p, 3);
      p.status.block += shared;
      if (t && t.id !== p.id) {
        t.status.block += shared;
        p.turnFlags.healedAlly = true;
      }
      p.turnFlags.evadedOrBlocked = true;
      return true;
    }
    case "priest_battlecry": {
      for (const o of api.opponents()) api.damage(o, n(p, 4));
      p.status.attackModifier += 2;
      return true;
    }
    case "priest_storm": {
      for (const o of api.opponents()) api.damage(o, n(p, 8));
      for (const pl of [p, ...api.opponents()]) {
        if (!pl.trap) continue;
        api.discard(pl.trap);
        pl.trap = undefined;
      }
      return true;
    }
    case "priest_legion": {
      const missing = Math.max(1, p.maxHp - p.hp);
      if (t) api.damage(t, n(p, missing), { unblockable: true });
      return true;
    }
    default:
      return false;
  }
}
