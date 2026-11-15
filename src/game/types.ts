export type CardType =
  | "weapon"
  | "spell"
  | "utility"
  | "charm"
  | "trap"
  | "artifact";

export type Rarity = "common" | "rare";
export type Ingredient =
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "C5"
  | "C6"
  | "C7"
  | "C8"
  | "R1"
  | "R2";

export type DamageType = "hp" | "sanity";
export type Phase =
  | "begin"
  | "draw"
  | "action"
  | "end"
  | "gameover";

export type ActionBucket = "standard" | "sequence" | "attack";

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: Rarity;
  spCost: number;
  text: string;
  ingredients: Ingredient[];
  weapon?: {
    attack: number;
    range: "melee" | "ranged";
    unblockable?: boolean;
    ignoreTrap?: boolean;
    ignoreBlock?: number;
    selfHpCost?: number;
    selfSanityCost?: number;
    swingSpCost?: number;
    sanityDamage?: boolean;
    kicker?: "revealTrap" | "discard" | "lifesteal";
  };
  charm?: {
    block: number;
    sanityBlock?: number;
    perk: string;
    handLimitBonus?: number;
    drawBonus?: number;
    beginSpBonus?: number;
    meleeImmune?: boolean;
    rangedEvade?: boolean;
    onceEvade?: boolean;
    sanityRestoreBegin?: number;
    madnessImmune?: boolean;
    weaponSanity?: boolean;
    thorns?: number;
    siphonSp?: number;
  };
  trap?: {
    trigger:
      | "attacked"
      | "spell"
      | "equip"
      | "draw2"
      | "gainSp"
      | "evade"
      | "fatal"
      | "ascension"
      | "equipRare"
      | "endTurn";
    text: string;
  };
  effectId: string;
}

export interface SequenceDef {
  sequence: number;
  title: string;
  spGain: number;
  abilityName: string;
  abilityCost: number;
  abilityText: string;
  abilityId: string;
  actingCondition: string;
  actingId: string;
  recipe: Ingredient[];
  sanityToll: number; // cost to ascend TO this sequence from previous
}

export interface PathwayDef {
  id: string;
  name: string;
  arcana: string;
  theme: string;
  color: string;
  accent: string;
  sequences: SequenceDef[];
}

export interface CardInstance {
  instanceId: string;
  defId: string;
}

export interface StatusFlags {
  block: number;
  sanityBlock: number;
  evade: number;
  stunned: boolean;
  skipDraw: boolean;
  skipAction: boolean;
  attackModifier: number;
  blockModifier: number;
  unblockableAttack: boolean;
  noPassiveSp: boolean;
  damageShareWith?: string; // player id who shares your pain
  cannotHeal?: boolean;
  madnessImmune?: boolean;
  onceEvadeUsed?: boolean;
  weaponDisabled?: boolean;
  /** Spell/Utility was negated by Concealment Boundary (this play only). */
  fizzleSpell?: boolean;
}

export interface TurnTracking {
  dealtDamage: boolean;
  tookDamage: boolean;
  lostSanity: boolean;
  drankPotion: boolean;
  lookedAtHand: boolean;
  lookedAtDeck: boolean;
  evadedOrBlocked: boolean;
  playedSpells: number;
  negatedAttack: boolean;
  discardedVoluntarily: boolean;
  usedDiscard: boolean;
  healedAlly: boolean;
  dealtSanity: boolean;
  triggeredTrap: boolean;
  playedUtility: boolean;
  drewExtra: boolean;
  attackedWithWeapon: boolean;
  sacrificedHp: boolean;
  copiedEffect: boolean;
  damagedWhileLowHp: boolean;
  forcedSkip: boolean;
  cardsPlayed: number;
  spSpent: number;
  /** Persistent-friendly counters for multi-turn Acting Conditions */
  cardsFromOpponent: number;
  discardCardsPlayed: number;
  sanityRestored: number;
  damageDealtTotal: number;
  targetsHitInAction: number;
  trapsDestroyed: number;
  healedHp: number;
  witnessedSpellOrTrap: boolean;
  stoleResource: boolean;
  preventedDraw: boolean;
  survivedFatal: boolean;
  causedMadness: number;
}

export interface PlayerState {
  id: string;
  name: string;
  isHuman: boolean;
  pathwayId: string;
  sequence: number; // 9..0
  hp: number;
  maxHp: number;
  sanity: number;
  sp: number;
  hand: CardInstance[];
  weapon?: CardInstance;
  charms: CardInstance[]; // max 2
  artifact?: CardInstance;
  trap?: CardInstance; // face-down
  status: StatusFlags;
  /** Progress this turn only (resets each Begin). */
  turnFlags: TurnTracking;
  /**
   * Accumulated Acting Condition progress across turns for the current Sequence.
   * Never cleared until Ascension (or Sequence change).
   */
  actingBank: TurnTracking;
  /** Sticky: once true for current Sequence, stays true until Ascension. */
  actingMet: boolean;
  alive: boolean;
  mad: boolean;
  universalReagent?: boolean;
  lastingBlock?: number; // Groselle etc.
  /** Soft status from high abilities */
  epidemicCurse?: boolean;
  cannotHealNextBegin?: boolean;
  drawPoison?: number;
  doomCurse?: boolean;
  fatalSafetyHp?: number; // if set, survive fatal at this HP once
  reflectNextHit?: boolean;
  ignoreArtifactDrawback?: boolean;
  nextCardTax?: number;
  markedBonusAttack?: number; // extra damage on next attack received from marker
  /** Lingering debuffs that last until the source player's next Begin. */
  rustSourceId?: string;
  shriekSourceId?: string;
  shareSourceId?: string;
  requiemUsed?: boolean;
}

export interface GameLogEntry {
  id: string;
  text: string;
  tone?: "neutral" | "damage" | "heal" | "ascend" | "system";
}

export interface PendingChoice {
  kind:
    | "target"
    | "discard"
    | "confirmAscend"
    | "pickCard"
    | "trapReveal";
  prompt: string;
  playerId: string;
  options?: { id: string; label: string }[];
  meta?: Record<string, string | number | boolean>;
}

/** Pop-up intel for the human player (hand peeks, deck peeks, steals). */
export interface RevealEvent {
  id: string;
  kind: "hand" | "deck" | "trap" | "steal" | "info";
  title: string;
  /** Whose private info was revealed (optional). */
  subjectName?: string;
  cards: { name: string; type: string; rarity: string; text: string }[];
  detail?: string;
}

export interface GameState {
  players: PlayerState[];
  deck: CardInstance[];
  discard: CardInstance[];
  currentPlayerIndex: number;
  phase: Phase;
  actionsUsed: Record<ActionBucket, boolean>;
  turnNumber: number;
  /** Tracks damage taken since last Begin recovery check (updated live). */
  cycleDamage: Record<
    string,
    { hpTaken: boolean; sanityTaken: boolean }
  >;
  log: GameLogEntry[];
  /** Latest reveals for UI modals (newest first). */
  reveals: RevealEvent[];
  winnerId?: string;
  winReason?: "lastStanding" | "apotheosis";
  pending?: PendingChoice;
  selectedCardId?: string;
  selectedTargetId?: string;
  seed: number;
  extraStandard?: number;
  /** Present only while the balance simulator is recording a match. */
  simPlays?: {
    defId: string;
    playerId: string;
    pathwayId: string;
    turn: number;
    damage: number;
    /** swing = weapon attack credit; omitted = the card was played from hand */
    swing?: boolean;
  }[];
  simBuf?: number;
}
