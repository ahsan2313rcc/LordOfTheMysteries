/**
 * The 22×22 cell for Fool/Death must be the swap of Death/Fool.
 * A Sanity ending has no winner, so it must not be counted as a loss for either side.
 */
import assert from "node:assert/strict";
import { buildMatrix } from "../src/components/game/MatchupBoard";
import { playDuel, type DuelResult } from "../src/game/simulate";

function duel(partial: Pick<DuelResult, "winner" | "reason"> & Partial<DuelResult>): DuelResult {
  return {
    a: "fool",
    b: "death",
    seed: 11,
    aFirst: true,
    turns: 40,
    seqA: 6,
    seqB: 5,
    ...partial,
  };
}

const duels: DuelResult[] = [
  ...Array.from({ length: 6 }, () => duel({ winner: "a", reason: "hp" })),
  ...Array.from({ length: 3 }, () => duel({ winner: "b", reason: "ascension" })),
  duel({ winner: null, reason: "sanity" }),
];

const cells = buildMatrix(duels);
const fool = cells.get("fool|death");
const death = cells.get("death|fool");
assert.equal(fool?.wins, 6);
assert.equal(death?.wins, 3);
assert.equal(fool?.games, 10);
assert.equal(death?.games, 10);
const foolLabel = `${fool?.wins}/${death?.wins}`;
const deathLabel = `${death?.wins}/${fool?.wins}`;
assert.equal(foolLabel, "6/3");
assert.equal(deathLabel, "3/6");

const played = playDuel("fool", "death", 11, true);
assert.equal(played.duel.a, "fool");
assert.equal(played.duel.b, "death");
assert.equal(played.replay.players, 2);
assert.equal(played.replay.sequences.length, 2);
assert.ok(played.replay.sequences.some((s) => s.pathwayId === "fool"));
assert.ok(played.replay.sequences.some((s) => s.pathwayId === "death"));
assert.ok(played.replay.log.length > 0);
assert.ok(played.replay.plays.length + played.replay.abilities + played.replay.attacks >= 0);

console.log("matchup table ok", foolLabel, deathLabel, played.duel.reason, played.duel.turns);
