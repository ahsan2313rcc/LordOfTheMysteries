"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";

export function useSort<K extends string>(initial: K, initialDir: "asc" | "desc" = "desc") {
  const [key, setKey] = useState<K>(initial);
  const [direction, setDirection] = useState<"asc" | "desc">(initialDir);
  function toggle(next: K) {
    if (next === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(next);
      setDirection("desc");
    }
  }
  return { key, direction, toggle };
}

export function compareValues(a: string | number, b: string | number, direction: "asc" | "desc") {
  const m = direction === "asc" ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b) * m;
  return (Number(a) - Number(b)) * m;
}

export function SortTh({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-amber-200",
          active ? "text-amber-200" : "text-stone-500",
        )}
      >
        {label}
        <span aria-hidden className="text-[0.65rem]">
          {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
