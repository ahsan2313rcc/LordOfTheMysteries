/**
 * Cards must do what their text says. Run: npx tsx scripts/test-card-fidelity.ts
 */
import { CARD_DEFS, getCardDef } from "../src/game/cards";
import {
  activateArtifactPower,
  createGame,
  currentPlayer,
  endTurn,
  performAttack,
  playCardFromHand,
  getRng,
} from "../src/game/engine";
import { PATHWAYS } from "../src/game/pathways";
import type { GameState, PlayerState } from "../src/game/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log("  ✓", name);
  else {
    failed += 1;
    console.error("  ✗", name, detail);
  }
}

function boot(): { state: GameState; me: PlayerState; foe: PlayerState } {
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["sun"],
    seed: 42,
    humanName: "Tester",
  });
  const me = currentPlayer(state);
  const foe = state.players.find((p) => p.id !== me.id)!;
  me.sp = 10;
  foe.sp = 10;
  me.hand = [];
  return { state, me, foe };
}

function give(state: GameState, p: PlayerState, defId: string) {
  const card = { instanceId: `t-${defId}-${p.hand.length}-${Math.random()}`, defId };
  p.hand.push(card);
  return card;
}

// Aegis: target self → Sanity Block, otherwise HP Block
{
  const { state, me } = boot();
  const card = give(state, me, "aegis_mind");
  const r = playCardFromHand(state, card.instanceId, me.id, getRng(state));
  check("aegis casts on self", r.ok, r.error);
  check("aegis self is Sanity Block", me.status.sanityBlock === 2, `got ${me.status.sanityBlock}`);
  check("aegis self is not HP Block", me.status.block === 0, `block ${me.status.block}`);
}
{
  const { state, me, foe } = boot();
  const card = give(state, me, "aegis_mind");
  playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("aegis vs foe is HP Block", me.status.block === 2, `block ${me.status.block}`);
}

// Spirit Bullet: 0 SP means no passive SP next Begin
{
  const { state, me, foe } = boot();
  foe.sp = 2;
  const card = give(state, me, "spirit_bullet");
  playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("spirit bullet drains to 0", foe.sp === 0, `sp ${foe.sp}`);
  check("spirit bullet flags no passive", foe.status.noPassiveSp === true);
}

// Grafted Chains discards the equipment and costs 1 SP
{
  const { state, me, foe } = boot();
  foe.trap = { instanceId: "trap-graft", defId: "grafted_chains" };
  const card = give(state, me, "poisoned_revolver");
  const before = me.sp;
  playCardFromHand(state, card.instanceId, undefined, getRng(state));
  check("grafted chains removed the weapon", !me.weapon, me.weapon?.defId);
  check("grafted chains spent 1 SP", me.sp === before - 1 - getCardDef("poisoned_revolver").spCost, `sp ${me.sp}`);
  check("grafted chains trap is spent", !foe.trap);
}

// Wishing Lamp offers HP, Sanity, or SP
{
  const { state, me } = boot();
  me.artifact = { instanceId: "lamp", defId: "wishing_lamp" };
  me.sanity = 10;
  const r = activateArtifactPower(state, undefined, getRng(state), "sp");
  check("lamp wish ok", r.ok, r.error);
  check("lamp grants 3 SP", me.sp === 13, `sp ${me.sp}`);
}

// Sefirah Aura searches, it does not only take the top two blindly
{
  const { state, me } = boot();
  state.deck = [
    { instanceId: "d1", defId: "flaming_spear" },
    { instanceId: "d2", defId: "potion_ingredients" },
    { instanceId: "d3", defId: "frost_armor" },
  ];
  me.actingMet = true;
  const card = give(state, me, "sefirah_aura");
  playCardFromHand(state, card.instanceId, undefined, getRng(state));
  const ids = me.hand.map((c) => c.defId);
  check("sefirah puts two cards in hand", ids.length >= 2, ids.join(","));
  check(
    "sefirah can find Potion Ingredients that were not on top",
    ids.includes("potion_ingredients"),
    ids.join(","),
  );
}

// Arcana Concealment: one card per player, expose a board, reveal yourself only by attacking them
{
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["sun"],
    seed: 5,
    humanName: "Tester",
    arcanaConcealment: true,
  });
  const arcana = state.deck.filter((c) => c.defId === "major_arcana").length
    + state.players.reduce((n, p) => n + p.hand.filter((c) => c.defId === "major_arcana").length, 0);
  check("arcana count equals players", arcana === 2, String(arcana));
  const me = currentPlayer(state);
  const foe = state.players.find((p) => p.id !== me.id)!;
  me.sp = 5;
  check("both start concealed", !me.revealed && !foe.revealed);
  const missed = performAttack(state, foe.id, getRng(state));
  check("cannot attack a concealed player", !missed.ok);
  check("failed attack does not expose the attacker", !me.revealed);
  const card = give(state, me, "major_arcana");
  const played = playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("arcana play exposes the target", played.ok && !!foe.revealed, played.error);
  check("playing an arcana leaves you concealed", !me.revealed);
  check("their board was shown", (state.reveals[0]?.cards.length ?? 0) > 0);
  const swing = performAttack(state, foe.id, getRng(state));
  check("attacking an exposed player is legal", swing.ok, swing.error);
  check("the attacker is now exposed", !!me.revealed);
}

{
  const multi = CARD_DEFS.filter(
    (c) => c.id !== "potion_ingredients" && c.id !== "major_arcana" && c.ingredients.length !== 1,
  );
  check("every card is a single ingredient", multi.length === 0, multi.map((c) => c.id).join(","));
  let overlap = "";
  for (const pathway of PATHWAYS) {
    const rows = [...pathway.sequences].filter((s) => s.sequence > 0).sort((a, b) => b.sequence - a.sequence);
    for (let i = 0; i < rows.length - 1; i++) {
      const a = new Set(rows[i]!.recipe);
      const shared = rows[i + 1]!.recipe.filter((tag) => a.has(tag));
      if (shared.length) overlap += `${pathway.id} ${rows[i]!.sequence}/${rows[i + 1]!.sequence} `;
    }
  }
  check("consecutive sequences share no ingredients", overlap === "", overlap);
}

{
  const { state, me, foe } = boot();
  const myHp = me.hp;
  const foeHp = foe.hp;
  foe.sanity = 1;
  me.sp = 5;
  const card = give(state, me, "mental_piercing");
  const played = playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("sanity damage can break", played.ok && !!foe.sanityBroken && foe.alive, played.error);
  endTurn(state, getRng(state));
  check("broken body hits the survivor", me.hp === myHp - 1, String(me.hp));
  check("broken body hits itself", foe.alive && foe.hp === foeHp - 1, String(foe.hp));
  check("the match continues while the body stands", state.phase !== "gameover");
}

{
  const { state, me, foe } = boot();
  foe.sanity = 1;
  foe.charms.push({ instanceId: "cog", defId: "cogitation" });
  me.sp = 5;
  const card = give(state, me, "mental_piercing");
  playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("cogitation holds the first break at 1", foe.sanity === 1 && !foe.sanityBroken, String(foe.sanity));
}

{
  const { state, me, foe } = boot();
  foe.weapon = { instanceId: "rare-w", defId: "creeping_hunger" };
  foe.charms.push({ instanceId: "common-c", defId: "sunbird" });
  me.sp = 10;
  const bribe = give(state, me, "bribe");
  playCardFromHand(state, bribe.instanceId, foe.id, getRng(state));
  check("bribe takes the common charm", foe.charms.length === 0 && foe.weapon?.defId === "creeping_hunger");
  check("bribe does not give a card back", !foe.hand.some((c) => c.defId === "sunbird"));
  state.actionsUsed.standard = false;
  const theft = give(state, me, "errors_theft");
  playCardFromHand(state, theft.instanceId, foe.id, getRng(state));
  check(
    "error's theft takes the rare weapon",
    !foe.weapon && me.hand.some((c) => c.defId === "creeping_hunger"),
  );
}

console.log(failed ? `\n${failed} fidelity checks failed` : "\nAll card fidelity checks passed.");
process.exit(failed ? 1 : 0);
