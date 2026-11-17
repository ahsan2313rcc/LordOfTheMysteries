import { writeFileSync } from "node:fs";
import { CARD_DEFS, MAJOR_SYMBOL, SUIT_SYMBOL, TYPE_SYMBOL, tarotFace } from "../src/game/cards";
import { INGREDIENT_SYMBOL, PATHWAYS, abilitySanityCost, curveLabel, ingredientMark, pathwayCurve } from "../src/game/pathways";
import type { CardType, Ingredient } from "../src/game/types";

const TYPE_ORDER: CardType[] = ["weapon", "spell", "utility", "charm", "trap", "artifact"];
const TYPE_LABEL: Record<CardType, string> = {
  weapon: "Weapons",
  spell: "Spells",
  utility: "Utilities",
  charm: "Charms",
  trap: "Traps",
  artifact: "Artifacts",
};

function ingredients(tags: Ingredient[]): string {
  if (!tags.length) return "None";
  return tags.map((tag) => ingredientMark(tag)).join(", ");
}

const lines: string[] = [];
const push = (line = "") => lines.push(line);

push("# Lord of the Mysteries: Ascension — Rulebook");
push();
push("Two players or four. A free-for-all of potions, Spirituality, and Sanity.");
push();
push("## How you win");
push();
push("- **Last Standing.** Every other contender is at 0 HP.");
push("- **Apotheosis.** Drink the Sequence 0 potion. That player wins immediately.");
push("- **Madness.** If every living player is lost to Sanity, nobody wins.");
push();
push("## The board");
push();
push(
  `Each Beyonder starts at Sequence 9 with 20 HP, 20 Sanity, 0 Spirituality, and 3 cards. HP, Sanity, and Spirituality each cap at 20. Spirituality stays between turns. The deck is ${CARD_DEFS.length} cards, one of each. When the last card is drawn, the discard is shuffled into a new deck.`,
);
push();
push("## A turn");
push();
push("1. **Begin.** Gain the Spirituality printed on your current Sequence. If you took no HP since your last Begin, heal 1. If you took no Sanity from an opponent, restore 1 Sanity. From Sequence 6 down, also knit 1 HP. Then draw 1. A charm may add to that draw.");
push("2. **Act.**");
push("   - **Draw once.** The Standard action is one extra draw.");
push("   - **Play any number of cards** while you can pay the printed Spirituality. Commons are 1, rares are 4, the two relic artifacts are 6. Traps spend the Attack action.");
push("   - **Cast your Sequence ability once.** Pay Sanity: 1 at Sequence 9–7, 2 at 6–4, 3 at 3–1. Casting locks Acting for that Sequence.");
push("   - **Attack once.** A bare hand deals no damage. You need a weapon, or an ability that empowers the swing. The attack itself is free.");
push("   - **Drink the potion** when Acting is locked and the recipe is in hand or on your gear. The potion costs no Sanity. Show the cards; they stay where they are, marked, and cannot pay the next potion. Drinking draws 1 and does not spend the Sequence action, so you may cast and drink on the same turn.");
push("3. **End.** Temporary Block and Evade clear. A hand over 7 sets aside cards that are not paying the current potion. Slumber Charm raises the limit by 2.");
push();
push("A late-peak pathway draws 1 more when it casts at Sequence 6 or lower. A mid-peak pathway draws 1 more when it casts at Sequence 6–4. The Mother, at 10 HP or less, mends 2 at Begin, and after she drinks she may take a useful ingredient from the top 3 of the deck.");
push();
push("At 0 Sanity you are no longer a contender: no draw, no cards, no potion. On each of your Begin phases the body deals 1 unblockable HP to every living player, including itself.");
push();
push("Weapons, charms, and artifacts stay equipped. A new one of the same kind replaces the old. You may keep two charms. Traps sit face down and interrupt the printed moment. Equipped cards still pay the potion.");
push();
push("## Peaks");
push();
for (const band of ["early", "mid", "late", "even"] as const) {
  const names = PATHWAYS.filter((pathway) => pathwayCurve(pathway.id) === band)
    .sort((a, b) => Number(a.arcana) - Number(b.arcana))
    .map((pathway) => pathway.name);
  push(`- **${curveLabel(band)}.** ${names.join(", ")}.`);
}
push();
push("Early is heaviest at Sequence 9–7, mid at 6–4, late at 3–1. Even holds a similar weight the whole climb. The ability text stays that pathway's own.");
push();
push("## Arcana Concealment");
push();
push("Off unless you check it when you deal. Everyone starts concealed. Playing a rare exposes an opponent and their board. You stay concealed until you attack an exposed player. A concealed player cannot be the target of an Attack. Spells, abilities, and items still do what they say.");
push();
push("## Ingredients");
push();
for (const [tag, symbol] of Object.entries(INGREDIENT_SYMBOL)) push(`- ${ingredientMark(tag)} (${tag}, ${symbol})`);
push();
push(`Suits: ${Object.entries(SUIT_SYMBOL).map(([name, symbol]) => `${symbol} ${name}`).join(", ")}. Major: ${MAJOR_SYMBOL}.`);
push();
push(`Card types: ${Object.entries(TYPE_SYMBOL).map(([name, symbol]) => `${symbol} ${name}`).join(", ")}.`);
push();
push("## Cards");
push();
for (const kind of TYPE_ORDER) {
  const group = CARD_DEFS.filter((card) => card.type === kind).sort((a, b) => a.name.localeCompare(b.name));
  push(`### ${TYPE_LABEL[kind]}`);
  push();
  for (const card of group) {
    const face = tarotFace(card.id);
    push(`#### ${TYPE_SYMBOL[card.type]} ${card.name}`);
    push();
    push(
      `${face.mark}${face.kind === "major" ? ` ${face.name}` : ""}. ${card.rarity}, ${card.spCost} Spirituality. Ingredients: ${ingredients(card.ingredients)}.`,
    );
    push();
    push(card.text);
    push();
  }
}
push("## Arcana");
push();
const pathways = [...PATHWAYS].sort((a, b) => Number(a.arcana) - Number(b.arcana));
for (const pathway of pathways) {
  push(`### ${pathway.arcana}. ${pathway.name}`);
  push();
  push(`${pathway.theme}. ${curveLabel(pathwayCurve(pathway.id))}.`);
  push();
  const steps = [...pathway.sequences].sort((a, b) => b.sequence - a.sequence);
  for (const seq of steps) {
    push(`#### Sequence ${seq.sequence} — ${seq.title}`);
    push();
    const sanity = seq.sequence > 0 ? `${abilitySanityCost(seq.sequence)} Sanity. ` : "";
    push(`**${seq.abilityName}.** ${sanity}${seq.spGain} Spirituality at Begin.`);
    push();
    push(seq.abilityText);
    push();
    if (seq.sequence > 0) {
      push(`Acting: ${seq.actingCondition}`);
      push();
      push(`Recipe: ${ingredients(seq.recipe)}.`);
      push();
    }
  }
}

const body = lines.join("\n");
writeFileSync(new URL("../docs/rulebook.md", import.meta.url), body);
console.log("cards", CARD_DEFS.length, "pathways", PATHWAYS.length, "chars", body.length);
