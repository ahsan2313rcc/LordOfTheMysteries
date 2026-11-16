"use client";

import { getCardDef } from "@/game/cards";
import { abilitySanityCost, curveLabel, getPathway, getSequence, pathwayCurve } from "@/game/pathways";
import type { PlayerState } from "@/game/types";
import { cn } from "@/lib/utils";
import { CardView } from "./CardView";

export function PlayerPanel({
  player,
  active,
  selected,
  onSelect,
  showHand,
  concealment,
}: {
  player: PlayerState;
  active?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  showHand?: boolean;
  concealment?: boolean;
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
            {pathway.name} · {curveLabel(pathwayCurve(player.pathwayId))} · Seq {player.sequence}{" "}
            <span style={{ color: pathway.accent }}>{seq.title}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {(player.sanityBroken || player.mad) && (
            <span className="rounded bg-rose-900/80 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-rose-100">
              {player.sanityBroken ? "Lost" : "Mad"}
            </span>
          )}
          {concealment && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide",
                player.revealed
                  ? "bg-rose-950/80 text-rose-200"
                  : "bg-stone-800 text-stone-300",
              )}
            >
              {player.revealed ? "Exposed" : "Concealed"}
            </span>
          )}
          {player.actingMet && (
            <span className="rounded bg-emerald-900/70 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide text-emerald-200">
              Potion ready
            </span>
          )}
        </div>
      </div>

      <p className="mt-1 text-[0.65rem] text-stone-500">
        Hand {player.hand.length} · {seq.abilityName} ({abilitySanityCost(player.sequence)} SAN)
      </p>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="HP" value={player.hp} max={player.maxHp} color="text-rose-300" />
        <Stat label="SAN" value={player.sanity} max={20} color="text-violet-300" />
        <Stat label="SP" value={player.sp} max={20} color="text-cyan-300" />
      </div>

      <div className="mt-2 flex flex-wrap gap-1 text-[0.65rem] text-stone-300">
        {player.status.block > 0 && <Chip>Block {player.status.block}</Chip>}
        {(player.lastingBlock ?? 0) > 0 && <Chip>Lasting {player.lastingBlock}</Chip>}
        {player.status.sanityBlock > 0 && <Chip>S.Block {player.status.sanityBlock}</Chip>}
        {player.status.evade > 0 && <Chip>Evade {player.status.evade}</Chip>}
        {player.status.weaponDisabled && <Chip>Weapon rusted</Chip>}
        {player.trap && <Chip>Trap set</Chip>}
        {player.universalReagent && <Chip>Reagent</Chip>}
      </div>

      {player.hand.some((c) => c.revealed) && (
        <div className="mt-2">
          <p className="text-[0.6rem] uppercase tracking-wider text-amber-400/80">Shown for potions</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {player.hand
              .filter((c) => c.revealed)
              .map((c) => (
                <CardView key={c.instanceId} card={c} compact disabled />
              ))}
          </div>
        </div>
      )}

      <div className="mt-2 space-y-0.5 text-[0.68rem] leading-snug text-stone-300">
        <p>Weapon: {player.weapon ? getCardDef(player.weapon.defId).name : "—"}</p>
        <p>
          Charms:{" "}
          {player.charms.length
            ? player.charms.map((c) => getCardDef(c.defId).name).join(", ")
            : "—"}
        </p>
        <p>Artifact: {player.artifact ? getCardDef(player.artifact.defId).name : "—"}</p>
        <p>Trap: {player.trap ? (player.isHuman ? getCardDef(player.trap.defId).name : "face down") : "—"}</p>
      </div>

      {(player.weapon || player.charms.length > 0 || player.artifact || player.trap) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {player.weapon && <CardView card={player.weapon} compact disabled />}
          {player.charms.map((c) => (
            <CardView key={c.instanceId} card={c} compact disabled />
          ))}
          {player.artifact && <CardView card={player.artifact} compact disabled />}
          {player.trap && (
            <CardView card={player.trap} compact faceDown={!player.isHuman} disabled />
          )}
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
      <p className={cn("font-[family-name:var(--font-display)] text-lg", color)}>{value}</p>
      <p className="text-[0.55rem] uppercase tracking-wider text-stone-500">{label}</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-stone-700">
        <div
          className={cn("h-full rounded bg-current", color)}
          style={{ width: `${value > 0 ? Math.max(pct, 8) : 0}%` }}
        />
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
