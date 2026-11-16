import { matchRecipe } from "./ascension";
import { getCardDef, playCost } from "./cards";
import {
  activateArtifactPower,
  attemptAscension,
  castSequenceAbility,
  contendArtifact,
  currentPlayer,
  drawAsStandard,
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
  if (!me?.alive || me.sanityBroken) return -100000;
  if (state.phase === "gameover" && state.winnerId === myId) return 100000;
  if (state.phase === "gameover") return -80000;

  const opps = state.players.filter((p) => p.alive && p.id !== myId);
  if (opps.length === 0) return 100000;

  let s = 0;
  // One Sequence step outranks a finished recipe, so drinking beats sitting on the cards.
  s += (9 - me.sequence) * 200;
  if (me.actingMet) s += 24;
  s += me.hp * 6 + me.sanity * 7 + Math.min(me.sp, 12) * 0.7;
  s += Math.min(me.hand.length, 7) * 1.1;
  if (me.weapon && !me.status.weaponDisabled) s += 18;
  s += me.charms.length * 5;
  if (me.artifact) s += 12;
  if (me.trap) s += 6;
  if (me.hp <= 6) s -= 18;
  if (me.sanity <= 3) s -= 28;

  const recipe = matchRecipe(me);
  if (recipe && recipe.needed.length > 0) {
    const have = recipe.needed.length - recipe.remaining.length;
    s += (have / recipe.needed.length) * 90;
    if (recipe.canPay) s += 180;
  }

  for (const o of opps) {
    s -= o.hp * 6;
    s -= o.sanity * 6;
    s -= (9 - o.sequence) * 36;
    s -= Math.min(o.sp, 10) * 0.35;
    if (o.actingMet) s -= 10;
    if (o.weapon && !o.status.weaponDisabled) s -= 8;
    if (o.hp <= 4) s += 16;
    if (o.sanityBroken) {
      s += 80;
      s -= o.hp * 4;
    } else if (o.sanity <= 8) s += (9 - o.sanity) * 6;
    if (state.arcanaConcealment && o.revealed) s += 16;
  }
  if (state.arcanaConcealment && !me.revealed) s += 28;
  s += (state.players.length - 1 - opps.length) * 90;
  return s;
}

function cloneForSearch(state: GameState): GameState {
  const clone = structuredClone(state);
  clone.log = clone.log.slice(-2);
  clone.reveals = [];
  return clone;
}

/** Apply a line, take a free swing if one is left, then let the next player swing back. */
function exchangeScore(state: GameState, myId: string, apply: (g: GameState) => boolean): number | null {
  const clone = cloneForSearch(state);
  if (!apply(clone)) return null;
  if (clone.phase === "action" && currentPlayer(clone).id === myId && !clone.actionsUsed.attack) {
    const prey = warTargets(clone, myId).sort((a, b) => a.hp - b.hp)[0];
    if (prey) performAttack(clone, prey.id, getRng(clone));
  }
  if (clone.phase === "action" && currentPlayer(clone).id === myId && !isOver(clone)) {
    endTurn(clone, getRng(clone));
  }
  if (clone.phase === "action" && currentPlayer(clone).id !== myId) {
    const me = clone.players.find((p) => p.id === myId);
    if (me?.alive && !clone.actionsUsed.attack) performAttack(clone, myId, getRng(clone));
  }
  return score(clone, myId);
}

function isOver(state: GameState): boolean {
  return (state.phase as string) === "gameover";
}

function warTargets(state: GameState, myId: string): PlayerState[] {
  const opps = opponentsOf(state, myId);
  if (!state.arcanaConcealment) return opps;
  return opps.filter((o) => o.revealed);
}

type Wish = "hp" | "sanity" | "sp";

function tryAction(state: GameState, myId: string, apply: (s: GameState) => boolean): number | null {
  const clone = cloneForSearch(state);
  const before = `${state.actionsUsed.standard}${state.actionsUsed.sequence}${state.actionsUsed.attack}${state.extraStandard ?? 0}${state.potionDrunk ? 1 : 0}`;
  const ok = apply(clone);
  if (!ok) return null;
  const after = `${clone.actionsUsed.standard}${clone.actionsUsed.sequence}${clone.actionsUsed.attack}${clone.extraStandard ?? 0}${clone.potionDrunk ? 1 : 0}`;
  const tempo = before !== after || clone.phase !== "action" || clone.turnNumber !== state.turnNumber ? 3 : 0;
  return score(clone, myId) + tempo;
}

/** Search one ply of every legal action and take the best. */
export function runAiTurn(state: GameState): GameState {
  const s = state;
  let guard = 0;

  while (
    s.phase === "action" &&
    currentPlayer(s).alive &&
    !currentPlayer(s).sanityBroken &&
    !currentPlayer(s).isHuman &&
    guard < 14
  ) {
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

    if (!s.potionDrunk && matchRecipe(p)?.canPay) {
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

    const canStrike =
      (!!p.weapon && !p.status.weaponDisabled) ||
      p.status.attackModifier > 0 ||
      !!p.status.unblockableAttack;
    if (!s.actionsUsed.attack && canStrike) {
      for (const t of warTargets(s, myId)) consider((g) => performAttack(g, t.id, getRng(g)).ok);
    }

    if (!s.actionsUsed.standard) {
      consider((g) => drawAsStandard(g, getRng(g)).ok);
    }

    if (!s.actionsUsed.standard || (s.extraStandard ?? 0) > 0) {
      const targets: PlayerState[] = [...opps, p];
      for (const card of p.hand) {
        const d = getCardDef(card.defId);
        if (p.sp < playCost(d, p.sequence) + (p.nextCardTax ?? 0)) continue;
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

    const recipeNow = matchRecipe(p);
    const recipeClose =
      !!recipeNow &&
      recipeNow.needed.length > 0 &&
      (recipeNow.needed.length - recipeNow.remaining.length) / recipeNow.needed.length >= 0.6 &&
      p.sequence <= 6;
    const potionReady = !s.potionDrunk && !!recipeNow?.canPay;
    if (
      canStrike &&
      !potionReady &&
      !recipeClose &&
      !s.actionsUsed.attack &&
      warTargets(s, myId).length
    ) {
      const swing = (g: GameState) => {
        const prey = warTargets(g, myId).sort((a, b) => a.hp - b.hp)[0];
        return prey ? performAttack(g, prey.id, getRng(g)).ok : false;
      };
      const chosen = plan.run;
      const swung = exchangeScore(s, myId, swing);
      const held = exchangeScore(s, myId, chosen);
      if (swung != null && (held == null || swung > held + 0.5)) plan.run = swing;
    }

    plan.run(s);
  }

  if (s.phase === "action" && currentPlayer(s).alive && !currentPlayer(s).isHuman) {
    endTurn(s, getRng(s));
  }
  return s;
}
