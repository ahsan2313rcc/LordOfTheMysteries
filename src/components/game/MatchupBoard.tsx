"use client";

import { Button } from "@/components/ui/button";
import { PATHWAYS, curveLabel, pathwayCurve, type PathwayCurve } from "@/game/pathways";
import {
  ROUND_ROBIN_SEEDS,
  runRoundRobin,
  type DuelResult,
  type SimReport,
} from "@/game/simulate";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { compareValues, SortTh, useSort } from "./sort-table";

const IDS = PATHWAYS.map((p) => p.id);

interface Cell {
  games: number;
  wins: number;
  hp: number;
  sanity: number;
  ascension: number;
  turns: number;
  firstWins: number;
  secondWins: number;
}

interface SeatRow {
  id: string;
  name: string;
  curve: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  hp: number;
  sanity: number;
  ascension: number;
  avgSeq: number;
  avgTurns: number;
}

function emptyCell(): Cell {
  return { games: 0, wins: 0, hp: 0, sanity: 0, ascension: 0, turns: 0, firstWins: 0, secondWins: 0 };
}

export function buildMatrix(duels: DuelResult[]) {
  const cells = new Map<string, Cell>();
  const key = (row: string, col: string) => `${row}|${col}`;
  const cell = (row: string, col: string) => {
    const k = key(row, col);
    let c = cells.get(k);
    if (!c) {
      c = emptyCell();
      cells.set(k, c);
    }
    return c;
  };
  for (const duel of duels) {
    const ab = cell(duel.a, duel.b);
    const ba = cell(duel.b, duel.a);
    ab.games += 1;
    ab.turns += duel.turns;
    if (duel.a !== duel.b) {
      ba.games += 1;
      ba.turns += duel.turns;
    }
    const firstWon = (duel.aFirst && duel.winner === "a") || (!duel.aFirst && duel.winner === "b");
    if (duel.a === duel.b) {
      if (firstWon) ab.firstWins += 1;
      else if (duel.winner) ab.secondWins += 1;
      continue;
    }
    if (duel.winner === "a") {
      ab.wins += 1;
      if (duel.reason === "hp") ab.hp += 1;
      else if (duel.reason === "sanity") ab.sanity += 1;
      else if (duel.reason === "ascension") ab.ascension += 1;
    } else if (duel.winner === "b") {
      ba.wins += 1;
      if (duel.reason === "hp") ba.hp += 1;
      else if (duel.reason === "sanity") ba.sanity += 1;
      else if (duel.reason === "ascension") ba.ascension += 1;
    }
  }
  return cells;
}

function seatRows(duels: DuelResult[], ids: string[]): SeatRow[] {
  const set = new Set(ids);
  const rows = new Map<string, SeatRow & { seqSum: number; turnSum: number }>();
  for (const id of ids) {
    const pathway = PATHWAYS.find((p) => p.id === id)!;
    rows.set(id, {
      id,
      name: pathway.name,
      curve: curveLabel(pathwayCurve(id)),
      games: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      hp: 0,
      sanity: 0,
      ascension: 0,
      avgSeq: 0,
      avgTurns: 0,
      seqSum: 0,
      turnSum: 0,
    });
  }
  for (const duel of duels) {
    if (!set.has(duel.a) || !set.has(duel.b) || duel.a === duel.b) continue;
    const a = rows.get(duel.a)!;
    const b = rows.get(duel.b)!;
    a.games += 1;
    b.games += 1;
    a.turnSum += duel.turns;
    b.turnSum += duel.turns;
    a.seqSum += duel.seqA;
    b.seqSum += duel.seqB;
    if (duel.winner === "a") {
      a.wins += 1;
      b.losses += 1;
      if (duel.reason === "hp") a.hp += 1;
      else if (duel.reason === "sanity") a.sanity += 1;
      else if (duel.reason === "ascension") a.ascension += 1;
    } else if (duel.winner === "b") {
      b.wins += 1;
      a.losses += 1;
      if (duel.reason === "hp") b.hp += 1;
      else if (duel.reason === "sanity") b.sanity += 1;
      else if (duel.reason === "ascension") b.ascension += 1;
    }
  }
  return [...rows.values()].map((row) => ({
    id: row.id,
    name: row.name,
    curve: row.curve,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    winRate: row.wins + row.losses ? row.wins / (row.wins + row.losses) : 0,
    hp: row.hp,
    sanity: row.sanity,
    ascension: row.ascension,
    avgSeq: row.games ? row.seqSum / row.games : 0,
    avgTurns: row.games ? row.turnSum / row.games : 0,
  }));
}

function tone(rate: number, games: number) {
  if (!games) return "text-stone-600";
  if (rate >= 0.6) return "bg-emerald-950/70 text-emerald-200";
  if (rate <= 0.4) return "bg-rose-950/70 text-rose-200";
  return "bg-stone-900/80 text-stone-300";
}

export function MatchupBoard({ onReport }: { onReport?: (report: SimReport) => void }) {
  const [duels, setDuels] = useState<DuelResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [perSide, setPerSide] = useState(5);
  const [picked, setPicked] = useState<string[]>(IDS);
  const [focus, setFocus] = useState<string[] | null>(null);
  const [filter, setFilter] = useState<"all" | PathwayCurve | "custom">("all");
  const [sortCol, setSortCol] = useState<string>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const tableSort = useSort<keyof SeatRow>("winRate");

  const cells = useMemo(() => (duels ? buildMatrix(duels) : null), [duels]);
  const detailIds = focus && focus.length >= 2 && focus[0] !== focus[1] ? focus : picked;
  const detail = useMemo(() => (duels ? seatRows(duels, detailIds) : []), [duels, detailIds]);
  const sortedDetail = useMemo(() => {
    return [...detail].sort((a, b) =>
      compareValues(a[tableSort.key], b[tableSort.key], tableSort.direction),
    );
  }, [detail, tableSort.key, tableSort.direction]);

  const groupDuels = useMemo(() => {
    if (!duels || detailIds.length < 2) return [];
    const set = new Set(detailIds);
    return duels.filter((d) => set.has(d.a) && set.has(d.b));
  }, [duels, detailIds]);

  const endings = useMemo(() => {
    const tally = { hp: 0, sanity: 0, ascension: 0, timeout: 0 };
    for (const d of groupDuels) tally[d.reason] += 1;
    return tally;
  }, [groupDuels]);

  const axis = useMemo(() => {
    if (!cells) return picked;
    const against = sortCol !== "name" && sortCol !== "total" && picked.includes(sortCol) ? sortCol : "total";
    const score = (id: string) => {
      if (sortCol === "name") return PATHWAYS.find((p) => p.id === id)?.name ?? id;
      if (against === "total") {
        let wins = 0;
        let losses = 0;
        for (const other of picked) {
          if (other === id) continue;
          wins += cells.get(`${id}|${other}`)?.wins ?? 0;
          losses += cells.get(`${other}|${id}`)?.wins ?? 0;
        }
        return wins + losses ? wins / (wins + losses) : 0;
      }
      const wins = cells.get(`${id}|${against}`)?.wins ?? 0;
      const losses = cells.get(`${against}|${id}`)?.wins ?? 0;
      return wins + losses ? wins / (wins + losses) : 0;
    };
    return [...picked].sort((a, b) => compareValues(score(a), score(b), sortDir));
  }, [cells, picked, sortCol, sortDir]);

  function headerSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  }

  function toggle(id: string) {
    setFocus(null);
    setFilter("custom");
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function pickCurve(curve: PathwayCurve | "all") {
    setFocus(null);
    setFilter(curve);
    setSortCol("total");
    if (curve === "all") setPicked(IDS);
    else setPicked(IDS.filter((id) => pathwayCurve(id) === curve));
  }

  async function run() {
    const gamesEach = perSide * 2;
    setBusy(true);
    setFocus(null);
    setProgress(`0 / ${253 * gamesEach}`);
    const result = await runRoundRobin(perSide, (done, total) => setProgress(`${done} / ${total}`));
    setDuels(result.duels);
    onReport?.(result.report);
    setBusy(false);
  }

  const gamesEach = perSide * 2;
  const seeds = ROUND_ROBIN_SEEDS.slice(0, perSide);

  const short = (id: string) => PATHWAYS.find((p) => p.id === id)?.name.replace(/^The /, "") ?? id;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-100">Round robin</h2>
          <p className="mt-1 text-sm text-stone-400">
            Every pathway meets every pathway, including itself. Each pairing is played {gamesEach}{" "}
            times: seeds {seeds.join(", ")}, and each seat goes first once per seed. That is 253
            pairings and {(253 * gamesEach).toLocaleString()} duels. A cell reads row wins / column
            wins, so Fool 6/4 against Death is Death 4/6 against Fool. Filters hide pathways from
            both axes. Overview, Arcana, Items, Cards, and Replay fill from this same run.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-400">
            Games per side
            <select
              className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
              value={perSide}
              disabled={busy}
              onChange={(e) => setPerSide(Number(e.target.value))}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} × 2 sides = {n * 2}
                </option>
              ))}
            </select>
          </label>
          <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" disabled={busy} onClick={() => void run()}>
            {busy ? progress : duels ? "Run round robin again" : "Run 22×22"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Filter label="All 22" active={filter === "all"} onClick={() => pickCurve("all")} />
        <Filter label="Early peak" active={filter === "early"} onClick={() => pickCurve("early")} />
        <Filter label="Late peak" active={filter === "late"} onClick={() => pickCurve("late")} />
        <Filter label="Even" active={filter === "even"} onClick={() => pickCurve("even")} />
        <Filter
          label="Clear"
          active={picked.length === 0}
          onClick={() => {
            setFocus(null);
            setFilter("custom");
            setPicked([]);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PATHWAYS.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                on ? "border-amber-500 bg-amber-950/50 text-amber-100" : "border-stone-700 text-stone-500",
              )}
              style={on ? { color: p.accent } : undefined}
            >
              {short(p.id)}
            </button>
          );
        })}
      </div>

      {!duels && (
        <p className="rounded-xl border border-stone-700/60 bg-stone-950/70 p-4 text-sm text-stone-400">
          The table fills in as the duels finish. A full pass takes a few minutes. The count on the
          button is how far it has gotten.
        </p>
      )}

      {duels && cells && (
        <div className="overflow-x-auto rounded-xl border border-stone-700/60">
          <table className="border-collapse text-left text-[0.65rem]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-stone-950 px-2 py-2">
                  <button type="button" className="uppercase tracking-wide text-stone-400 hover:text-amber-200" onClick={() => headerSort("name")}>
                    Pathway {sortCol === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th className="px-2 py-2">
                  <button type="button" className="uppercase tracking-wide text-stone-400 hover:text-amber-200" onClick={() => headerSort("total")}>
                    Overall {sortCol === "total" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                {axis.map((col) => (
                  <th key={col} className="px-1 py-2 font-normal">
                    <button
                      type="button"
                      className="max-w-16 truncate text-stone-400 hover:text-amber-200"
                      title={PATHWAYS.find((p) => p.id === col)?.name}
                      onClick={() => headerSort(col)}
                    >
                      {short(col)}
                      {sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axis.map((row) => {
                let wins = 0;
                let losses = 0;
                for (const other of axis) {
                  if (other === row) continue;
                  wins += cells.get(`${row}|${other}`)?.wins ?? 0;
                  losses += cells.get(`${other}|${row}`)?.wins ?? 0;
                }
                const decided = wins + losses;
                return (
                  <tr key={row} className="border-t border-stone-800">
                    <th className="sticky left-0 z-10 bg-stone-950 px-2 py-1 text-left font-normal text-stone-200">
                      {short(row)}
                    </th>
                    <td className="px-2 py-1 text-stone-300">
                      {decided ? `${Math.round((100 * wins) / decided)}%` : "—"}
                    </td>
                    {axis.map((col) => {
                      const c = cells.get(`${row}|${col}`) ?? emptyCell();
                      const opp = cells.get(`${col}|${row}`) ?? emptyCell();
                      const mirror = row === col;
                      const rowWins = mirror ? c.firstWins : c.wins;
                      const colWins = mirror ? c.secondWins : opp.wins;
                      const pairDecided = rowWins + colWins;
                      const label = c.games ? `${rowWins}/${colWins}` : "—";
                      const rate = pairDecided ? rowWins / pairDecided : 0;
                      const undecided = c.games - pairDecided;
                      return (
                        <td key={col} className="p-0.5">
                          <button
                            type="button"
                            title={
                              mirror
                                ? `${short(row)} mirror. First player ${c.firstWins}, second player ${c.secondWins}${undecided ? `, ${undecided} with no winner` : ""}.`
                                : `${short(row)} ${rowWins} / ${short(col)} ${colWins}. HP ${c.hp}, Sanity ${c.sanity}, Ascension ${c.ascension}${undecided ? `. ${undecided} with no winner` : ""}.`
                            }
                            onClick={() => setFocus(mirror ? [row] : [row, col])}
                            className={cn("w-full rounded px-1 py-1 tabular-nums", tone(rate, pairDecided))}
                          >
                            {label}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-stone-500">
            A cell is the row’s wins over the column’s wins. Green is 60% of decided games or better,
            rose is 40% or worse. A Sanity wipe or a timeout has no winner, so it sits in neither
            number. The diagonal is the mirror match: first player / second player. Headers sort rows
            and columns together, so the diagonal stays the mirrors.
          </p>
        </div>
      )}

      {duels && axis.length === 0 && (
        <p className="text-sm text-stone-500">Choose pathways, or All 22, to fill the table.</p>
      )}

      {duels && detailIds.length >= 2 && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm text-amber-100">
              {detailIds.length} pathways · {groupDuels.length} duels
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              {detailIds.map((id) => short(id)).join(", ")}. These are the pairwise duels inside the
              selection, including mirrors. HP {endings.hp}, Sanity {endings.sanity}, Ascension{" "}
              {endings.ascension}, timeout {endings.timeout}.
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-stone-700/60">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-stone-900/80 text-xs">
                <tr>
                  {(
                    [
                      ["name", "Pathway"],
                      ["curve", "Curve"],
                      ["games", "Games"],
                      ["wins", "Wins"],
                      ["losses", "Losses"],
                      ["winRate", "Win rate"],
                      ["hp", "HP"],
                      ["sanity", "Sanity"],
                      ["ascension", "Ascension"],
                      ["avgSeq", "Avg seq"],
                      ["avgTurns", "Avg turns"],
                    ] as [keyof SeatRow, string][]
                  ).map(([key, label]) => (
                    <SortTh
                      key={key}
                      label={label}
                      active={tableSort.key === key}
                      direction={tableSort.direction}
                      onClick={() => tableSort.toggle(key)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDetail.map((row) => (
                  <tr key={row.id} className="border-t border-stone-800">
                    <td className="px-3 py-2" style={{ color: PATHWAYS.find((p) => p.id === row.id)?.accent }}>
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-stone-400">{row.curve}</td>
                    <td className="px-3 py-2">{row.games}</td>
                    <td className="px-3 py-2">{row.wins}</td>
                    <td className="px-3 py-2">{row.losses}</td>
                    <td className="px-3 py-2">{row.games ? `${Math.round(row.winRate * 100)}%` : "—"}</td>
                    <td className="px-3 py-2">{row.hp}</td>
                    <td className="px-3 py-2">{row.sanity}</td>
                    <td className="px-3 py-2">{row.ascension}</td>
                    <td className="px-3 py-2">{row.games ? row.avgSeq.toFixed(1) : "—"}</td>
                    <td className="px-3 py-2">{row.games ? row.avgTurns.toFixed(0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-stone-500">
              Win rate ignores mirror matches. Click a column to sort. HP, Sanity, and Ascension
              count that pathway’s wins by how the duel ended.
            </p>
          </div>
        </div>
      )}

      {duels && detailIds.length < 2 && (
        <p className="text-sm text-stone-500">Select at least two pathways to open the group table.</p>
      )}
    </section>
  );
}

function Filter({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        active
          ? "border-amber-500 bg-amber-950/50 text-amber-100"
          : "border-stone-600 text-stone-300 hover:border-amber-600 hover:text-amber-100",
      )}
    >
      {label}
    </button>
  );
}
