/**
 * Passives + early Acting via Sequence Ability.
 * Run: npx tsx scripts/test-passives-acting.ts
 */
import { emptyFlags } from "../src/game/acting";
import { PATHWAYS } from "../src/game/pathways";
import {
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

console.log("Passive SP always generates");
{
  const state = createGame({
    humanPathwayId: "fool",
    aiPathwayIds: ["sun"],
    seed: 1,
  });
  const p = state.players[0]!;
  // After opening begin, Seq 9 Fool should have +1 SP
  assert(p.sp >= 1, `opening SP gain (have ${p.sp})`);
}

console.log("Passive HP/Sanity after a clean cycle");
{
  const state = createGame({
    humanPathwayId: "sun",
    aiPathwayIds: ["door"],
    seed: 2,
  });
  const human = state.players[0]!;
  const startHp = human.hp;
  const startSan = human.sanity;
  // Clear cycle and end without taking damage
  state.cycleDamage[human.id] = { hpTaken: false, sanityTaken: false };
  human.hp = 15;
  human.sanity = 15;
  endTurn(state, getRng(state));
  // Advance until human again
  let g = 0;
  while (currentPlayer(state).id !== human.id && g < 8) {
    endTurn(state, getRng(state));
    g++;
  }
  assert(human.hp === 16, `HP +1 when no HP taken (got ${human.hp})`);
  assert(human.sanity === 16, `Sanity +1 when no Sanity taken (got ${human.sanity})`);
  void startHp;
  void startSan;
}

console.log("HP withheld when damaged mid-cycle");
{
  const state = createGame({
    humanPathwayId: "sun",
    aiPathwayIds: ["tyrant"],
    seed: 3,
  });
  const human = state.players[0]!;
  endTurn(state, getRng(state));
  // AI turn — force damage onto human via cycle flag as if attacked
  state.cycleDamage[human.id] = { hpTaken: true, sanityTaken: false };
  human.hp = 15;
  human.sanity = 15;
  // finish AI and return
  let g = 0;
  while (currentPlayer(state).id !== human.id && g < 8) {
    endTurn(state, getRng(state));
    g++;
  }
  assert(human.hp === 15, `no HP regen after HP taken (got ${human.hp})`);
  assert(human.sanity === 16, `Sanity still regens (got ${human.sanity})`);
}

console.log("Early Seq 9 Acting via Sequence Ability alone (or ability+attack)");
{
  const soloAbility = [
    "fool", // divination
    "error", // sleight
    "sun", // courage
    "tyrant", // balance
    "visionary", // observe
    "door", // magic door
    "darkness", // night vision
    "death", // scavenge
    "priest", // tracking
  ] as const;

  for (const id of soloAbility) {
    const state = createGame({
      humanPathwayId: id,
      aiPathwayIds: ["giant"],
      seed: 40 + id.length,
    });
    const p = state.players[0]!;
    p.sp = 5;
    const r = castSequenceAbility(state, state.players[1]!.id, getRng(state));
    assert(r.ok, `${id} ability casts`);
    assert(p.actingMet, `${PATHWAYS.find((x) => x.id === id)!.name} Seq 9 Acting locks via ability`);
  }

  // Giant: mastery + attack
  {
    const state = createGame({
      humanPathwayId: "giant",
      aiPathwayIds: ["sun"],
      seed: 77,
    });
    const p = state.players[0]!;
    p.sp = 5;
    assert(castSequenceAbility(state, state.players[1]!.id, getRng(state)).ok, "mastery");
    assert(performAttack(state, state.players[1]!.id, getRng(state)).ok, "attack");
    assert(p.actingMet, "Twilight Giant Seq 9 via Mastery + Attack");
  }

  // Fool Seq 8: acrobatics + attack
  {
    const state = createGame({
      humanPathwayId: "fool",
      aiPathwayIds: ["sun"],
      seed: 88,
    });
    const p = state.players[0]!;
    p.sequence = 8;
    p.actingMet = false;
    p.actingBank = emptyFlags();
    p.turnFlags = emptyFlags();
    p.sp = 5;
    assert(castSequenceAbility(state, state.players[1]!.id, getRng(state)).ok, "acrobatics");
    assert(performAttack(state, state.players[1]!.id, getRng(state)).ok, "attack after acrobat");
    assert(p.actingMet, "Fool Seq 8 via Acrobatics + Attack");
  }
}

console.log("\nAll passive/acting tests passed.");
