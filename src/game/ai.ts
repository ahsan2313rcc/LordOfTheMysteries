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
import type { GameState } from "./types";

/** Simple greedy AI: play cards → ability → attack → end. */
export function runAiTurn(state: GameState): GameState {
  const s = state;
  const rng = getRng(s);
  let guard = 0;

  while (
    s.phase === "action" &&
    currentPlayer(s).alive &&
    !currentPlayer(s).isHuman &&
    guard < 12
  ) {
    guard += 1;
    const p = currentPlayer(s);
    const opps = opponentsOf(s, p.id);
    const target = [...opps].sort((a, b) => a.hp - b.hp)[0];

    if (!s.actionsUsed.sequence && p.hand.length >= 2) {
      const res = attemptAscension(s, rng);
      if (res.ok) continue;
    }

    if (!s.actionsUsed.standard) {
      const playable = p.hand
        .map((c) => ({ c, d: getCardDef(c.defId) }))
        .filter(({ d }) => p.sp >= d.spCost)
        .sort((a, b) => {
          const score = (t: string) =>
            t === "spell" ? 3 : t === "weapon" ? 2 : t === "utility" ? 2 : 1;
          return score(b.d.type) - score(a.d.type);
        });

      let played = false;
      for (const { c, d } of playable) {
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

    if (!s.actionsUsed.sequence) {
      const seq = getSequence(p.pathwayId, p.sequence);
      if (p.sp >= seq.abilityCost) {
        const r = castSequenceAbility(s, target?.id, rng);
        if (r.ok) continue;
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
