"use client";

import { Button } from "@/components/ui/button";
import {
  eraseLearner,
  learnerJson,
  learnerStats,
  loadLearnerLocal,
  playLearnerGames,
  saveLearnerLocal,
  watchAiGames,
} from "@/game/learner";
import { useEffect, useState } from "react";

export function LearnerPanel() {
  const [games, setGames] = useState(2);
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

  async function run(kind: "watch" | "ai" | "self") {
    setBusy(true);
    setProgress(`0 / ${games}`);
    const tick = (done: number, total: number) => setProgress(`${done} / ${total}`);
    if (kind === "watch") await watchAiGames(games, tick);
    else await playLearnerGames(games, kind === "self" ? "self" : "ai", tick);
    setBusy(false);
    setProgress("");
    refresh(
      kind === "watch"
        ? `Watched ${games} search-AI games. The weights are stored in this browser.`
        : `Played ${games} games. Winning lines were reinforced.`,
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

  const decided = stats.wins + stats.losses;

  return (
    <section className="flex flex-col gap-4">
      <div className="max-w-3xl">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-100">Learner</h2>
        <p className="mt-1 text-sm text-stone-400">
          A small network reads the position it is allowed to see: its own hand and board, the
          enemy board, revealed cards, enemy hand size, and how many cards are left in the deck and
          discard. Watch mode studies the search AI’s choices. Play mode sits the network at the
          table, against that AI or against itself, and reinforces the lines that won. More games
          make it sharper. It does not start out solved.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-stone-400">
          Games
          <select
            className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
            value={games}
            disabled={busy}
            onChange={(e) => setGames(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={4}>4</option>
            <option value={8}>8</option>
          </select>
        </label>
        <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" disabled={busy} onClick={() => void run("watch")}>
          {busy ? progress : "Watch AI vs AI"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run("ai")}>
          Play vs search AI
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run("self")}>
          Play against itself
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Games watched" value={String(stats.watched)} />
        <Stat label="Games played" value={String(stats.played)} />
        <Stat label="Winning seats" value={decided ? `${stats.wins}/${decided}` : "—"} />
        <Stat label="Stored here" value={saved ? "Yes" : "Not yet"} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={download}>
          Save model
        </Button>
        <Button variant="outline" disabled={busy} onClick={erase}>
          Erase trained data
        </Button>
      </div>

      {note && <p className="text-sm text-stone-400">{note}</p>}
      <p className="text-xs text-stone-500">
        Save writes the weights into this browser and downloads a JSON file you can keep. Erase
        drops that browser copy and resets the network. A fresh page loads the saved weights again
        until you erase them.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-950/70 px-3 py-2">
      <div className="text-[0.65rem] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-lg text-amber-100">{value}</div>
    </div>
  );
}
