"use client";

import { getCardDef } from "@/game/cards";
import { getPathway, getSequence } from "@/game/pathways";
import type { PlayerState } from "@/game/types";
import { cn } from "@/lib/utils";
import { CardView } from "./CardView";

export function PlayerPanel({
  player,
  active,
  selected,
  onSelect,
  showHand,
}: {
  player: PlayerState;
  active?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  showHand?: boolean;
}) {
  const pathway = getPathway(player.pathwayId);
  const seq = getSequence(player.pathwayId, player.sequence);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition",
        "bg-gradient-to-br from-stone-950/90 to-stone-900/60 backdrop-blur",
        active ? "border-amber-500/70 shadow-[0_0_24px_rgba(201,162,39,0.15)]" : "border-stone-700/50",
        selected && "ring-2 ring-cyan-400/70",
        !player.alive && "opacity-40 grayscale",
        player.mad && "border-rose-700/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-[family-name:var(--font-display)] text-amber-100 text-sm">
            {player.name}
          </p>
          <p className="text-[0.7rem] text-stone-400">
            {pathway.name} · Seq {player.sequence}{" "}
            <span style={{ color: pathway.accent }}>{seq.title}</span>
          </p>
        </div>
        {player.mad && (
          <span className="rounded bg-rose-900/80 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-rose-100">
            Mad
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="HP" value={player.hp} max={player.maxHp} color="text-rose-300" />
        <Stat label="SAN" value={player.sanity} max={20} color="text-violet-300" />
        <Stat label="SP" value={player.sp} max={20} color="text-cyan-300" />
      </div>

      <div className="mt-2 flex flex-wrap gap-1 text-[0.6rem] text-stone-400">
        {player.status.block > 0 && <Chip>Block {player.status.block}</Chip>}
        {player.status.evade > 0 && <Chip>Evade {player.status.evade}</Chip>}
        {player.trap && <Chip>Trap set</Chip>}
        {player.weapon && <Chip>{getCardDef(player.weapon.defId).name}</Chip>}
      </div>

      {(player.weapon || player.charms.length > 0 || player.artifact) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {player.weapon && <CardView card={player.weapon} compact disabled />}
          {player.charms.map((c) => (
            <CardView key={c.instanceId} card={c} compact disabled />
          ))}
          {player.artifact && <CardView card={player.artifact} compact disabled />}
          {player.trap && <CardView card={player.trap} compact faceDown disabled />}
        </div>
      )}

      {showHand && (
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
          {player.hand.map((c) => (
            <CardView key={c.instanceId} card={c} compact disabled />
          ))}
        </div>
      )}
    </button>
  );
}

function Stat({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <p className={cn("font-[family-name:var(--font-display)] text-base", color)}>{value}</p>
      <p className="text-[0.55rem] uppercase tracking-wider text-stone-500">{label}</p>
      <div className="mt-1 h-1 overflow-hidden rounded bg-stone-800">
        <div className={cn("h-full rounded bg-current opacity-70", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-stone-600/50 bg-stone-900/80 px-1.5 py-0.5">
      {children}
    </span>
  );
}
