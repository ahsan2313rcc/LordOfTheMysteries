"use client";

import type { RevealEvent } from "@/game/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RevealModal({
  reveal,
  onDismiss,
}: {
  reveal: RevealEvent;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-amber-700/40 bg-stone-950 p-5 shadow-2xl">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-amber-600/80">
          {reveal.kind}
        </p>
        <h3 className="mt-1 font-[family-name:var(--font-display)] text-xl text-amber-100">
          {reveal.title}
        </h3>
        {reveal.detail && (
          <p className="mt-2 text-sm text-stone-400">{reveal.detail}</p>
        )}
        <ul className="mt-4 space-y-2">
          {reveal.cards.length === 0 && (
            <li className="text-sm text-stone-500">No cards.</li>
          )}
          {reveal.cards.map((c, i) => (
            <li
              key={`${c.name}-${i}`}
              className={cn(
                "rounded-lg border border-stone-700/60 bg-stone-900/80 p-3",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-[family-name:var(--font-display)] text-sm text-amber-100">
                  {c.name}
                </p>
                <span className="text-[0.6rem] uppercase text-stone-500">
                  {c.rarity} · {c.type}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-stone-400">{c.text}</p>
            </li>
          ))}
        </ul>
        <Button className="mt-5 w-full bg-amber-700 hover:bg-amber-600" onClick={onDismiss}>
          Continue
        </Button>
      </div>
    </div>
  );
}
