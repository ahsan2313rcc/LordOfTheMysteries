import { getCardDef } from "./cards";
import { getSequence, INGREDIENT_NAMES } from "./pathways";
import type { Ingredient, PlayerState } from "./types";

export interface RecipeMatch {
  needed: Ingredient[];
  remaining: Ingredient[];
  discardInstanceIds: string[];
  universalUsed: boolean;
  canPay: boolean;
  toll: number;
  missingLabels: string[];
}

/** Preview whether the player can pay the next potion recipe from hand. */
export function matchRecipe(player: PlayerState): RecipeMatch | null {
  if (player.sequence <= 0) return null;
  const next = getSequence(player.pathwayId, player.sequence - 1);
  const needed = [...next.recipe];
  const universalUsed = false;
  const remaining = [...needed];
  const discardInstanceIds: string[] = [];

  // Every copy printed on a card can fill a slot. A card shown for the previous potion cannot.
  for (const card of player.hand) {
    if (remaining.length === 0) break;
    if (card.potionSeq === player.sequence + 1) continue;
    const bag = [...getCardDef(card.defId).ingredients];
    let spent = false;
    for (let r = remaining.length - 1; r >= 0; r--) {
      const at = bag.indexOf(remaining[r]!);
      if (at < 0) continue;
      bag.splice(at, 1);
      remaining.splice(r, 1);
      spent = true;
    }
    if (spent) discardInstanceIds.push(card.instanceId);
  }

  return {
    needed: [...next.recipe],
    remaining,
    discardInstanceIds,
    universalUsed,
    canPay: remaining.length === 0,
    toll: 0,
    missingLabels: remaining.map((r) => INGREDIENT_NAMES[r] ?? r),
  };
}

export function ascensionReady(player: PlayerState): {
  acting: boolean;
  recipe: boolean;
  reason: string;
} {
  const recipe = matchRecipe(player);
  const acting = player.actingMet;
  if (!recipe) {
    return { acting, recipe: false, reason: "Already Sequence 0" };
  }
  if (!acting && !recipe.canPay) {
    return {
      acting,
      recipe: false,
      reason: "Need Acting Condition and ingredients",
    };
  }
  if (!acting) {
    return { acting, recipe: recipe.canPay, reason: "Acting Condition not locked yet" };
  }
  if (recipe.remaining.length) {
    return {
      acting,
      recipe: false,
      reason: `Missing: ${recipe.missingLabels.join(", ")}`,
    };
  }
  return { acting, recipe: true, reason: "Ready to drink potion" };
}
