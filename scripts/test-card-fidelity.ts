/**
 * Cards must do what their text says. Run: npx tsx scripts/test-card-fidelity.ts
 */
import { readFileSync } from "node:fs";
import { buildMainDeckCounts, CARD_DEFS, getCardDef, playCost } from "../src/game/cards";
import {
  activateArtifactPower,
  createGame,
  currentPlayer,
  drawCards,
  endTurn,
  performAttack,
  playCardFromHand,
  getRng,
} from "../src/game/engine";
import { PATHWAYS } from "../src/game/pathways";
import { HANDLED_ABILITY_IDS } from "../src/game/unique-abilities";
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
    "sefirah searches by card value, not deck order",
    ids.includes("flaming_spear") && ids.includes("frost_armor"),
    ids.join(","),
  );
}

// Arcana Concealment: the 78-card deck is unchanged. Expose with a Standard action.
{
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["sun"],
    seed: 5,
    humanName: "Tester",
    arcanaConcealment: true,
  });
  const dealt = [
    ...state.deck,
    ...state.discard,
    ...state.players.flatMap((p) => [
      ...p.hand,
      ...(p.weapon ? [p.weapon] : []),
      ...(p.artifact ? [p.artifact] : []),
      ...(p.trap ? [p.trap] : []),
      ...p.charms,
    ]),
  ];
  check("concealment does not add cards", dealt.length === 78, String(dealt.length));
  check(
    "no Major Arcana card is in the game",
    dealt.every((c) => c.defId !== "major_arcana"),
  );
  const me = currentPlayer(state);
  const foe = state.players.find((p) => p.id !== me.id)!;
  check("both start concealed", !me.revealed && !foe.revealed);
  const missed = performAttack(state, foe.id, getRng(state));
  check("cannot attack a concealed player", !missed.ok);
  check("failed attack does not expose the attacker", !me.revealed);
  const blade = getCardDef("slumbering_blade");
  check("a rare costs its printed Spirituality at Sequence 9", playCost(blade, 9) === blade.spCost);
  check("a rare costs its printed Spirituality at Sequence 2", playCost(blade, 2) === blade.spCost);
  me.sp = playCost(blade, me.sequence);
  const card = give(state, me, "slumbering_blade");
  const played = playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("a rare card exposes the target", played.ok && !!foe.revealed, played.error);
  check("playing a rare leaves you concealed", !me.revealed);
  check("their board was shown", state.reveals[0]?.subjectName === foe.name);
  check("playing a card leaves the draw available", !state.actionsUsed.standard);
  const second = give(state, me, "paper_figurine");
  me.sp = 4;
  const again = playCardFromHand(state, second.instanceId, foe.id, getRng(state));
  check("a second card can be played in the same turn", again.ok, again.error);
  const swing = performAttack(state, foe.id, getRng(state));
  check("attacking an exposed player is legal", swing.ok, swing.error);
  check("the attacker is now exposed", !!me.revealed);
}

{
  const commons = CARD_DEFS.filter((c) => c.rarity === "common");
  const pairCounts = new Map<string, number>();
  for (const card of commons) {
    const key = [...card.ingredients].sort().join("+");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const uneven = [...pairCounts.entries()].filter(([, n]) => n !== 2);
  check(
    "each common pair is printed twice",
    commons.length === 56 && pairCounts.size === 28 && uneven.length === 0,
    uneven.map(([k, n]) => `${k}:${n}`).join(" ") || String(commons.length),
  );
  const rares = CARD_DEFS.filter((c) => c.rarity === "rare" && c.type !== "artifact");
  const badRare = rares.filter((c) => c.ingredients.length !== 3);
  check("non-relic rares carry 3 ingredients", rares.length === 20 && badRare.length === 0);
  check(
    "relics are two copies of one rare",
    CARD_DEFS.find((c) => c.id === "mirror_arrodes")?.ingredients.join() === "R1,R1" &&
      CARD_DEFS.find((c) => c.id === "wishing_lamp")?.ingredients.join() === "R2,R2",
  );
  let overlap = "";
  for (const pathway of PATHWAYS) {
    const rows = [...pathway.sequences].filter((s) => s.sequence <= 8).sort((a, b) => b.sequence - a.sequence);
    for (let i = 0; i < rows.length - 1; i++) {
      const a = new Set(rows[i]!.recipe);
      const shared = rows[i + 1]!.recipe.filter((tag) => a.has(tag));
      if (shared.length) overlap += `${pathway.id} ${rows[i]!.sequence}/${rows[i + 1]!.sequence} `;
    }
  }
  check("consecutive sequences share no ingredients", overlap === "", overlap);
  let dup = "";
  for (const seq of [7, 6, 5, 4, 3, 2, 1, 0]) {
    const seen = new Set<string>();
    for (const pathway of PATHWAYS) {
      const key = pathway.sequences.find((s) => s.sequence === seq)!.recipe.join(",");
      if (seen.has(key)) dup += `${pathway.id}@${seq} `;
      seen.add(key);
    }
  }
  check("same-level recipes differ from Seq 7 down", dup === "", dup);
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

{
  const counts = buildMainDeckCounts();
  const total = counts.reduce((n, c) => n + c.copies, 0);
  const commons = counts.filter((c) => getCardDef(c.defId).rarity === "common");
  const rareCount = counts.filter((c) => getCardDef(c.defId).rarity === "rare");
  check("base deck is 78 cards", total === 78, String(total));
  check("the deck is 56 common and 22 rare", commons.length === 56 && rareCount.length === 22, `${commons.length}+${rareCount.length}`);
  check("no card is duplicated", counts.every((c) => c.copies === 1));
  check("Major Arcana is not a card", !counts.some((c) => c.defId === "major_arcana"));
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["sun"],
    seed: 42,
    humanName: "Tester",
  });
  const me = currentPlayer(state);
  const seen = new Map<string, number>();
  for (const c of [...state.deck, ...state.players.flatMap((p) => p.hand)]) {
    seen.set(c.defId, (seen.get(c.defId) ?? 0) + 1);
  }
  check(
    "a dealt game contains each card once",
    seen.size === 78 && [...seen.values()].every((n) => n === 1),
    `${seen.size} kinds`,
  );
  const last = state.deck.pop()!;
  state.discard = state.deck;
  state.deck = [last];
  const discarded = state.discard.length;
  drawCards(state, me, 1, getRng(state));
  check("drawing the last card reshuffles the discard", state.deck.length === discarded, String(state.deck.length));
  check(
    "the card just drawn stays in hand",
    me.hand.some((c) => c.instanceId === last.instanceId) &&
      !state.deck.some((c) => c.instanceId === last.instanceId),
  );
}

{
  const { state, me, foe } = boot();
  state.discard.push(
    { instanceId: "spear-disc", defId: "flaming_spear" },
    { instanceId: "mim-old", defId: "scribes_mimicry" },
  );
  const before = foe.hp;
  me.sp = 20;
  const card = give(state, me, "scribes_mimicry");
  const played = playCardFromHand(state, card.instanceId, foe.id, getRng(state));
  check("two mimicries do not recurse", played.ok, played.error);
  check("mimicry replays the earlier spell", foe.hp < before, `hp ${foe.hp}`);
}

{
  const engine = readFileSync(new URL("../src/game/engine.ts", import.meta.url), "utf8");
  const cased = new Set([...engine.matchAll(/case "([a-z0-9_]+)":/g)].map((m) => m[1]));
  const handled = new Set<string>(HANDLED_ABILITY_IDS);
  const missing: string[] = [];
  for (const path of PATHWAYS) {
    for (const seq of path.sequences) {
      if (seq.abilityId === "apotheosis") continue;
      if (!cased.has(seq.abilityId) && !handled.has(seq.abilityId)) missing.push(seq.abilityId);
    }
  }
  check("every Sequence ability has its own effect", missing.length === 0, missing.join(", "));
}

console.log(failed ? `\n${failed} fidelity checks failed` : "\nAll card fidelity checks passed.");
process.exit(failed ? 1 : 0);
