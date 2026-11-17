"use client";

import { Button } from "@/components/ui/button";
import {
  eraseLearner,
  learnerJson,
  learnerStats,
  loadLearnerLocal,
  runTrainerMatch,
  saveLearnerLocal,
  type SeatController,
} from "@/game/learner";
import { useEffect, useState } from "react";

const GAME_CHOICES = [1, 4, 16, 64, 256, 512, 1024];

export function LearnerPanel() {
  const [games, setGames] = useState(4);
  const [seatA, setSeatA] = useState<SeatController>("nn");
  const [seatB, setSeatB] = useState<SeatController>("ai");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState(learnerStats());

  useEffect(() => {
    setSaved(loadLearnerLocal());
    setStats(learnerStats());
  }, []);

  function refresh(message: string) {
    setStats(learnerStats());
    setSaved(true);
    setNote(message);
  }

  async function run() {
    const count = clampGames(games);
    setGames(count);
    setBusy(true);
    setProgress(`0 / ${count}`);
    await runTrainerMatch(count, seatA, seatB, (done, total) => setProgress(`${done} / ${total}`));
    setBusy(false);
    setProgress("");
    const bothAi = seatA === "ai" && seatB === "ai";
    refresh(
      bothAi
        ? `Watched ${count} search-AI games. The weights are stored in this browser.`
        : `Played ${count} games with ${seatLabel(seatA)} against ${seatLabel(seatB)}. Winning lines were reinforced.`,
    );
  }

  function download() {
    saveLearnerLocal();
    const blob = new Blob([learnerJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascension-learner.json";
    link.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setNote("Saved in this browser, and downloaded ascension-learner.json.");
  }

  function erase() {
    eraseLearner();
    setStats(learnerStats());
    setSaved(false);
    setNote("The trained weights are gone. The next session starts from a fresh network.");
  }

  const decided = stats.nnWins + stats.aiWins;

  return (
    <section className="flex flex-col gap-4">
      <div className="max-w-3xl">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-100">Learner</h2>
        <p className="mt-1 text-sm text-stone-400">
          A small network reads the position it is allowed to see: its own hand and board, the
          enemy board, revealed cards, enemy hand size, and how many cards are left in the deck and
          discard. Each seat in a match is the neural network or the search AI. Two search AIs are
          watched and imitated. A network seat learns from the games it wins and loses. More games
          make it sharper. It does not start out solved.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-stone-400">
          Games
          <input
            type="number"
            min={1}
            max={1024}
            inputMode="numeric"
            className="mt-1 block w-24 rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
            value={games}
            disabled={busy}
            onChange={(e) => setGames(clampGames(Number(e.target.value)))}
          />
        </label>
        <label className="text-xs text-stone-400">
          Seat A
          <select
            className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
            value={seatA}
            disabled={busy}
            onChange={(e) => setSeatA(e.target.value as SeatController)}
          >
            <option value="nn">NN</option>
            <option value="ai">AI</option>
          </select>
        </label>
        <label className="text-xs text-stone-400">
          Seat B
          <select
            className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
            value={seatB}
            disabled={busy}
            onChange={(e) => setSeatB(e.target.value as SeatController)}
          >
            <option value="nn">NN</option>
            <option value="ai">AI</option>
          </select>
        </label>
        <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" disabled={busy} onClick={() => void run()}>
          {busy ? progress : "Run match"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {GAME_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            aria-pressed={games === n}
            className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-300 hover:border-amber-600 hover:text-amber-100 disabled:opacity-50"
            onClick={() => setGames(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <div>
        <h3 className="text-sm text-amber-100">NN vs AI</h3>
        <p className="mt-1 text-xs text-stone-500">
          These four numbers count only matches with one neural network and one search AI. Who goes
          first swaps every game. A game with no winner sits in Draws.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="NN wins" value={String(stats.nnWins)} />
        <Stat label="AI wins" value={String(stats.aiWins)} />
        <Stat label="Draws" value={String(stats.draws)} />
        <Stat label="NN win rate" value={decided ? `${Math.round(stats.nnWinRate * 100)}%` : "—"} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="NN vs AI matches" value={String(stats.headToHead)} />
        <Stat label="Games watched" value={String(stats.watched)} />
        <Stat label="Network games" value={String(stats.played)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={download}>
          Save model
        </Button>
        <Button variant="outline" disabled={busy} onClick={erase}>
          Erase trained data
        </Button>
        <p className="self-center text-xs text-stone-500">{saved ? "Stored in this browser." : "Not stored yet."}</p>
      </div>

      {note && <p className="text-sm text-stone-400">{note}</p>}
      <p className="text-xs text-stone-500">
        A match can be 1 to 1024 games. Save writes the weights into this browser and downloads a
        JSON file you can keep. Erase drops that browser copy, including the NN vs AI record, and
        resets the network. A fresh page loads the saved weights again until you erase them.
      </p>
    </section>
  );
}

function clampGames(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(1024, Math.floor(value)));
}

function seatLabel(kind: SeatController): string {
  return kind === "nn" ? "the neural network" : "the search AI";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-950/70 px-3 py-2">
      <div className="text-[0.65rem] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-lg text-amber-100">{value}</div>
    </div>
  );
}
