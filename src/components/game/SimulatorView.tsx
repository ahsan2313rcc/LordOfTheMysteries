"use client";

import { Button } from "@/components/ui/button";
import { runSimulationAsync, type GameReplay, type RateStat, type SimReport } from "@/game/simulate";
import { PATHWAYS } from "@/game/pathways";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

type SimTab = "overview" | "arcana" | "items" | "cards" | "replay";

const TABS: { id: SimTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "arcana", label: "Arcana" },
  { id: "items", label: "Items" },
  { id: "cards", label: "Cards" },
  { id: "replay", label: "Replay" },
];

function pct(count: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((count / total) * 100)}%`;
}

function pathwayName(id: string): string {
  return PATHWAYS.find((p) => p.id === id)?.name ?? id;
}

function reasonLabel(game: { timedOut: boolean; winReason: string }): string {
  if (game.timedOut) return "Timeout";
  if (game.winReason === "lastStanding") return "HP";
  if (game.winReason === "madness") return "Sanity";
  if (game.winReason === "apotheosis") return "Ascension";
  return "Other";
}

export function SimulatorView({ onBack }: { onBack: () => void }) {
  const [players, setPlayers] = useState<2 | 4>(4);
  const [games, setGames] = useState(24);
  const [concealment, setConcealment] = useState(false);
  const [report, setReport] = useState<SimReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [tab, setTab] = useState<SimTab>("overview");
  const [replayIdx, setReplayIdx] = useState(0);
  const [logCursor, setLogCursor] = useState(0);

  const replay: GameReplay | null = report?.replays[replayIdx] ?? null;
  const visibleLog = useMemo(() => replay?.log.slice(0, logCursor + 1) ?? [], [replay, logCursor]);

  async function run() {
    setBusy(true);
    setProgress(`0 / ${games}`);
    const result = await runSimulationAsync(
      { players, games, seed: 7000 + players * 13, keepReplays: 12, arcanaConcealment: concealment },
      (done, total) => setProgress(`${done} / ${total}`),
    );
    setReport(result);
    setReplayIdx(0);
    setLogCursor(0);
    setBusy(false);
    setTab("overview");
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
              Search-based AIs play full games. After a batch, the overview shows how matches ended,
              who won from behind, and which Arcana, items, and relics kept winning.
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
            <label className="flex items-center gap-2 pb-1 text-xs text-stone-300">
              <input
                type="checkbox"
                checked={concealment}
                onChange={(e) => setConcealment(e.target.checked)}
              />
              Arcana Concealment
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
              <Stat label="HP endings" value={pct(report.endings.hp, report.games)} />
              <Stat label="Sanity endings" value={pct(report.endings.sanity, report.games)} />
              <Stat label="Ascension" value={pct(report.endings.ascension, report.games)} />
              <Stat label="Lower-seq wins" value={pct(report.lowerSeqWins, report.decided)} />
              <Stat label="Comebacks" value={pct(report.anyComebacks, report.decided)} />
            </div>

            <div className="flex flex-wrap gap-2">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-pressed={tab === item.id}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm",
                    tab === item.id
                      ? "border-amber-500 bg-amber-950/50 text-amber-100"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "overview" && <Overview report={report} />}

            {tab === "arcana" && (
              <div className="flex flex-col gap-4">
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
                  appears only a handful of times — run 64 or more before treating a gap as a real imbalance.
                  On a 4-player table an even pathway wins about 25% of its games. On a 2-player table, about half.
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-stone-700/60">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-stone-900/80 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Pathway</th>
                      <th className="px-3 py-2">Wins</th>
                      <th className="px-3 py-2">HP</th>
                      <th className="px-3 py-2">Sanity</th>
                      <th className="px-3 py-2">Ascension</th>
                      <th className="px-3 py-2">Lower seq</th>
                      <th className="px-3 py-2">HP hole</th>
                      <th className="px-3 py-2">Caught up</th>
                      <th className="px-3 py-2">Avg win seq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pathways.map((p) => (
                      <tr key={`${p.id}-how`} className="border-t border-stone-800">
                        <td className="px-3 py-2" style={{ color: PATHWAYS.find((x) => x.id === p.id)?.accent }}>
                          {p.name}
                        </td>
                        <td className="px-3 py-2 text-stone-300">{p.wins}</td>
                        <td className="px-3 py-2 text-stone-300">{p.hpWins}</td>
                        <td className="px-3 py-2 text-stone-300">{p.sanityWins}</td>
                        <td className="px-3 py-2 text-stone-300">{p.ascensionWins}</td>
                        <td className="px-3 py-2 text-stone-300">{p.wins ? pct(p.lowerSeqWins, p.wins) : "—"}</td>
                        <td className="px-3 py-2 text-stone-300">{p.wins ? pct(p.hpComebacks, p.wins) : "—"}</td>
                        <td className="px-3 py-2 text-stone-300">{p.wins ? pct(p.seqComebacks, p.wins) : "—"}</td>
                        <td className="px-3 py-2 text-stone-300">{p.wins ? p.avgWinSequence.toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-xs text-stone-500">
                  Lower seq is the share of that pathway&apos;s wins where it finished less advanced than
                  someone else. HP hole means it won after falling to 10 HP or less while trailing by 6.
                  Caught up means it was behind on Sequence and finished level with or ahead of that lead.
                  Sanity endings have no winner, so that column stays at zero unless a pathway is credited.
                </p>
              </div>
              </div>
            )}

            {tab === "items" && <ItemsPanel report={report} />}

            {tab === "cards" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <BucketList
                    title="When a card is played"
                    hint="Win% is how often the seat who played the card eventually won. Relics are counted apart from other rares."
                    rows={report.playBuckets}
                  />
                </div>
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
                          <td className="px-3 py-1.5 text-stone-400">
                            {c.type}
                            {c.rarity === "rare" ? " · rare" : ""}
                          </td>
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
                      #{i + 1} · {g.turns}t · {reasonLabel(g)}
                      {g.winnerPathway ? ` · ${pathwayName(g.winnerPathway)}` : ""}
                      {g.lowerSeqWin ? " · lower seq" : ""}
                      {g.hpComeback || g.seqComeback ? " · comeback" : ""}
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-3">
                  <p className="text-sm text-amber-100">
                    Seed {replay.seed} · {replay.turns} turns · {reasonLabel(replay)}
                    {replay.winnerPathway
                      ? ` · ${replay.winnerName} (${pathwayName(replay.winnerPathway)}) wins`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    {replay.winnerSequence != null && (
                      <>
                        Winner finished at Sequence {replay.winnerSequence}
                        {replay.bestOtherSequence != null
                          ? `, best opponent at Sequence ${replay.bestOtherSequence}`
                          : ""}
                        .{" "}
                      </>
                    )}
                    {replay.lowerSeqWin && "Less advanced player won. "}
                    {replay.seqLeadWin && "The sequence leader won. "}
                    {replay.seqTie && "The winner was tied for the furthest sequence. "}
                    {replay.hpComeback && "Won after an HP hole. "}
                    {replay.healedComeback && "Climbed at least 4 HP out of that hole. "}
                    {replay.seqComeback && "Caught a sequence lead they had lost."}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {replay.pathways.map((p) => pathwayName(p.pathwayId)).join(" · ")}
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

function Overview({ report }: { report: SimReport }) {
  const endings = [
    {
      label: "HP",
      count: report.endings.hp,
      tone: "#fb7185",
      hint: "Last one standing. Everyone else reached 0 HP.",
    },
    {
      label: "Sanity",
      count: report.endings.sanity,
      tone: "#c4b5fd",
      hint: "No contender left. Madness took the board, so nobody is credited with the win.",
    },
    {
      label: "Ascension",
      count: report.endings.ascension,
      tone: "#fbbf24",
      hint: "Someone drank the Sequence 0 potion.",
    },
    {
      label: "Timeout",
      count: report.endings.timeout,
      tone: "#a8a29e",
      hint: "The match hit the turn cap before anyone won.",
    },
    {
      label: "Other",
      count: report.endings.other,
      tone: "#78716c",
      hint: "The table wiped without a recorded reason.",
    },
  ];
  const peak = Math.max(1, ...report.winnerSequence);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-4">
        <h2 className="text-sm text-amber-100">How games ended</h2>
        <p className="mt-1 text-xs text-stone-500">Share of all {report.games} games.</p>
        <div className="mt-3 space-y-3">
          {endings
            .filter((row) => row.label !== "Other" || row.count > 0)
            .map((row) => (
              <Meter
                key={row.label}
                label={row.label}
                count={row.count}
                total={report.games}
                tone={row.tone}
                hint={row.hint}
              />
            ))}
        </div>
      </section>

      <section className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-4">
        <h2 className="text-sm text-amber-100">Who was further along</h2>
        <p className="mt-1 text-xs text-stone-500">
          Sequence 9 is the start. A smaller number is further along. These shares use the{" "}
          {report.decided} games that named a winner.
        </p>
        <div className="mt-3 space-y-3">
          <Meter
            label="Sequence leader won"
            count={report.seqLeadWins}
            total={report.decided}
            tone="#34d399"
            hint="The winner finished further along than every other seat."
          />
          <Meter
            label="Tied for the lead"
            count={report.seqTies}
            total={report.decided}
            tone="#e7e5e4"
            hint="The winner finished on the same Sequence as the most advanced opponent."
          />
          <Meter
            label="Lower sequence won"
            count={report.lowerSeqWins}
            total={report.decided}
            tone="#fb923c"
            hint="The winner finished less advanced than someone else and still won."
          />
        </div>
      </section>

      <section className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-4">
        <h2 className="text-sm text-amber-100">Comebacks</h2>
        <p className="mt-1 text-xs text-stone-500">
          Also among the {report.decided} decided games. A game can count in more than one row.
        </p>
        <div className="mt-3 space-y-3">
          <Meter
            label="Won from an HP hole"
            count={report.hpComebacks}
            total={report.decided}
            tone="#fb7185"
            hint="The winner fell to 10 HP or less while an opponent had at least 6 more HP."
          />
          <Meter
            label="Healed out of that hole"
            count={report.healedComebacks}
            total={report.decided}
            tone="#6ee7b7"
            hint="After the hole, their HP climbed at least 4 above that low point."
          />
          <Meter
            label="Caught a sequence lead"
            count={report.seqComebacks}
            total={report.decided}
            tone="#fbbf24"
            hint="They were behind on Sequence after the opening, then finished level with or ahead of that lead."
          />
          <Meter
            label="Any comeback"
            count={report.anyComebacks}
            total={report.decided}
            tone="#fdba74"
            hint="An HP hole or a sequence catch-up. Healing is already inside the HP-hole count."
          />
        </div>
      </section>

      <section className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-4">
        <h2 className="text-sm text-amber-100">Sequence the winner finished on</h2>
        <p className="mt-1 text-xs text-stone-500">
          Average winning Sequence {report.decided ? report.avgWinnerSequence.toFixed(1) : "—"}. The table
          average, winners and losers together, is {report.avgSequence.toFixed(1)}.
        </p>
        <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {[9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((seq) => {
            const count = report.winnerSequence[seq] ?? 0;
            return (
              <div key={seq} className="text-center">
                <div className="flex h-16 items-end justify-center">
                  <div
                    className="w-full rounded-sm bg-amber-500/80"
                    style={{ height: `${Math.max(count ? 8 : 0, (count / peak) * 64)}px` }}
                  />
                </div>
                <p className="mt-1 text-xs text-stone-300">{count}</p>
                <p className="text-[0.65rem] text-stone-500">Seq {seq}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="lg:col-span-2">
        <BucketList
          title="Gear still equipped at the end"
          hint="Holder win% is the seat who still had the piece when the game ended. One seat can hold a weapon and charms at once, so the rows are not a split of the games."
          rows={report.gearBuckets}
        />
      </div>
    </div>
  );
}

function ItemsPanel({ report }: { report: SimReport }) {
  const relics = report.gear
    .filter((g) => g.slot === "relic")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const held = report.gear.filter((g) => g.held > 0);

  return (
    <div className="flex flex-col gap-4">
      <BucketList
        title="What the table was holding"
        hint="Rare gear is a seat who finished with a rare weapon, a rare charm, or either relic. Relics are Mirror of Arrodes and the Magic Wishing Lamp."
        rows={report.gearBuckets}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {relics.map((relic) => (
          <div key={relic.id} className="rounded-xl border border-amber-900/50 bg-stone-950/70 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-600">Relic</p>
            <p className="mt-1 text-lg text-amber-100">{relic.name}</p>
            <p className="mt-2 text-sm text-stone-300">
              Held at the end {relic.held} time{relic.held === 1 ? "" : "s"}
              {relic.held ? ` · holder won ${pct(relic.holderWins, relic.held)}` : ""}
            </p>
            <p className="mt-1 text-sm text-stone-400">
              Played {relic.plays} time{relic.plays === 1 ? "" : "s"}
              {relic.plays ? ` · that seat won ${(relic.winRateWhenPlayed * 100).toFixed(0)}%` : ""}
            </p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-700/60">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-stone-900/80 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Slot</th>
              <th className="px-3 py-2">Rarity</th>
              <th className="px-3 py-2">Held at end</th>
              <th className="px-3 py-2">Holder win%</th>
              <th className="px-3 py-2">Plays</th>
              <th className="px-3 py-2">Win% when played</th>
            </tr>
          </thead>
          <tbody>
            {held.map((g) => (
              <tr key={g.id} className="border-t border-stone-800">
                <td className="px-3 py-1.5 text-stone-100">{g.name}</td>
                <td className="px-3 py-1.5 capitalize text-stone-400">{g.slot}</td>
                <td className="px-3 py-1.5 text-stone-400">{g.rarity}</td>
                <td className="px-3 py-1.5">{g.held}</td>
                <td className="px-3 py-1.5">{pct(g.holderWins, g.held)}</td>
                <td className="px-3 py-1.5">{g.plays}</td>
                <td className="px-3 py-1.5">{g.plays ? `${(g.winRateWhenPlayed * 100).toFixed(0)}%` : "—"}</td>
              </tr>
            ))}
            {held.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-stone-500" colSpan={7}>
                  No weapons, charms, or relics were still equipped when these games ended.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Meter({
  label,
  count,
  total,
  tone,
  hint,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
  hint: string;
}) {
  const width = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-stone-200">{label}</span>
        <span className="shrink-0 text-stone-400">
          {count}
          {total ? ` · ${width}%` : ""}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-800">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: tone }} />
      </div>
      <p className="mt-1 text-xs text-stone-500">{hint}</p>
    </div>
  );
}

function BucketList({ title, hint, rows }: { title: string; hint: string; rows: RateStat[] }) {
  return (
    <div className="rounded-xl border border-stone-700/60 p-3">
      <p className="text-sm text-amber-100">{title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex justify-between gap-3 text-stone-300">
            <span>{row.label}</span>
            <span className="shrink-0 text-stone-400">
              {row.count ? `${row.count} · ${pct(row.wins, row.count)} win` : "0"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-500">{hint}</p>
    </div>
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
