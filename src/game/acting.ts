import { getSequence } from "./pathways";
import type { PlayerState, TurnTracking } from "./types";

export function emptyFlags(): TurnTracking {
  return {
    dealtDamage: false,
    tookDamage: false,
    lostSanity: false,
    drankPotion: false,
    lookedAtHand: false,
    lookedAtDeck: false,
    evadedOrBlocked: false,
    playedSpells: 0,
    negatedAttack: false,
    discardedVoluntarily: false,
    usedDiscard: false,
    healedAlly: false,
    dealtSanity: false,
    triggeredTrap: false,
    playedUtility: false,
    drewExtra: false,
    attackedWithWeapon: false,
    sacrificedHp: false,
    copiedEffect: false,
    damagedWhileLowHp: false,
    forcedSkip: false,
    cardsPlayed: 0,
    spSpent: 0,
    cardsFromOpponent: 0,
    discardCardsPlayed: 0,
    sanityRestored: 0,
    damageDealtTotal: 0,
    targetsHitInAction: 0,
    trapsDestroyed: 0,
    healedHp: 0,
    witnessedSpellOrTrap: false,
    stoleResource: false,
    preventedDraw: false,
    survivedFatal: false,
    causedMadness: 0,
  };
}

/** Merge this-turn progress into the persistent Acting bank (never loses prior progress). */
export function mergeActingBank(bank: TurnTracking, turn: TurnTracking): TurnTracking {
  return {
    dealtDamage: bank.dealtDamage || turn.dealtDamage,
    tookDamage: bank.tookDamage || turn.tookDamage,
    lostSanity: bank.lostSanity || turn.lostSanity,
    drankPotion: bank.drankPotion || turn.drankPotion,
    lookedAtHand: bank.lookedAtHand || turn.lookedAtHand,
    lookedAtDeck: bank.lookedAtDeck || turn.lookedAtDeck,
    evadedOrBlocked: bank.evadedOrBlocked || turn.evadedOrBlocked,
    playedSpells: bank.playedSpells + turn.playedSpells,
    negatedAttack: bank.negatedAttack || turn.negatedAttack,
    discardedVoluntarily: bank.discardedVoluntarily || turn.discardedVoluntarily,
    usedDiscard: bank.usedDiscard || turn.usedDiscard,
    healedAlly: bank.healedAlly || turn.healedAlly,
    dealtSanity: bank.dealtSanity || turn.dealtSanity,
    triggeredTrap: bank.triggeredTrap || turn.triggeredTrap,
    playedUtility: bank.playedUtility || turn.playedUtility,
    drewExtra: bank.drewExtra || turn.drewExtra,
    attackedWithWeapon: bank.attackedWithWeapon || turn.attackedWithWeapon,
    sacrificedHp: bank.sacrificedHp || turn.sacrificedHp,
    copiedEffect: bank.copiedEffect || turn.copiedEffect,
    damagedWhileLowHp: bank.damagedWhileLowHp || turn.damagedWhileLowHp,
    forcedSkip: bank.forcedSkip || turn.forcedSkip,
    cardsPlayed: bank.cardsPlayed + turn.cardsPlayed,
    spSpent: bank.spSpent + turn.spSpent,
    cardsFromOpponent: bank.cardsFromOpponent + turn.cardsFromOpponent,
    discardCardsPlayed: bank.discardCardsPlayed + turn.discardCardsPlayed,
    sanityRestored: bank.sanityRestored + turn.sanityRestored,
    damageDealtTotal: bank.damageDealtTotal + turn.damageDealtTotal,
    targetsHitInAction: Math.max(bank.targetsHitInAction, turn.targetsHitInAction),
    trapsDestroyed: bank.trapsDestroyed + turn.trapsDestroyed,
    healedHp: bank.healedHp + turn.healedHp,
    witnessedSpellOrTrap: bank.witnessedSpellOrTrap || turn.witnessedSpellOrTrap,
    stoleResource: bank.stoleResource || turn.stoleResource,
    preventedDraw: bank.preventedDraw || turn.preventedDraw,
    survivedFatal: bank.survivedFatal || turn.survivedFatal,
    causedMadness: bank.causedMadness + turn.causedMadness,
  };
}

/** Live view used for Acting checks: bank + current turn. */
export function actingView(player: PlayerState): TurnTracking {
  return mergeActingBank(player.actingBank, player.turnFlags);
}

export function evaluateActing(player: PlayerState): boolean {
  const seq = getSequence(player.pathwayId, player.sequence);
  const f = actingView(player);
  switch (seq.actingId) {
    case "look_hand_and_deck":
      return f.lookedAtHand && f.lookedAtDeck;
    case "evade_block_then_damage":
      return f.evadedOrBlocked && f.dealtDamage;
    case "two_spells_negate":
      return f.playedSpells >= 2 && f.negatedAttack;
    case "copy_deal_damage":
      return f.copiedEffect && f.dealtDamage;
    case "force_damage":
      return f.dealtDamage && f.forcedSkip;
    case "cause_madness":
      return f.causedMadness >= 1;
    case "play_three_discard":
      return f.discardCardsPlayed >= 3;
    case "spend_10_sp":
      return f.spSpent >= 10;
    case "redirect_fatal":
      return f.survivedFatal;
    case "extra_cards_2":
      return f.drewExtra || f.cardsFromOpponent >= 1;
    case "spend_other_resource":
      return f.stoleResource;
    case "bypass_trap_damage":
      return f.triggeredTrap && f.dealtDamage;
    case "steal_heal":
      return f.stoleResource && f.healedHp > 0;
    case "play_stolen_2":
      return f.cardsFromOpponent >= 2;
    case "transfer_4":
      return f.tookDamage && f.damageDealtTotal >= 1;
    case "hand8_traps2":
      return player.hand.length >= 8;
    case "swap_double":
      return f.stoleResource;
    case "play_5":
      return f.cardsPlayed >= 5;
    case "buff_other":
      return f.healedAlly;
    case "spell_damage_2":
      return f.dealtDamage && f.playedSpells >= 1;
    case "restore_sanity_3":
      return f.sanityRestored >= 3;
    case "negate_card":
      return f.negatedAttack || f.triggeredTrap;
    case "damage_mad":
      return f.dealtDamage;
    case "strip_2":
      return f.trapsDestroyed >= 2;
    case "reflect_exact":
      return f.dealtDamage && f.tookDamage;
    case "damage_6_no_weapon":
      return f.damageDealtTotal >= 6 && !f.attackedWithWeapon;
    case "perfect_end":
      return player.hp === 20 && player.sanity === 20 && player.hand.length === 0;
    case "play_while_hurt":
      return f.tookDamage && f.cardsPlayed >= 1;
    case "damage_low_hp":
      return f.dealtDamage && (player.hp < 10 || f.damagedWhileLowHp);
    case "block_lethal":
      return f.evadedOrBlocked && f.survivedFatal;
    case "draw_discard_2":
      return f.drewExtra && f.discardedVoluntarily;
    case "hit_2_plus":
      return f.targetsHitInAction >= 2;
    case "destroy_artifact_trap":
      return f.trapsDestroyed >= 1;
    case "damage_10_board":
      return f.damageDealtTotal >= 10;
    case "half_max_hit":
      return f.damageDealtTotal >= 10;
    case "elim_unblockable":
      return f.dealtDamage;
    case "weapon_attack":
      return f.attackedWithWeapon;
    case "take_provoked":
      return f.tookDamage;
    case "break_and_hit":
      return f.dealtDamage;
    case "block_4":
      return f.evadedOrBlocked;
    case "survive_3_targets":
      return f.tookDamage;
    case "pierce_block":
      return f.dealtDamage;
    case "elim_weapon":
      return f.attackedWithWeapon && f.dealtDamage;
    case "damage_8_prevent":
      return f.damageDealtTotal >= 8;
    case "remove_rare":
      return f.trapsDestroyed >= 1 || f.cardsPlayed >= 3;
    case "witness_trap_spell":
      return f.witnessedSpellOrTrap;
    case "sanity_2":
      return f.dealtSanity;
    case "heal_other_sanity":
      return f.healedAlly && f.sanityRestored >= 1;
    case "force_discard":
      return f.forcedSkip || f.discardedVoluntarily;
    case "sanity_full_hp":
      return f.dealtSanity;
    case "full_evade_cycle":
      return f.evadedOrBlocked && !f.tookDamage;
    case "sanity_5":
      return f.damageDealtTotal >= 5 && f.dealtSanity;
    case "sanity_drop_10":
      return f.damageDealtTotal >= 10 && f.dealtSanity;
    case "dictate_2":
      return f.forcedSkip;
    case "utility_and_draw":
      return f.playedUtility && f.drewExtra;
    case "two_spells":
      return f.playedSpells >= 2;
    case "reorder_draw":
      return f.lookedAtDeck && f.drewExtra;
    case "copy_spell":
      return f.copiedEffect;
    case "dodge_twice":
      return f.evadedOrBlocked && !f.tookDamage;
    case "prevent_draw":
      return f.preventedDraw;
    case "remove_board":
      return f.trapsDestroyed >= 1;
    case "double_resolve":
      return f.copiedEffect || f.playedSpells >= 2;
    case "swap_and_damage":
      return f.stoleResource && f.dealtDamage;
    case "no_damage_no_weapon":
      return !f.tookDamage && !f.attackedWithWeapon && f.cardsPlayed >= 1;
    case "swap_sanity":
      return f.dealtSanity && f.sanityRestored >= 1;
    case "force_skip":
      return f.forcedSkip;
    case "cure_madness":
      return f.sanityRestored >= 4;
    case "resolve_2_discard":
      return f.discardCardsPlayed >= 2;
    case "nullify_threat":
      return f.negatedAttack || f.triggeredTrap;
    case "madness_2":
      return f.causedMadness >= 2;
    case "erase_rare":
      return f.trapsDestroyed >= 1;
    case "all_sanity_1":
      return f.dealtSanity && f.damageDealtTotal >= 4;
    case "use_discard":
      return f.usedDiscard;
    case "voluntary_discard":
      return f.discardedVoluntarily;
    case "play_discard_utility":
      return f.discardCardsPlayed >= 1 && f.playedUtility;
    case "replace_hand":
      return f.usedDiscard && f.drewExtra;
    case "prevent_crit_heal":
      return f.dealtDamage;
    case "survive_fatal":
      return f.survivedFatal;
    case "elim_execute":
      return f.dealtDamage;
    case "discard_damage_10":
      return f.discardCardsPlayed >= 1 && f.damageDealtTotal >= 10;
    case "discard_aoe":
      return f.usedDiscard && f.damageDealtTotal >= 5;
    case "trap_interact":
      return f.triggeredTrap;
    case "survive_forced_attack":
      return f.tookDamage && f.evadedOrBlocked;
    case "unblockable_spell":
      return f.playedSpells >= 1 && f.dealtDamage;
    case "trap_damage":
      return f.triggeredTrap && f.dealtDamage;
    case "elim_low":
      return f.dealtDamage;
    case "share_block":
      return f.healedAlly && f.evadedOrBlocked;
    case "aoe_and_buff":
      return f.targetsHitInAction >= 2;
    case "damage_15":
      return f.damageDealtTotal >= 15;
    case "elim_while_low":
      return f.dealtDamage && player.hp <= 5;
    case "apotheosis":
      return false;
    default:
      return f.dealtDamage || f.cardsPlayed >= 2 || f.spSpent >= 3;
  }
}

/** Call after any action that may complete Acting. Returns true if newly fulfilled. */
export function refreshActingMet(player: PlayerState): boolean {
  if (player.actingMet) return false;
  if (evaluateActing(player)) {
    player.actingMet = true;
    return true;
  }
  return false;
}

/** Bank this turn's progress and keep actingMet sticky. */
export function bankTurnProgress(player: PlayerState) {
  player.actingBank = mergeActingBank(player.actingBank, player.turnFlags);
  refreshActingMet(player);
}

/** Clear bank when Ascending to a new Sequence. */
export function resetActingForNewSequence(player: PlayerState) {
  player.actingBank = emptyFlags();
  player.turnFlags = emptyFlags();
  player.actingMet = false;
}

export interface ActingProgressItem {
  id: string;
  label: string;
  done: boolean;
}

/** Human-readable checklist for the current Sequence Acting Condition. */
export function actingProgressItems(player: PlayerState): ActingProgressItem[] {
  const seq = getSequence(player.pathwayId, player.sequence);
  const f = actingView(player);
  const items: ActingProgressItem[] = [];

  const add = (id: string, label: string, done: boolean) => {
    items.push({ id, label, done });
  };

  switch (seq.actingId) {
    case "look_hand_and_deck":
      add("hand", "Look at an opponent's hand", f.lookedAtHand);
      add("deck", "Look at the top of the deck", f.lookedAtDeck);
      break;
    case "evade_block_then_damage":
      add("evade", "Evade or Block an attack", f.evadedOrBlocked);
      add("dmg", "Deal damage to an opponent", f.dealtDamage);
      break;
    case "two_spells_negate":
      add("spells", `Play Spells/Abilities (${Math.min(2, f.playedSpells)}/2)`, f.playedSpells >= 2);
      add("negate", "Negate an attack", f.negatedAttack);
      break;
    case "weapon_attack":
      add("wep", "Attack with a Weapon", f.attackedWithWeapon);
      break;
    case "sanity_2":
      add("san", "Deal Sanity damage", f.dealtSanity);
      break;
    case "extra_cards_2":
      add("extra", "Gain cards outside Draw Phase", f.drewExtra || f.cardsFromOpponent >= 1);
      break;
    case "utility_and_draw":
      add("util", "Play a Utility", f.playedUtility);
      add("draw", "Draw an extra card", f.drewExtra);
      break;
    case "use_discard":
      add("disc", "Interact with the discard pile", f.usedDiscard);
      break;
    case "trap_interact":
      add("trap", "Trigger or bypass a Trap", f.triggeredTrap);
      break;
    case "spell_damage_2":
      add("spell", "Play a Spell/Ability", f.playedSpells >= 1);
      add("dmg", "Deal damage", f.dealtDamage);
      break;
    case "no_damage_no_weapon":
      add("safe", "Take no damage this bank", !f.tookDamage);
      add("nowep", "Use no Weapon", !f.attackedWithWeapon);
      add("act", "Take at least one action", f.cardsPlayed >= 1);
      break;
    default:
      add("met", seq.actingCondition, evaluateActing(player));
  }

  if (player.actingMet) {
    items.forEach((i) => {
      i.done = true;
    });
  }
  return items;
}
