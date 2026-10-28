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
  let universalUsed = false;

  if (player.universalReagent) {
    let filled = 0;
    for (let i = needed.length - 1; i >= 0 && filled < 2; i--) {
      if (needed[i]!.startsWith("C")) {
        needed.splice(i, 1);
        filled++;
        universalUsed = true;
      }
    }
  }

  const remaining = [...needed];
  const discardInstanceIds: string[] = [];
  const used = new Set<string>();

  for (const card of player.hand) {
    if (remaining.length === 0) break;
    const ings = getCardDef(card.defId).ingredients;
    for (let r = remaining.length - 1; r >= 0; r--) {
      if (ings.includes(remaining[r]!) && !used.has(card.instanceId)) {
        remaining.splice(r, 1);
        discardInstanceIds.push(card.instanceId);
        used.add(card.instanceId);
        break;
      }
    }
  }

  return {
    needed: [...next.recipe],
    remaining,
    discardInstanceIds,
    universalUsed,
    canPay: remaining.length === 0 && player.sanity >= next.sanityToll,
    toll: next.sanityToll,
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
  if (player.sanity < recipe.toll) {
    return {
      acting,
      recipe: false,
      reason: `Need ${recipe.toll} Sanity (have ${player.sanity})`,
    };
  }
  return { acting, recipe: true, reason: "Ready to drink potion" };
}
