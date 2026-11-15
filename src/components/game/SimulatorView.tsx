"use client";

import { Button } from "@/components/ui/button";
import { runSimulationAsync, type GameReplay, type SimReport } from "@/game/simulate";
import { PATHWAYS } from "@/game/pathways";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

export function SimulatorView({ onBack }: { onBack: () => void }) {
  const [players, setPlayers] = useState<2 | 4>(4);
  const [games, setGames] = useState(24);
  const [report, setReport] = useState<SimReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [tab, setTab] = useState<"cards" | "arcana" | "replay">("arcana");
  const [replayIdx, setReplayIdx] = useState(0);
  const [logCursor, setLogCursor] = useState(0);

  const replay: GameReplay | null = report?.replays[replayIdx] ?? null;
  const visibleLog = useMemo(() => replay?.log.slice(0, logCursor + 1) ?? [], [replay, logCursor]);

  async function run() {
    setBusy(true);
    setProgress(`0 / ${games}`);
    const result = await runSimulationAsync(
      { players, games, seed: 7000 + players * 13, keepReplays: 12 },
      (done, total) => setProgress(`${done} / ${total}`),
    );
    setReport(result);
    setReplayIdx(0);
    setLogCursor(0);
    setBusy(false);
    setTab("arcana");
  }

  const playedCards = report?.cards.filter((c) => c.plays > 0) ?? [];
  const weak = [...playedCards].sort(
    (a, b) => a.winRateWhenPlayed - b.winRateWhenPlayed || a.damagePerPlay - b.damagePerPlay,
  );
  const strong = [...playedCards].sort(
    (a, b) => b.winRateWhenPlayed - a.winRateWhenPlayed || b.damagePerPlay - a.damagePerPlay,
  );

  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button type="button" className="text-sm text-stone-400 hover:text-amber-300" onClick={onBack}>
              ← Back
            </button>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl text-amber-100">
              AI Simulator
            </h1>
            <p className="max-w-2xl text-sm text-stone-400">
              Search-based AIs play full games. Arcana win rates and card usefulness update after
              each batch. Open a match to step through the chronicle.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-stone-400">
              Table
              <select
                className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
                value={players}
                onChange={(e) => setPlayers(Number(e.target.value) as 2 | 4)}
              >
                <option value={2}>2 players</option>
                <option value={4}>4 players</option>
              </select>
            </label>
            <label className="text-xs text-stone-400">
              Games
              <select
                className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
                value={games}
                onChange={(e) => setGames(Number(e.target.value))}
              >
                <option value={8}>8</option>
                <option value={24}>24</option>
                <option value={64}>64</option>
                <option value={256}>256</option>
                <option value={1024}>1024</option>
              </select>
            </label>
            <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" disabled={busy} onClick={() => void run()}>
              {busy ? progress : "Run AIs"}
            </Button>
          </div>
        </div>

        {!report && (
          <p className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-6 text-sm text-stone-400">
            Choose a table size and run. 1024 games keep the page responsive and store the first 12
            chronicles. Two-player games stress 1v1 matchups. Four-player games show free-for-all pressure.
          </p>
        )}

        {report && (
          <>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Finished" value={`${report.finished}/${report.games}`} />
              <Stat label="Timeouts" value={String(report.timeouts)} />
              <Stat label="Avg turns" value={report.avgTurns.toFixed(0)} />
              <Stat label="Attacks" value={report.avgAttacks.toFixed(1)} />
              <Stat label="HP dealt" value={report.avgHpDealt.toFixed(0)} />
              <Stat label="Table" value={`${report.players} players`} />
            </div>

            <div className="flex gap-2">
              {(["arcana", "cards", "replay"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm capitalize",
                    tab === id
                      ? "border-amber-500 bg-amber-950/50 text-amber-100"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>

            {tab === "arcana" && (
              <div className="overflow-x-auto rounded-xl border border-stone-700/60">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-stone-900/80 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Pathway</th>
                      <th className="px-3 py-2">Games</th>
                      <th className="px-3 py-2">Wins</th>
                      <th className="px-3 py-2">Win rate</th>
                      <th className="px-3 py-2">Avg Seq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pathways.map((p) => (
                      <tr key={p.id} className="border-t border-stone-800">
                        <td className="px-3 py-2" style={{ color: PATHWAYS.find((x) => x.id === p.id)?.accent }}>
                          {p.name}
                        </td>
                        <td className="px-3 py-2 text-stone-300">{p.games}</td>
                        <td className="px-3 py-2 text-stone-300">{p.wins}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              p.games === 0
                                ? "text-stone-500"
                                : p.winRate >= 0.35
                                  ? "text-emerald-300"
                                  : p.winRate <= 0.12
                                    ? "text-rose-300"
                                    : "text-stone-200",
                            )}
                          >
                            {p.games ? `${(p.winRate * 100).toFixed(0)}%` : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-stone-300">
                          {p.games ? p.avgSequence.toFixed(1) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-xs text-stone-500">
                  Green is ahead of the pack, rose is lagging. With {report.games} games a pathway
                  appears only a handful of times — run 24 before treating a gap as a real imbalance.
                </p>
              </div>
            )}

            {tab === "cards" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <CardTable title="Played most / stronger when played" rows={strong.slice(0, 12)} />
                <CardTable title="Weaker when played" rows={weak.slice(0, 12)} />
                <div className="overflow-x-auto rounded-xl border border-stone-700/60 lg:col-span-2">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-stone-900/80 text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="px-3 py-2">Card</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Plays</th>
                        <th className="px-3 py-2">Damage</th>
                        <th className="px-3 py-2">Dmg / play</th>
                        <th className="px-3 py-2">Win% when played</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playedCards.map((c) => (
                        <tr key={c.id} className="border-t border-stone-800">
                          <td className="px-3 py-1.5 text-stone-100">{c.name}</td>
                          <td className="px-3 py-1.5 text-stone-400">{c.type}</td>
                          <td className="px-3 py-1.5">{c.plays}</td>
                          <td className="px-3 py-1.5">{c.damage.toFixed(0)}</td>
                          <td className="px-3 py-1.5">{c.damagePerPlay.toFixed(1)}</td>
                          <td className="px-3 py-1.5">{(c.winRateWhenPlayed * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 py-2 text-xs text-stone-500">
                    Weapon damage includes later swings, not only the equip. Win% is how often the
                    player who played the card eventually won — a high number on a rare card can just
                    mean a winning seat drew it.
                  </p>
                </div>
              </div>
            )}

            {tab === "replay" && replay && (
              <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-stone-700/60 p-2">
                  {report.replays.map((g, i) => (
                    <button
                      key={g.seed}
                      type="button"
                      onClick={() => {
                        setReplayIdx(i);
                        setLogCursor(0);
                      }}
                      className={cn(
                        "w-full rounded-lg px-2 py-1.5 text-left text-xs",
                        i === replayIdx ? "bg-amber-950/60 text-amber-100" : "text-stone-400 hover:bg-stone-900",
                      )}
                    >
                      #{i + 1} · {g.turns}t · {g.timedOut ? "timeout" : g.winnerPathway || g.winReason}
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-3">
                  <p className="text-sm text-amber-100">
                    Seed {replay.seed} · {replay.turns} turns ·{" "}
                    {replay.timedOut ? "timed out" : `${replay.winnerName} (${replay.winnerPathway}) wins`}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {replay.pathways.map((p) => p.pathwayId).join(" · ")}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setLogCursor(0)}>
                      Start
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setLogCursor((n) => Math.min(replay.log.length - 1, n + 1))}
                    >
                      Next line
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setLogCursor((n) => Math.min(replay.log.length - 1, n + 8))}
                    >
                      +8
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setLogCursor(replay.log.length - 1)}>
                      End
                    </Button>
                  </div>
                  <ol className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto text-xs">
                    {visibleLog.map((e, i) => (
                      <li
                        key={`${i}-${e.text}`}
                        className={cn(
                          "text-stone-400",
                          e.tone === "damage" && "text-rose-300",
                          e.tone === "heal" && "text-emerald-300",
                          e.tone === "ascend" && "text-amber-200",
                        )}
                      >
                        {e.text}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-950/70 px-3 py-2">
      <p className="text-[0.65rem] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="font-[family-name:var(--font-display)] text-xl text-amber-100">{value}</p>
    </div>
  );
}

function CardTable({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; name: string; type: string; plays: number; winRateWhenPlayed: number; damagePerPlay: number }[];
}) {
  return (
    <div className="rounded-xl border border-stone-700/60 p-3">
      <p className="text-sm text-amber-100">{title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((c) => (
          <li key={c.id} className="flex justify-between gap-2 text-stone-300">
            <span>
              {c.name} <span className="text-stone-500">({c.type})</span>
            </span>
            <span className="shrink-0 text-stone-400">
              {c.plays} plays · {(c.winRateWhenPlayed * 100).toFixed(0)}% · {c.damagePerPlay.toFixed(1)} dmg
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
