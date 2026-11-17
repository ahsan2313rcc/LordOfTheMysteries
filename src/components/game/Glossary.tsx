"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CARD_DEFS } from "@/game/cards";
import { INGREDIENT_NAMES, PATHWAYS, abilitySanityCost, curveLabel, pathwayCurve } from "@/game/pathways";
import type { CardDef, CardType, Ingredient, PathwayDef } from "@/game/types";

const TYPE_ORDER: CardType[] = ["weapon", "spell", "utility", "charm", "trap", "artifact"];

const TYPE_LABEL: Record<CardType, string> = {
  weapon: "Weapons",
  spell: "Spells",
  utility: "Utilities",
  charm: "Charms",
  trap: "Traps",
  artifact: "Artifacts",
};

const TYPE_ONE: Record<CardType, string> = {
  weapon: "Weapon",
  spell: "Spell",
  utility: "Utility",
  charm: "Charm",
  trap: "Trap",
  artifact: "Artifact",
};

function ingredients(tags: Ingredient[]): string {
  if (!tags.length) return "None";
  return tags.map((tag) => INGREDIENT_NAMES[tag] ?? tag).join(", ");
}

function cardHaystack(card: CardDef): string {
  return `${card.name} ${card.text} ${card.type} ${card.rarity} ${ingredients(card.ingredients)}`.toLowerCase();
}

export function CardGlossary() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<CardType | "all">("all");
  const needle = query.trim().toLowerCase();
  const cards = useMemo(
    () =>
      CARD_DEFS.filter((card) => (type === "all" || card.type === type) && (!needle || cardHaystack(card).includes(needle))).sort(
        (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name),
      ),
    [needle, type],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-stone-400">
        {CARD_DEFS.length} cards, one copy of each in the deck. Commons cost their printed Spirituality,
        almost always 1. Rares cost 4, and the two relic artifacts cost 6. A card also pays the potion
        with the ingredients printed under it. Equipping a second weapon, trap, or artifact replaces the
        one you have. A third charm replaces the older charm.
      </p>
      <label className="block text-xs text-stone-400">
        Search cards
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, effect, or ingredient"
          className="mt-1 block w-full max-w-md rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        <Chip active={type === "all"} onClick={() => setType("all")}>
          All {CARD_DEFS.length}
        </Chip>
        {TYPE_ORDER.map((kind) => (
          <Chip key={kind} active={type === kind} onClick={() => setType(kind)}>
            {TYPE_LABEL[kind]} {CARD_DEFS.filter((card) => card.type === kind).length}
          </Chip>
        ))}
      </div>
      <p className="text-xs text-stone-500">{cards.length} shown</p>
      <ul className="space-y-2">
        {cards.map((card) => (
          <li key={card.id} className="rounded border border-stone-800 bg-stone-950/40 px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-stone-100">{card.name}</h3>
              <p className="text-xs text-amber-200/80">
                {TYPE_ONE[card.type]} · {card.rarity} · {card.spCost} Spirituality
              </p>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-stone-300">{card.text}</p>
            <p className="mt-1 text-xs text-stone-500">Ingredients: {ingredients(card.ingredients)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ArcanaGlossary() {
  const [query, setQuery] = useState("");
  const [curve, setCurve] = useState<"all" | ReturnType<typeof pathwayCurve>>("all");
  const needle = query.trim().toLowerCase();
  const pathways = useMemo(() => {
    return [...PATHWAYS]
      .sort((a, b) => Number(a.arcana) - Number(b.arcana))
      .filter((pathway) => {
        if (curve !== "all" && pathwayCurve(pathway.id) !== curve) return false;
        if (!needle) return true;
        const blob = [
          pathway.name,
          pathway.theme,
          pathway.arcana,
          ...pathway.sequences.flatMap((seq) => [seq.title, seq.abilityName, seq.abilityText, seq.actingCondition]),
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(needle);
      });
  }, [curve, needle]);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-stone-400">
        Twenty-two pathways. You start at Sequence 9. A smaller number is further along, and Sequence 0
        is Apotheosis. Casting the ability pays Sanity, not Spirituality: 1 at Sequence 9–7, 2 at 6–4,
        and 3 at 3–1. Casting also locks the Acting condition for that Sequence. The potion asks for the
        ingredients listed on that step, costs no Sanity, and the shown cards stay in hand.
      </p>
      <label className="block text-xs text-stone-400">
        Search pathways
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pathway, ability, or effect"
          className="mt-1 block w-full max-w-md rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        <Chip active={curve === "all"} onClick={() => setCurve("all")}>
          All 22
        </Chip>
        {(["early", "mid", "late", "even"] as const).map((band) => (
          <Chip key={band} active={curve === band} onClick={() => setCurve(band)}>
            {curveLabel(band)} {PATHWAYS.filter((pathway) => pathwayCurve(pathway.id) === band).length}
          </Chip>
        ))}
      </div>
      <div className="space-y-6">
        {pathways.map((pathway) => (
          <PathwayBlock key={pathway.id} pathway={pathway} />
        ))}
      </div>
    </div>
  );
}

function PathwayBlock({ pathway }: { pathway: PathwayDef }) {
  const steps = [...pathway.sequences].sort((a, b) => b.sequence - a.sequence);
  return (
    <section className="space-y-2">
      <h3 className="font-[family-name:var(--font-display)] text-xl text-amber-100">
        {pathway.arcana}. {pathway.name}
      </h3>
      <p className="text-xs text-stone-500">
        {pathway.theme}. {curveLabel(pathwayCurve(pathway.id))}.
      </p>
      <ul className="space-y-2">
        {steps.map((seq) => (
          <li key={seq.sequence} className="rounded border border-stone-800 px-3 py-2">
            <p className="text-sm text-stone-100">
              Sequence {seq.sequence} · {seq.title}
            </p>
            <p className="mt-1 text-sm text-amber-200/90">
              {seq.abilityName}
              {seq.sequence > 0 ? ` · ${abilitySanityCost(seq.sequence)} Sanity` : ""} · {seq.spGain} Spirituality at Begin
            </p>
            <p className="mt-1 text-sm leading-relaxed text-stone-300">{seq.abilityText}</p>
            {seq.sequence > 0 && (
              <p className="mt-1 text-xs leading-relaxed text-stone-500">
                Acting: {seq.actingCondition} Recipe: {ingredients(seq.recipe)}.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-amber-500 bg-amber-950/50 px-2 py-0.5 text-xs text-amber-100"
          : "rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400"
      }
    >
      {children}
    </button>
  );
}
