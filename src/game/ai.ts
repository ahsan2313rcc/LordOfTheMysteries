import { matchRecipe } from "./ascension";
import { getCardDef } from "./cards";
import {
  activateArtifactPower,
  attemptAscension,
  castSequenceAbility,
  contendArtifact,
  currentPlayer,
  endTurn,
  getRng,
  opponentsOf,
  performAttack,
  playCardFromHand,
  sacrificeRequiem,
} from "./engine";
import type { GameState, PlayerState } from "./types";

function score(state: GameState, myId: string): number {
  const me = state.players.find((p) => p.id === myId);
  if (!me?.alive) return -100000;
  if (state.phase === "gameover" && state.winnerId === myId) return 100000;
  if (state.phase === "gameover") return -80000;

  const opps = state.players.filter((p) => p.alive && p.id !== myId);
  if (opps.length === 0) return 100000;

  let s = 0;
  s += (9 - me.sequence) * 110;
  if (me.actingMet) s += 36;
  s += me.hp * 4 + me.sanity * 2.2 + Math.min(me.sp, 14) * 1.15;
  s += Math.min(me.hand.length, 7) * 1.3;
  if (me.weapon && !me.status.weaponDisabled) s += 14;
  s += me.charms.length * 6;
  if (me.artifact) s += 14;
  if (me.trap) s += 8;
  if (me.mad) s -= 40;
  if (me.hp <= 4) s -= 22;

  const recipe = matchRecipe(me);
  if (recipe) {
    const have = recipe.needed.length - recipe.remaining.length;
    s += have * 16;
    if (recipe.canPay && me.actingMet) s += 55;
  }

  for (const o of opps) {
    s -= o.hp * 4.6;
    s -= o.sanity * 1.1;
    s -= (9 - o.sequence) * 55;
    s -= Math.min(o.sp, 10) * 0.45;
    if (o.actingMet) s -= 14;
    if (o.weapon && !o.status.weaponDisabled) s -= 6;
    if (o.mad) s += 8;
  }
  s += (state.players.length - 1 - opps.length) * 80;
  return s;
}

type Wish = "hp" | "sanity" | "sp";

function tryAction(state: GameState, myId: string, apply: (s: GameState) => boolean): number | null {
  const clone = structuredClone(state);
  // Keep RNG inputs stable across candidates without cloning the whole chronicle.
  clone.log = clone.log.slice(-2);
  clone.reveals = [];
  const before = `${state.actionsUsed.standard}${state.actionsUsed.sequence}${state.actionsUsed.attack}${state.extraStandard ?? 0}`;
  const ok = apply(clone);
  if (!ok) return null;
  const after = `${clone.actionsUsed.standard}${clone.actionsUsed.sequence}${clone.actionsUsed.attack}${clone.extraStandard ?? 0}`;
  const tempo = before !== after || clone.phase !== "action" || clone.turnNumber !== state.turnNumber ? 2.5 : 0;
  return score(clone, myId) + tempo;
}

/** Search one ply of every legal action and take the best. */
export function runAiTurn(state: GameState): GameState {
  const s = state;
  let guard = 0;

  while (s.phase === "action" && currentPlayer(s).alive && !currentPlayer(s).isHuman && guard < 14) {
    guard += 1;
    const p = currentPlayer(s);
    const myId = p.id;
    const opps = opponentsOf(s, p.id);
    const base = score(s, myId);
    let best = base;
    const plan: { run: ((g: GameState) => boolean) | null } = { run: null };

    const consider = (apply: (g: GameState) => boolean) => {
      const val = tryAction(s, myId, apply);
      if (val != null && val > best + 0.25) {
        best = val;
        plan.run = apply;
      }
    };

    if (!s.actionsUsed.sequence && p.actingMet) {
      consider((g) => attemptAscension(g, getRng(g)).ok);
    }

    if (!p.requiemUsed && p.hp < p.maxHp && p.charms.some((c) => c.defId === "requiem_charm")) {
      consider((g) => sacrificeRequiem(g).ok);
    }

    if (!s.actionsUsed.standard && p.artifact) {
      const id = p.artifact.defId;
      if (id === "wishing_lamp") {
        for (const wish of ["hp", "sanity", "sp"] as Wish[]) {
          consider((g) => activateArtifactPower(g, undefined, getRng(g), wish).ok);
        }
      } else {
        for (const t of opps) {
          consider((g) => activateArtifactPower(g, t.id, getRng(g)).ok);
        }
        consider((g) => activateArtifactPower(g, undefined, getRng(g)).ok);
      }
    }

    if (!s.actionsUsed.standard) {
      for (const o of opps) {
        if (o.artifact && p.sp >= 5) {
          consider((g) => contendArtifact(g, o.id, getRng(g)).ok);
        }
      }
    }

    if (!s.actionsUsed.sequence) {
      for (const t of opps.length ? opps : [p]) {
        consider((g) => castSequenceAbility(g, t.id, getRng(g)).ok);
      }
      consider((g) => castSequenceAbility(g, undefined, getRng(g)).ok);
    }

    if (!s.actionsUsed.attack) {
      for (const t of opps) consider((g) => performAttack(g, t.id, getRng(g)).ok);
    }

    if (!s.actionsUsed.standard || (s.extraStandard ?? 0) > 0) {
      const targets: PlayerState[] = [...opps, p];
      for (const card of p.hand) {
        const d = getCardDef(card.defId);
        if (p.sp < d.spCost + (p.nextCardTax ?? 0)) continue;
        if (d.type === "trap") {
          if (!p.trap && !s.actionsUsed.attack) {
            consider((g) => playCardFromHand(g, card.instanceId, undefined, getRng(g)).ok);
          }
          continue;
        }
        const pool = d.type === "utility" || d.id === "aegis_mind" ? targets : opps;
        const list = pool.length ? pool : targets;
        for (const t of list) {
          consider((g) => playCardFromHand(g, card.instanceId, t.id, getRng(g)).ok);
        }
      }
    }

    if (!plan.run) break;
    plan.run(s);
  }

  if (s.phase === "action" && currentPlayer(s).alive && !currentPlayer(s).isHuman) {
    endTurn(s, getRng(s));
  }
  return s;
}
