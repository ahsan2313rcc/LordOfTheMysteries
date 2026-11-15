/**
 * Cards must do what their text says. Run: npx tsx scripts/test-card-fidelity.ts
 */
import { getCardDef } from "../src/game/cards";
import {
  activateArtifactPower,
  createGame,
  currentPlayer,
  playCardFromHand,
  getRng,
} from "../src/game/engine";
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

console.log(failed ? `\n${failed} fidelity checks failed` : "\nAll card fidelity checks passed.");
process.exit(failed ? 1 : 0);
