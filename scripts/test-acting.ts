/**
 * Smoke tests for sticky Acting Conditions (no vitest required).
 * Run: npx tsx scripts/test-acting.ts
 */
import {
  bankTurnProgress,
  emptyFlags,
  evaluateActing,
} from "../src/game/acting";
import {
  attemptAscension,
  castSequenceAbility,
  createGame,
  currentPlayer,
  endTurn,
  getRng,
  performAttack,
} from "../src/game/engine";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

console.log("Acting persistence");
{
  const state = createGame({
    humanPathwayId: "giant",
    aiPathwayIds: ["sun"],
    seed: 99,
  });
  const human = state.players[0]!;
  assert(!human.actingMet, "starts unmet");

  human.weapon = { instanceId: "w1", defId: "purifying_broadsword" };
  human.sp = 5;
  const ai = state.players[1]!;
  assert(performAttack(state, ai.id, getRng(state)).ok, "attack succeeds");
  assert(human.turnFlags.attackedWithWeapon, "weapon flag set");
  assert(human.actingMet, "actingMet locked after weapon attack");

  endTurn(state, getRng(state));
  let guard = 0;
  while (currentPlayer(state).id !== human.id && guard < 8) {
    endTurn(state, getRng(state));
    guard += 1;
  }
  assert(currentPlayer(state).id === human.id, "returned to human turn");
  assert(human.actingMet, "actingMet still true on later turn");
  assert(human.actingBank.attackedWithWeapon, "bank retained weapon flag");
}

console.log("Partial progress banking");
{
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["error"],
    seed: 7,
  });
  const p = state.players[0]!;
  p.turnFlags.lookedAtHand = true;
  bankTurnProgress(p);
  assert(!p.actingMet, "half condition not enough");
  assert(p.actingBank.lookedAtHand, "hand progress banked");

  p.turnFlags = emptyFlags();
  p.turnFlags.lookedAtDeck = true;
  assert(evaluateActing(p), "combined bank+turn meets condition");
  bankTurnProgress(p);
  assert(p.actingMet, "locked after second piece");

  p.turnFlags = emptyFlags();
  assert(p.actingMet, "sticky after turn flag wipe");
  assert(evaluateActing(p), "evaluate still true from bank");
}

console.log("Ascension clears bank");
{
  const state = createGame({
    humanPathwayId: "giant",
    aiPathwayIds: ["sun"],
    seed: 3,
  });
  const p = state.players[0]!;
  p.actingMet = true;
  p.actingBank.attackedWithWeapon = true;
  p.sp = 10;
  p.sanity = 20;
  // Seq 8 Gladiator recipe: C6 + C8
  p.hand = [
    { instanceId: "a", defId: "executioners_axe" }, // has C6
    { instanceId: "b", defId: "requiem_charm" }, // has C8
  ];
  const before = p.sanity;
  const r = attemptAscension(state, getRng(state));
  assert(r.ok, `ascend ok (${r.error ?? "ok"})`);
  assert(p.sequence === 8, "now Seq 8");
  assert(p.sanity === before, "potion costs no Sanity");
  assert(!state.actionsUsed.sequence, "potion leaves the Sequence action free");
  assert(!p.actingMet, "actingMet cleared for new Sequence");
  assert(!p.actingBank.attackedWithWeapon, "bank reset");
  const cast = castSequenceAbility(state, state.players[1]!.id, getRng(state));
  assert(cast.ok, `ability after potion (${cast.error ?? "ok"})`);
  assert(p.sanity === before - 1, "Sequence 8 ability costs 1 Sanity");
  assert(state.actionsUsed.sequence, "ability spends the Sequence action");
}

console.log("Fool Divination locks Seq 9");
{
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["darkness"],
    seed: 11,
  });
  const p = state.players[0]!;
  p.sp = 5;
  assert(
    castSequenceAbility(state, state.players[1]!.id, getRng(state)).ok,
    "divination casts",
  );
  assert(p.actingMet, "Fool Seq 9 acting locked");
}

console.log("\nAll acting tests passed.");
