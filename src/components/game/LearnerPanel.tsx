"use client";

import { Button } from "@/components/ui/button";
import { eraseLearner, importLearner, learnerJson, learnerStats, loadLearnerLocal, runTrainerMatch, saveLearnerLocal } from "@/game/learner";
import { useEffect, useRef, useState } from "react";

const GAME_CHOICES = [1, 4, 16, 64, 256, 512, 1024];

export function LearnerPanel() {
  const [games, setGames] = useState(16);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState(learnerStats());
  const fileRef = useRef<HTMLInputElement>(null);

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
    const before = learnerStats();
    setBusy(true);
    setProgress(`0 / ${count}`);
    await runTrainerMatch(count, (done, total) => setProgress(`${done} / ${total}`));
    setBusy(false);
    setProgress("");
    const after = learnerStats();
    refresh(
      `Continued the same network. This run added ${count} self-play games. Played ${before.played} → ${after.played}. The saved player was replaced ${after.promotions - before.promotions} time${after.promotions - before.promotions === 1 ? "" : "s"} in this run.`,
    );
  }

  function download() {
    const kept = saveLearnerLocal();
    const blob = new Blob([learnerJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascension-learner.json";
    link.click();
    URL.revokeObjectURL(url);
    setSaved(kept);
    setNote(
      kept
        ? "Saved in this browser, and downloaded ascension-learner.json."
        : "Downloaded ascension-learner.json. This browser could not keep a copy that large, so use Load model to bring it back.",
    );
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (!importLearner(text)) {
        setNote("That file is not this network. The weights in this browser were left as they are.");
        return;
      }
      const next = learnerStats();
      const kept = saveLearnerLocal();
      setStats(next);
      setSaved(kept);
      setNote(
        kept
          ? `Loaded ${file.name}. This network has ${next.played} self-play games${next.hasChampion ? " and a saved player" : ""}.`
          : `Loaded ${file.name} for this page (${next.played} self-play games${next.hasChampion ? ", with a saved player" : ""}). This browser could not keep a copy that large; Save model downloads the file again.`,
      );
    };
    reader.onerror = () => setNote("That file could not be read. The weights in this browser were left as they are.");
    reader.readAsText(file);
  }

  function erase() {
    eraseLearner();
    setStats(learnerStats());
    setSaved(false);
    setNote("The trained weights are gone. The next session starts from a fresh network.");
  }

  const explorePct = Math.round(stats.explore * 100);

  return (
    <section className="flex flex-col gap-4">
      <div className="max-w-3xl">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-100">Learner</h2>
        <p className="mt-1 text-sm text-stone-400">
          The network plays itself. It starts without knowing what any card or Sequence ability
          does. It records every card, pathway, and sequence it is allowed to see, plus HP, Sanity,
          and Spirituality, and the recent actions: draw, discard, play, cast, attack, drink, and
          steal. A hidden fact is marked unknown. While it is learning, {explorePct}% of its actions
          are a random legal move, so it tries lines it would otherwise skip. A game at the table,
          and the check against the saved player, use no exploration. Both seats learn from who won.
          Every few games the network still training plays the saved player for eight games. It takes
          that seat only when it wins more of them. A shuffled deck still swings a short check. Load
          model replaces the weights from a saved JSON file. Erase clears them. A network that has
          never trained does not act. The previous saved network is left unused, because this one
          plays itself.
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
        <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" disabled={busy} onClick={() => void run()}>
          {busy ? progress : "Play itself"}
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
        <h3 className="text-sm text-amber-100">Self-play</h3>
        <p className="mt-1 text-xs text-stone-500">
          Both seats are this network. Training uses {explorePct}% exploration. The eight-game check
          uses none. The saved player changes only when the training network wins more of those games.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Self-play games" value={String(stats.played)} />
        <Stat label="Saved player replaced" value={String(stats.promotions)} />
        <Stat
          label="Training network, last check"
          value={stats.checkGames ? `${stats.challengerWins} of ${stats.checkGames}` : "—"}
        />
        <Stat
          label="Saved player, last check"
          value={stats.checkGames ? `${stats.savedWins} of ${stats.checkGames}` : "—"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={download}>
          Save model
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          Load model
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Network file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) loadFile(file);
          }}
        />
        <Button variant="outline" disabled={busy} onClick={erase}>
          Erase trained data
        </Button>
        <p className="self-center text-xs text-stone-500">{saved ? "Stored in this browser." : "Not stored yet."}</p>
      </div>

      {note && <p className="text-sm text-stone-400">{note}</p>}
      <p className="text-xs text-stone-500">
        A run can be 1 to 1024 games, and the next run starts from those same weights. Save
        downloads ascension-learner.json, and also writes into this browser when the file fits.
        Load model reads that JSON and replaces the network here, including the saved player when
        the file has one. A file from an older network is refused. Erase resets the network. A
        fresh page reloads a browser copy when one is stored; otherwise open the JSON with Load
        model. The saved player is the one that sits at the table. Eight games is a short check,
        so the count moves in steps, and a shuffled deck still takes games.
      </p>
    </section>
  );
}

function clampGames(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(1024, Math.floor(value)));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-950/70 px-3 py-2">
      <div className="text-[0.65rem] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-lg text-amber-100">{value}</div>
    </div>
  );
}
