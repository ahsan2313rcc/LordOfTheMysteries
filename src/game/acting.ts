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
    // —— Early (9–7): completable via Sequence Ability ± Attack/card ——
    case "look_hand_and_deck":
      return f.lookedAtHand && f.lookedAtDeck;
    case "prepare_defense_and_damage":
      return f.evadedOrBlocked && f.dealtDamage;
    case "evade_and_draw":
      return f.evadedOrBlocked && f.drewExtra;
    case "two_spells":
      return f.playedSpells >= 2;
    case "two_spells_negate":
      return f.playedSpells >= 2 && f.negatedAttack;
    case "gain_extra_card":
      return f.drewExtra || f.cardsFromOpponent >= 1;
    case "spend_other_resource":
      return f.stoleResource;
    case "peek_then_damage":
      return (f.lookedAtHand || f.triggeredTrap) && f.dealtDamage;
    case "buff_any":
      return f.healedAlly;
    case "buff_other":
      return f.healedAlly;
    case "spell_damage_2":
      return f.dealtDamage && f.playedSpells >= 1;
    case "restore_sanity_3":
      return f.sanityRestored >= 3;
    case "ability_or_damage":
      return f.cardsPlayed >= 1 || f.dealtDamage || f.evadedOrBlocked;
    case "rage_damage":
      return f.dealtDamage && (f.sacrificedHp || player.hp < 10 || f.damagedWhileLowHp);
    case "gain_block":
      return f.evadedOrBlocked;
    case "mastery_attack":
      return f.attackedWithWeapon || (f.dealtDamage && f.spSpent >= 1);
    case "weapon_attack":
      return f.attackedWithWeapon;
    case "cast_provoke":
      return f.healedAlly || f.evadedOrBlocked || f.forcedSkip;
    case "break_and_hit":
      return f.dealtDamage;
    case "look_hand":
      return f.lookedAtHand;
    case "sanity_2":
      return f.dealtSanity;
    case "damage_or_block":
      return f.dealtDamage || f.evadedOrBlocked;
    case "reorder_draw":
      return f.lookedAtDeck && f.drewExtra;
    case "quiet_night":
      return f.cardsPlayed >= 1 && !f.attackedWithWeapon && !f.tookDamage;
    case "swap_sanity":
      return f.dealtSanity && f.sanityRestored >= 1;
    case "force_skip":
      return f.forcedSkip;
    case "use_discard":
      return f.usedDiscard;
    case "voluntary_discard":
      return f.discardedVoluntarily || f.healedHp > 0;
    case "reveal_traps":
      return f.triggeredTrap || f.lookedAtHand || f.witnessedSpellOrTrap;
    case "taunt_disrupt":
      return f.forcedSkip || f.stoleResource || f.dealtSanity || f.discardedVoluntarily;
    case "unblockable_spell":
      return f.playedSpells >= 1 && f.dealtDamage;

    // —— Mid / high (harder sinks) ——
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
    case "negate_card":
      return f.negatedAttack || f.triggeredTrap;
    case "damage_mad":
      return f.dealtDamage && f.causedMadness >= 1;
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
    case "take_provoked":
      return f.tookDamage;
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
    case "heal_other_sanity":
      return f.sanityRestored >= 3;
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
    case "prepare_defense_and_damage":
      add("evade", "Gain Evade/Block (Acrobatics counts)", f.evadedOrBlocked);
      add("dmg", "Deal damage", f.dealtDamage);
      break;
    case "evade_and_draw":
      add("evade", "Gain Evade", f.evadedOrBlocked);
      add("draw", "Draw a card", f.drewExtra);
      break;
    case "gain_extra_card":
      add("extra", "Gain a card outside Draw Phase", f.drewExtra || f.cardsFromOpponent >= 1);
      break;
    case "spend_other_resource":
      add("steal", "Drain an opponent's SP/cards", f.stoleResource);
      break;
    case "peek_then_damage":
      add("peek", "Reveal hand or Traps", f.lookedAtHand || f.triggeredTrap);
      add("dmg", "Deal damage", f.dealtDamage);
      break;
    case "buff_any":
      add("buff", "Buff a player (Courage)", f.healedAlly);
      break;
    case "spell_damage_2":
      add("spell", "Spell/Ability damage", f.playedSpells >= 1 && f.dealtDamage);
      break;
    case "restore_sanity_3":
      add("san", `Restore Sanity (${Math.min(3, f.sanityRestored)}/3)`, f.sanityRestored >= 3);
      break;
    case "ability_or_damage":
      add("act", "Use Balance or deal damage", f.cardsPlayed >= 1 || f.dealtDamage || f.evadedOrBlocked);
      break;
    case "rage_damage":
      add("rage", "Deal damage after Rage / at low HP", evaluateActing(player));
      break;
    case "gain_block":
      add("block", "Gain Block", f.evadedOrBlocked);
      break;
    case "mastery_attack":
      add("atk", "Attack (Mastery or Weapon)", f.attackedWithWeapon || (f.dealtDamage && f.spSpent >= 1));
      break;
    case "cast_provoke":
      add("prov", "Cast Provoke", f.forcedSkip || f.evadedOrBlocked);
      break;
    case "look_hand":
      add("hand", "Look at an opponent's hand", f.lookedAtHand);
      break;
    case "sanity_2":
      add("san", "Deal Sanity damage", f.dealtSanity);
      break;
    case "damage_or_block":
      add("fx", "Deal damage or gain Block", f.dealtDamage || f.evadedOrBlocked);
      break;
    case "reorder_draw":
      add("deck", "Reorder deck", f.lookedAtDeck);
      add("draw", "Draw", f.drewExtra);
      break;
    case "quiet_night":
      add("quiet", "Non-Weapon action, no damage taken", evaluateActing(player));
      break;
    case "swap_sanity":
      add("drain", "Sanity damage", f.dealtSanity);
      add("heal", "Restore your Sanity", f.sanityRestored >= 1);
      break;
    case "force_skip":
      add("skip", "Force a skip", f.forcedSkip);
      break;
    case "use_discard":
      add("disc", "Interact with discard", f.usedDiscard);
      break;
    case "voluntary_discard":
      add("bury", "Bury/discard to heal", f.discardedVoluntarily || f.healedHp > 0);
      break;
    case "reveal_traps":
      add("track", "Reveal/track Traps", f.triggeredTrap || f.witnessedSpellOrTrap);
      break;
    case "taunt_disrupt":
      add("taunt", "Disrupt with Taunt", evaluateActing(player));
      break;
    case "unblockable_spell":
      add("fire", "Unblockable Spell/Ability damage", f.playedSpells >= 1 && f.dealtDamage);
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
