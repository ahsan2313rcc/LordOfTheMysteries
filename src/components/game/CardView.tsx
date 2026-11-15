"use client";

import { getCardDef } from "@/game/cards";
import { INGREDIENT_NAMES } from "@/game/pathways";
import type { CardInstance } from "@/game/types";
import { cn } from "@/lib/utils";

const TYPE_HUE: Record<string, string> = {
  weapon: "from-amber-950/80 to-stone-900 border-amber-700/50",
  spell: "from-rose-950/80 to-stone-900 border-rose-700/40",
  utility: "from-teal-950/70 to-stone-900 border-teal-700/40",
  charm: "from-emerald-950/70 to-stone-900 border-emerald-700/40",
  trap: "from-violet-950/60 to-stone-900 border-stone-500/40",
  artifact: "from-yellow-950/80 to-stone-900 border-yellow-600/50",
  arcana: "from-indigo-950/80 to-stone-900 border-indigo-400/50",
};

export function CardView({
  card,
  selected,
  disabled,
  compact,
  faceDown,
  onClick,
}: {
  card: CardInstance;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
}) {
  if (faceDown) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "relative h-28 w-[4.6rem] shrink-0 rounded-md border border-amber-900/40 bg-[radial-gradient(ellipse_at_top,_#2a2218,_#0c0a08)] shadow-md",
          "transition duration-200 hover:-translate-y-1",
          selected && "ring-2 ring-amber-400 -translate-y-2",
        )}
      >
        <span className="absolute inset-2 rounded border border-amber-700/30 flex items-center justify-center">
          <span className="font-[family-name:var(--font-display)] text-amber-600/70 text-lg">?</span>
        </span>
      </button>
    );
  }

  const def = getCardDef(card.defId);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative shrink-0 rounded-md border bg-gradient-to-b text-left shadow-lg transition duration-200",
        TYPE_HUE[def.type] ?? TYPE_HUE.utility,
        compact ? "min-h-36 w-[5.6rem] p-1.5" : "min-h-52 w-[9rem] p-2.5",
        !disabled && "hover:-translate-y-2 hover:shadow-amber-900/30",
        selected && "ring-2 ring-amber-400 -translate-y-2",
        disabled && "cursor-default",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p
          className={cn(
            "font-[family-name:var(--font-display)] leading-tight text-amber-100",
            compact ? "text-[0.62rem]" : "text-xs",
          )}
        >
          {def.name}
        </p>
        <span className="rounded bg-black/40 px-1 text-[0.6rem] text-cyan-200/90">
          {def.spCost}✦
        </span>
      </div>
      <p className="mt-0.5 text-[0.55rem] uppercase tracking-wider text-stone-400">
        {def.rarity} · {def.type}
      </p>
      {!compact && (
        <>
          <p className="mt-2 text-[0.68rem] leading-snug text-stone-200/90">{def.text}</p>
          <p className="mt-auto pt-2 text-[0.5rem] leading-snug text-stone-500">
            {def.ingredients.map((i) => INGREDIENT_NAMES[i] ?? i).join(" · ")}
          </p>
        </>
      )}
      {compact && (
        <p className="mt-1 text-[0.55rem] leading-snug text-stone-400">{def.text}</p>
      )}
    </button>
  );
}
