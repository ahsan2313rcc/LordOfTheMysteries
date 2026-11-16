"use client";

import { Button } from "@/components/ui/button";
import { runAiTurn } from "@/game/ai";
import { getCardDef } from "@/game/cards";
import {
  actingProgressItems,
  activateArtifactPower,
  ascensionReady,
  attemptAscension,
  castSequenceAbility,
  contendArtifact,
  createGame,
  currentPlayer,
  endTurn,
  getRng,
  performAttack,
  playCardFromHand,
  sacrificeRequiem,
} from "@/game/engine";
import { abilitySanityCost, getSequence, INGREDIENT_NAMES, PATHWAYS } from "@/game/pathways";
import type { GameState } from "@/game/types";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CardView } from "./CardView";
import { PlayerPanel } from "./PlayerPanel";
import { RevealModal } from "./RevealModal";
import { RulesView } from "./RulesView";
import { SimulatorView } from "./SimulatorView";

type Screen = "title" | "setup" | "play" | "design" | "sim" | "rules";

export function GameApp() {
  const [screen, setScreen] = useState<Screen>("title");
  const [pathwayId, setPathwayId] = useState(PATHWAYS[0]!.id);
  const [aiCount, setAiCount] = useState(1);
  const [concealment, setConcealment] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const human = state ? state.players.find((p) => p.isHuman) : null;
  const me = state ? currentPlayer(state) : null;
  const myTurn = !!(state && me?.isHuman && state.phase === "action");

  const humanActing = useMemo(() => {
    if (!human) return { ok: false, items: [], ready: null as ReturnType<typeof ascensionReady> | null };
    return {
      ok: human.actingMet,
      items: actingProgressItems(human),
      ready: ascensionReady(human),
    };
  }, [human, state]);

  useEffect(() => {
    if (!state || state.phase === "gameover") return;
    const cur = currentPlayer(state);
    if (cur.isHuman || !cur.alive) return;
    const t = setTimeout(() => {
      startTransition(() => {
        setState((prev) => {
          if (!prev) return prev;
          const next = structuredClone(prev);
          return runAiTurn(next);
        });
      });
    }, 700);
    return () => clearTimeout(t);
  }, [state]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  function dismissReveal() {
    setState((prev) => {
      if (!prev?.reveals?.length) return prev;
      const next = structuredClone(prev);
      next.reveals = next.reveals.slice(1);
      return next;
    });
  }

  const activeReveal = state?.reveals?.[0] ?? null;

  function startGame() {
    const pool = PATHWAYS.filter((p) => p.id !== pathwayId);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const aiIds = shuffled.slice(0, aiCount).map((p) => p.id);
    const g = createGame({
      humanPathwayId: pathwayId,
      aiPathwayIds: aiIds,
      humanName: "Ahasan",
      arcanaConcealment: concealment,
    });
    setState(g);
    setSelectedCard(null);
    setSelectedTarget(null);
    setScreen("play");
  }

  function apply(fn: (s: GameState) => string | null | void) {
    if (!state) return;
    const next = structuredClone(state);
    const msg = fn(next);
    setState(next);
    if (typeof msg === "string") flash(msg);
  }

  function onPlayCard() {
    if (!state || !selectedCard) return;
    const held = currentPlayer(state).hand.find((c) => c.instanceId === selectedCard);
    if (held && getCardDef(held.defId).id === "major_arcana" && !selectedTarget) {
      flash("Choose who the Arcana exposes");
      return;
    }
    const rng = getRng(state);
    const cardId = selectedCard;
    const target = selectedTarget ?? undefined;
    apply((s) => {
      const r = playCardFromHand(s, cardId, target, rng);
      if (!r.ok) return r.error ?? "Cannot play";
      setSelectedCard(null);
    });
  }

  function onAttack() {
    if (!state || !selectedTarget) {
      flash("Select a target first");
      return;
    }
    const rng = getRng(state);
    const target = selectedTarget;
    apply((s) => {
      const r = performAttack(s, target, rng);
      if (!r.ok) return r.error ?? "Cannot attack";
    });
  }

  function onAbility() {
    if (!state) return;
    const rng = getRng(state);
    const target = selectedTarget ?? undefined;
    apply((s) => {
      const r = castSequenceAbility(s, target, rng);
      if (!r.ok) return r.error ?? "Cannot cast";
    });
  }

  function onAscend() {
    if (!state) return;
    const rng = getRng(state);
    apply((s) => {
      const r = attemptAscension(s, rng);
      if (!r.ok) return r.error ?? "Ascension failed";
      return "Ascension successful!";
    });
  }

  function onContend() {
    if (!state || !selectedTarget) {
      flash("Select an opponent with an Artifact");
      return;
    }
    const rng = getRng(state);
    const target = selectedTarget;
    apply((s) => {
      const r = contendArtifact(s, target, rng);
      if (!r.ok) return r.error ?? "Contention failed";
      return "Artifact stolen!";
    });
  }

  function onArtifactPower(wish?: "hp" | "sanity" | "sp") {
    if (!state) return;
    const rng = getRng(state);
    const target = selectedTarget ?? undefined;
    apply((s) => {
      const r = activateArtifactPower(s, target, rng, wish);
      if (!r.ok) return r.error ?? "Cannot activate";
    });
  }

  function onRequiem() {
    if (!state) return;
    apply((s) => {
      const r = sacrificeRequiem(s);
      if (!r.ok) return r.error ?? "Cannot shatter Requiem";
    });
  }

  function onEnd() {
    if (!state) return;
    const rng = getRng(state);
    apply((s) => {
      endTurn(s, rng);
    });
    setSelectedCard(null);
  }

  if (screen === "title") {
    return (
      <main className="relative min-h-screen overflow-hidden">
        <div className="fog-layer" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,rgba(201,162,39,0.12),transparent_50%),radial-gradient(ellipse_at_80%_70%,rgba(90,30,40,0.25),transparent_45%)]" />
        <section className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
          <p className="animate-fade-up text-xs uppercase tracking-[0.35em] text-amber-500/80">
            Card Game Prototype · v0.1
          </p>
          <h1 className="animate-fade-up animation-delay-1 mt-4 font-[family-name:var(--font-display)] text-5xl leading-[1.05] text-amber-50 sm:text-7xl">
            Lord of the Mysteries
            <span className="block text-amber-400/90">Ascension</span>
          </h1>
          <p className="animate-fade-up animation-delay-2 mt-6 max-w-xl text-base leading-relaxed text-stone-300/90 sm:text-lg">
            Choose a Pathway. Drink potions. Steal Spirituality. Climb from Sequence 9 to
            Apotheosis — or be the last mind left unbroken.
          </p>
          <div className="animate-fade-up animation-delay-3 mt-10 flex flex-wrap gap-3">
            <Button
              size="lg"
              className="bg-amber-600 text-stone-950 hover:bg-amber-500"
              onClick={() => setScreen("setup")}
            >
              Begin
            </Button>
            <Button size="lg" variant="outline" onClick={() => setScreen("sim")}>
              AI Simulator
            </Button>
            <Button size="lg" variant="outline" onClick={() => setScreen("rules")}>
              Rules
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-stone-500/60 bg-stone-950/40 text-stone-200"
              onClick={() => setScreen("design")}
            >
              Design Notes
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "design") {
    return <DesignNotes onBack={() => setScreen("title")} />;
  }

  if (screen === "rules") {
    return <RulesView onBack={() => setScreen(state ? "play" : "title")} />;
  }

  if (screen === "setup") {
    return (
      <main className="relative min-h-screen px-4 py-10">
        <div className="fog-layer opacity-60" aria-hidden />
        <div className="relative z-10 mx-auto max-w-5xl">
          <button
            type="button"
            className="text-sm text-stone-400 hover:text-amber-300"
            onClick={() => setScreen("title")}
          >
            ← Back
          </button>
          <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl text-amber-100">
            Choose Your Pathway
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-stone-400">
            All 22 Arcana Pathways are playable. Each has a unique SP curve, Sequence
            abilities, Acting Conditions, and potion recipes. Peeks and steals open a reveal
            panel so you can see exactly what happened.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label className="text-sm text-stone-300">
              Opponents:{" "}
              <select
                className="ml-2 rounded border border-stone-600 bg-stone-900 px-2 py-1"
                value={aiCount}
                onChange={(e) => setAiCount(Number(e.target.value))}
              >
                <option value={1}>1 AI</option>
                <option value={2}>2 AI</option>
                <option value={3}>3 AI</option>
              </select>
            </label>
            <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" onClick={startGame}>
              Deal the Arcana
            </Button>
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={concealment}
                onChange={(e) => setConcealment(e.target.checked)}
              />
              Arcana Concealment
            </label>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-stone-500">
            Variant: the deck gains one Major Arcana per player. Play it to expose someone and their
            board. You stay concealed until you attack an exposed player. Abilities and items are
            unchanged, and potions still need their recipes.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PATHWAYS.map((p) => {
              const s9 = p.sequences[0]!;
              const selected = pathwayId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPathwayId(p.id)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition hover:-translate-y-0.5",
                    "bg-gradient-to-br from-stone-950 to-stone-900/80",
                    selected
                      ? "border-amber-500 shadow-[0_0_20px_rgba(201,162,39,0.2)]"
                      : "border-stone-700/60",
                  )}
                >
                  <p className="text-[0.65rem] uppercase tracking-[0.2em] text-stone-500">
                    Arcana {p.arcana}
                  </p>
                  <p
                    className="mt-1 font-[family-name:var(--font-display)] text-xl"
                    style={{ color: p.accent }}
                  >
                    {p.name}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">{p.theme}</p>
                  <p className="mt-3 text-[0.7rem] text-stone-300">
                    <span className="text-amber-500/90">{s9.title}:</span> {s9.abilityName} (
                    {abilitySanityCost(9)} Sanity) — {s9.abilityText}
                  </p>
                  <p className="mt-2 text-[0.65rem] text-stone-500">
                    Acting: {s9.actingCondition}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    );
  }

  if (screen === "sim") {
    return <SimulatorView onBack={() => setScreen("title")} />;
  }

  // Play screen
  if (!state || !human) return null;
  const seq = getSequence(human.pathwayId, human.sequence);
  const nextSeq = human.sequence > 0 ? getSequence(human.pathwayId, human.sequence - 1) : null;
  const winner = state.winnerId
    ? state.players.find((p) => p.id === state.winnerId)
    : null;

  return (
    <main className="relative flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <div className="fog-layer opacity-40" aria-hidden />
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-stone-800/80 bg-stone-950/70 px-4 py-3 backdrop-blur">
        <div>
          <p className="font-[family-name:var(--font-display)] text-amber-100">
            Ascension · Turn {state.turnNumber}
          </p>
          <p className="text-xs text-stone-400">
            Phase: {state.phase}
            {me ? ` · ${me.name}'s turn` : ""}
            {pending ? " · resolving…" : ""}
            {state.arcanaConcealment ? " · Arcana Concealment" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setScreen("rules")}>
            Rules
          </Button>
          <Button variant="outline" size="sm" onClick={() => setScreen("setup")}>
            New Game
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setScreen("design")}>
            Notes
          </Button>
        </div>
      </header>

      {state.phase === "gameover" && winner && (
        <div className="relative z-20 mx-4 mt-4 rounded-xl border border-amber-500/50 bg-amber-950/40 p-4 text-center">
          <p className="font-[family-name:var(--font-display)] text-2xl text-amber-200">
            {winner.name} wins via{" "}
            {state.winReason === "apotheosis" ? "Apotheosis" : "Last Man Standing"}
          </p>
        </div>
      )}
      {state.phase === "gameover" && !winner && (
        <div className="relative z-20 mx-4 mt-4 rounded-xl border border-rose-500/50 bg-rose-950/40 p-4 text-center">
          <p className="font-[family-name:var(--font-display)] text-2xl text-rose-100">
            Madness takes the board. No contender remains.
          </p>
        </div>
      )}

      <div className="relative z-10 mx-auto grid min-h-0 w-full max-w-[90rem] flex-1 gap-3 overflow-hidden px-3 py-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {state.players.map((p) => (
              <PlayerPanel
                key={p.id}
                player={p}
                active={me?.id === p.id}
                selected={selectedTarget === p.id}
                onSelect={() => setSelectedTarget(p.id)}
                concealment={!!state.arcanaConcealment}
                showHand={!p.isHuman && false}
              />
            ))}
          </div>

          <div className="rounded-xl border border-stone-700/50 bg-stone-950/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-[family-name:var(--font-display)] text-amber-100">
                  Your Sequence — {seq.title}{" "}
                  <span className="text-stone-500">(Seq {human.sequence})</span>
                </p>
                <p className="mt-1 text-sm text-stone-300">
                  Ability: <span className="text-cyan-300">{seq.abilityName}</span> (
                  {abilitySanityCost(human.sequence)} Sanity) — {seq.abilityText}{" "}
                  <span className="text-stone-500">· Begin grants {seq.spGain} SP</span>
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.65rem] uppercase tracking-wider",
                  humanActing.ok
                    ? "border-emerald-600/60 bg-emerald-950/50 text-emerald-300"
                    : "border-amber-700/50 bg-amber-950/30 text-amber-300/90",
                )}
              >
                {humanActing.ok ? "Acting locked ✓" : "Acting in progress"}
              </span>
            </div>

            <p className="mt-3 text-xs text-stone-400">{seq.actingCondition}</p>
            <ul className="mt-2 space-y-1">
              {humanActing.items.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    item.done ? "text-emerald-300/90" : "text-stone-500",
                  )}
                >
                  <span className="font-mono">{item.done ? "✓" : "○"}</span>
                  {item.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.65rem] text-stone-500">
              Acting banks across turns until you drink. Click a seat to target them, or target
              yourself for Aegis of Mind&apos;s Sanity Block.
            </p>

            {nextSeq && humanActing.ready && (
              <div className="mt-3 rounded-lg border border-stone-700/60 bg-stone-900/60 p-2.5">
                <p className="text-[0.7rem] text-amber-200/90">
                  Potion → Seq {human.sequence - 1} {nextSeq.title}
                </p>
                <p className="mt-1 text-[0.65rem] text-stone-400">
                  Recipe: {nextSeq.recipe.map((r) => INGREDIENT_NAMES[r]).join(", ")} · No Sanity toll.
                  Reveal the cards; they stay in hand. The next sequence uses different ingredients.
                </p>
                <p
                  className={cn(
                    "mt-1 text-[0.65rem]",
                    humanActing.ready.acting && humanActing.ready.recipe
                      ? "text-emerald-400"
                      : "text-amber-500/90",
                  )}
                >
                  {humanActing.ready.reason}
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-xl border border-stone-700/50 bg-stone-950/80 p-3">
          <p className="font-[family-name:var(--font-display)] text-sm text-amber-100">
            Chronicle
          </p>
          <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto text-xs">
            {state.log.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "leading-snug text-stone-400",
                  e.tone === "damage" && "text-rose-300/90",
                  e.tone === "heal" && "text-emerald-300/90",
                  e.tone === "ascend" && "text-amber-300",
                  e.tone === "system" && "text-stone-500",
                )}
              >
                {e.text}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.65rem] text-stone-600">
            Deck {state.deck.length} · Discard {state.discard.length}
          </p>
        </aside>
      </div>

      <div className="z-30 shrink-0 border-t border-stone-800 bg-stone-950/95 px-3 py-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ActionChip label="Standard" used={state.actionsUsed.standard} extra={state.extraStandard} />
          <ActionChip label="Sequence" used={state.actionsUsed.sequence} />
          <ActionChip label="Attack" used={state.actionsUsed.attack} />
          {myTurn && human.sanityBroken && (
            <>
              <p className="text-xs text-rose-200">
                You are lost. End the turn. The body strikes for 1 HP on each of your Begins until your HP is gone.
              </p>
              <Button size="sm" variant="ghost" onClick={onEnd}>
                End Turn
              </Button>
            </>
          )}
          {myTurn && !human.sanityBroken && (
            <>
              <Button size="sm" className="bg-amber-700 hover:bg-amber-600" disabled={!selectedCard} onClick={onPlayCard}>
                Play Card
              </Button>
              <Button size="sm" variant="secondary" onClick={onAbility}>
                Cast Ability
              </Button>
              <Button size="sm" variant="secondary" onClick={onAttack}>
                Attack Target
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "border-amber-600/50 text-amber-200",
                  humanActing.ready?.acting && humanActing.ready?.recipe && "border-emerald-500/70 text-emerald-200",
                )}
                onClick={onAscend}
              >
                Drink Potion
              </Button>
              {human.artifact?.defId === "wishing_lamp" ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => onArtifactPower("hp")}>Wish: 2 HP</Button>
                  <Button size="sm" variant="outline" onClick={() => onArtifactPower("sanity")}>Wish: 2 Sanity</Button>
                  <Button size="sm" variant="outline" onClick={() => onArtifactPower("sp")}>Wish: 3 SP</Button>
                </>
              ) : (
                human.artifact && (
                  <Button size="sm" variant="outline" onClick={() => onArtifactPower()}>
                    Artifact Power
                  </Button>
                )
              )}
              {human.charms.some((c) => c.defId === "requiem_charm") && (
                <Button size="sm" variant="outline" onClick={onRequiem}>
                  Shatter Requiem (+3 HP)
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setSelectedTarget(human.id)}>
                Target Yourself
              </Button>
              <Button size="sm" variant="outline" onClick={onContend}>
                Contend Artifact
              </Button>
              <Button size="sm" variant="ghost" onClick={onEnd}>
                End Turn
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="z-30 max-h-[40vh] shrink-0 overflow-y-auto border-t border-amber-900/40 bg-stone-950 px-3 py-2">
        {selectedCard && (
          <p className="mb-2 text-xs leading-relaxed text-stone-300">
            {(() => {
              const c = human.hand.find((x) => x.instanceId === selectedCard);
              if (!c) return "Card left your hand.";
              const d = getCardDef(c.defId);
              const tgt = state.players.find((p) => p.id === selectedTarget);
              return `${d.name} · ${d.type} · ${d.spCost} SP — ${d.text}${tgt ? ` → ${tgt.name}` : " · choose a target"}`;
            })()}
          </p>
        )}
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {human.hand.map((c) => (
            <CardView
              key={c.instanceId}
              card={c}
              selected={selectedCard === c.instanceId}
              disabled={!myTurn}
              onClick={() => myTurn && setSelectedCard(c.instanceId)}
            />
          ))}
          {human.hand.length === 0 && (
            <p className="py-4 text-sm text-stone-500">Empty hand — the draw phase will refill it.</p>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-full border border-amber-700/50 bg-stone-950 px-4 py-2 text-sm text-amber-100">
          {toast}
        </div>
      )}

      {activeReveal && (
        <RevealModal reveal={activeReveal} onDismiss={dismissReveal} />
      )}
    </main>
  );
}

function ActionChip({
  label,
  used,
  extra,
}: {
  label: string;
  used: boolean;
  extra?: number;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        used
          ? "border-stone-700 text-stone-500 line-through"
          : "border-cyan-800/60 bg-cyan-950/40 text-cyan-200",
      )}
    >
      {label}
      {extra ? ` +${extra}` : ""}
    </span>
  );
}

function DesignNotes({ onBack }: { onBack: () => void }) {
  return (
    <main className="relative min-h-screen px-4 py-10">
      <div className="fog-layer opacity-50" aria-hidden />
      <article className="relative z-10 mx-auto max-w-3xl space-y-6 text-stone-300">
        <button type="button" className="text-sm text-stone-400 hover:text-amber-300" onClick={onBack}>
          ← Back
        </button>
        <h2 className="font-[family-name:var(--font-display)] text-3xl text-amber-100">
          Design Verdict & Improvements
        </h2>

        <section className="space-y-2">
          <h3 className="font-[family-name:var(--font-display)] text-xl text-amber-200/90">
            What already works
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="text-stone-100">Dual win cons</strong> (Last Standing vs
              Apotheosis) create political tension — race vs murder.
            </li>
            <li>
              <strong className="text-stone-100">Acting Conditions</strong> are the soul of LotM
              adaptation; they force thematic play instead of SP dumps. Progress now{" "}
              <em>persists across turns</em> until Ascension (bank + sticky lock).
            </li>
            <li>
              <strong className="text-stone-100">Madness</strong> at 0 Sanity removes you as a
              contender. The body keeps dealing 1 HP to everyone until its own HP is gone.
            </li>
            <li>
              Your revised 16/4 Spell vs Utility split (and equipment interactors) is the right
              fix — clear roles, fewer duplicates.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="font-[family-name:var(--font-display)] text-xl text-amber-200/90">
            Uniqueness check (pathways)
          </h3>
          <p className="text-sm leading-relaxed">
            Most pathways are distinct on paper. Weak spots: early-sequence “look at hand /
            deal 2” repeats across Fool, Visionary, White Tower, Hermit. Mid/high kits diverge
            well (Error theft, Death discard recursion, Red Priest traps, Tyrant AoE).
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="text-stone-100">Fool</strong> — keep info + history; make Clown
              reward successful Evade with draw (implemented).
            </li>
            <li>
              <strong className="text-stone-100">Error</strong> — strongest unique identity;
              protect it from “just another discard” by always stealing ownership.
            </li>
            <li>
              <strong className="text-stone-100">Visionary vs Darkness</strong> — both Sanity;
              Visionary should predict/dictate, Darkness should skip/suppress (split kept).
            </li>
            <li>
              <strong className="text-stone-100">Door vs Hermit</strong> — Door = space/banish;
              Hermit = modify/double-cast. Don’t let both be “copy spell.”
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="font-[family-name:var(--font-display)] text-xl text-amber-200/90">
            Suggested card / ability tweaks
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              Align SP tables: core rules (+1…+5) vs pathway sheets (+6/+8 at high Seq). This
              build uses pathway sheet gains for excitement at the top.
            </li>
            <li>
              Hand limit 7 keeps a potion in hand while you play; Slumber Charm still adds +2.
              Recipe scarcity remains the main pace brake.
            </li>
            <li>
              Spirit Entanglement, Rust & Ruin, Item Refinement, Wind Blade→top-deck are strong
              “interesting” designs — prioritize those over flat damage twins.
            </li>
            <li>
              Artifact Contention (Seq check + Sanity tax) is excellent; ship UI for it next.
            </li>
            <li>
              Cap Mad AoE or make Mad attacks exclude self optionally — self-kill loops feel bad.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="font-[family-name:var(--font-display)] text-xl text-amber-200/90">
            What makes play fun (focus)
          </h3>
          <p className="text-sm leading-relaxed">
            Fun comes from <em>readable plans that opponents can interrupt</em>: telegraph
            Ascension recipes, trap face-downs, and Sequence Ability windows. Push table talk
            (“don’t let the Fool drink”) over solitaire combo. This prototype exposes Acting
            status, recipe costs, and a live chronicle so those negotiations can start.
          </p>
        </section>

          <p className="text-xs text-stone-500">
          {PATHWAYS.length} pathways: {PATHWAYS.map((p) => p.name).join(" · ")}
        </p>
      </article>
    </main>
  );
}
