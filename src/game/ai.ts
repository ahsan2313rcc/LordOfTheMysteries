import { matchRecipe } from "./ascension";
import { getCardDef } from "./cards";
import {
  attemptAscension,
  castSequenceAbility,
  currentPlayer,
  endTurn,
  getRng,
  opponentsOf,
  performAttack,
  playCardFromHand,
} from "./engine";
import { getSequence } from "./pathways";
import type { GameState, PlayerState } from "./types";

function ingredientValue(player: PlayerState, defId: string): number {
  const recipe = matchRecipe(player);
  if (!recipe || !player.actingMet) return 0;
  if (defId === "potion_ingredients") {
    return recipe.remaining.filter((r) => r.startsWith("C")).length > 0 ? 2 : 0;
  }
  return recipe.remaining.filter((r) => getCardDef(defId).ingredients.includes(r)).length;
}

/** Greedy AI: Ascend when ready → lock Acting → hold recipe pieces → fight. */
export function runAiTurn(state: GameState): GameState {
  const s = state;
  const rng = getRng(s);
  let guard = 0;

  while (
    s.phase === "action" &&
    currentPlayer(s).alive &&
    !currentPlayer(s).isHuman &&
    guard < 16
  ) {
    guard += 1;
    const p = currentPlayer(s);
    const opps = opponentsOf(s, p.id);
    const target = [...opps].sort((a, b) => a.hp - b.hp || a.sanity - b.sanity)[0];

    // Ascend immediately when Acting + recipe are payable
    if (!s.actionsUsed.sequence) {
      const recipe = matchRecipe(p);
      if (p.actingMet && recipe?.canPay) {
        const res = attemptAscension(s, rng);
        if (res.ok) continue;
      }
    }

    // Sequence ability early to lock Acting (before spending cards)
    if (!s.actionsUsed.sequence && !p.actingMet) {
      const seq = getSequence(p.pathwayId, p.sequence);
      if (p.sp >= seq.abilityCost) {
        const r = castSequenceAbility(s, target?.id, rng);
        if (r.ok) {
          if (!p.actingMet && !s.actionsUsed.attack && target) {
            performAttack(s, target.id, rng);
          }
          continue;
        }
      }
    }

    if (!s.actionsUsed.standard) {
      const playable = p.hand
        .map((c) => ({ c, d: getCardDef(c.defId) }))
        .filter(({ d }) => p.sp >= d.spCost + (p.nextCardTax ?? 0))
        .sort((a, b) => {
          // Prefer drawing/search utilities when recipe-blocked; never burn recipe pieces
          const potA = a.d.id === "potion_ingredients" ? -5 : 0; // hold in hand (wild)
          const potB = b.d.id === "potion_ingredients" ? -5 : 0;
          const drawA =
            a.d.id === "decipher_hermes" || a.d.id === "grave_robbing" ? 8 : 0;
          const drawB =
            b.d.id === "decipher_hermes" || b.d.id === "grave_robbing" ? 8 : 0;
          const score = (t: string) =>
            t === "spell" ? 4 : t === "utility" ? 3 : t === "weapon" ? 2 : 1;
          return (
            potB - potA ||
            drawB - drawA ||
            ingredientValue(p, a.d.id) - ingredientValue(p, b.d.id) ||
            score(b.d.type) - score(a.d.type)
          );
        });

      let played = false;
      for (const { c, d } of playable) {
        // Hold unique recipe pieces (and Potion Ingredients) once Acting is locked
        if (p.actingMet && ingredientValue(p, d.id) > 0) continue;

        if (d.type === "trap") {
          if (!s.actionsUsed.attack && !p.trap) {
            const r = playCardFromHand(s, c.instanceId, undefined, rng);
            if (r.ok) {
              played = true;
              break;
            }
          }
          continue;
        }
        const r = playCardFromHand(s, c.instanceId, target?.id, rng);
        if (r.ok) {
          played = true;
          break;
        }
      }
      if (played) continue;
    }

    // Ability for combat pressure even after Acting is locked
    if (!s.actionsUsed.sequence) {
      const seq = getSequence(p.pathwayId, p.sequence);
      if (p.sp >= seq.abilityCost) {
        const r = castSequenceAbility(s, target?.id, rng);
        if (r.ok) continue;
      }
      if (p.actingMet) {
        const res = attemptAscension(s, rng);
        if (res.ok) continue;
      }
    }

    if (!s.actionsUsed.attack && target) {
      const r = performAttack(s, target.id, rng);
      if (r.ok) continue;
    }

    break;
  }

  if (s.phase === "action" && currentPlayer(s).alive && !currentPlayer(s).isHuman) {
    endTurn(s, rng);
  }

  return s;
}
