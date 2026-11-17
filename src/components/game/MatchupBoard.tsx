"use client";

import { Button } from "@/components/ui/button";
import { PATHWAYS, curveLabel, pathwayCurve, type PathwayCurve } from "@/game/pathways";
import {
  runRoundRobin,
  type DuelResult,
  type SeatController,
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

function seatRows(
  duels: DuelResult[],
  ids: string[],
  allow: Set<SeatController> | null,
  sides: [SeatController, SeatController],
): SeatRow[] {
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
    const aOk = !allow || allow.has(sides[0]);
    const bOk = !allow || allow.has(sides[1]);
    if (!aOk && !bOk) continue;
    const a = rows.get(duel.a)!;
    const b = rows.get(duel.b)!;
    if (!aOk) {
      b.games += 1;
      b.turnSum += duel.turns;
      b.seqSum += duel.seqB;
      if (duel.winner === "b") {
        b.wins += 1;
        if (duel.reason === "hp") b.hp += 1;
        else if (duel.reason === "sanity") b.sanity += 1;
        else if (duel.reason === "ascension") b.ascension += 1;
      } else if (duel.winner === "a") b.losses += 1;
      continue;
    }
    if (!bOk) {
      a.games += 1;
      a.turnSum += duel.turns;
      a.seqSum += duel.seqA;
      if (duel.winner === "a") {
        a.wins += 1;
        if (duel.reason === "hp") a.hp += 1;
        else if (duel.reason === "sanity") a.sanity += 1;
        else if (duel.reason === "ascension") a.ascension += 1;
      } else if (duel.winner === "b") a.losses += 1;
      continue;
    }
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

interface PairScore {
  games: number;
  rowWins: number;
  colWins: number;
  hp: number;
  sanity: number;
  ascension: number;
  firstWins: number;
  secondWins: number;
}

function pairScore(
  duels: DuelResult[],
  row: string,
  col: string,
  allow: Set<SeatController> | null,
  sides: [SeatController, SeatController],
): PairScore {
  const out: PairScore = {
    games: 0,
    rowWins: 0,
    colWins: 0,
    hp: 0,
    sanity: 0,
    ascension: 0,
    firstWins: 0,
    secondWins: 0,
  };
  for (const duel of duels) {
    if (row === col) {
      if (duel.a !== row || duel.b !== row) continue;
      const firstSide = duel.aFirst ? sides[0] : sides[1];
      const secondSide = duel.aFirst ? sides[1] : sides[0];
      const firstOk = !allow || allow.has(firstSide);
      const secondOk = !allow || allow.has(secondSide);
      if (!firstOk && !secondOk) continue;
      out.games += 1;
      const firstWon = (duel.aFirst && duel.winner === "a") || (!duel.aFirst && duel.winner === "b");
      if (duel.winner && firstWon && firstOk) out.firstWins += 1;
      else if (duel.winner && !firstWon && secondOk) out.secondWins += 1;
      continue;
    }
    const rowIsA = duel.a === row && duel.b === col;
    const rowIsB = duel.b === row && duel.a === col;
    if (!rowIsA && !rowIsB) continue;
    const rowSide = rowIsA ? sides[0] : sides[1];
    if (allow && !allow.has(rowSide)) continue;
    out.games += 1;
    const rowWon = (rowIsA && duel.winner === "a") || (rowIsB && duel.winner === "b");
    const colWon = (rowIsA && duel.winner === "b") || (rowIsB && duel.winner === "a");
    if (rowWon) {
      out.rowWins += 1;
      if (duel.reason === "hp") out.hp += 1;
      else if (duel.reason === "sanity") out.sanity += 1;
      else if (duel.reason === "ascension") out.ascension += 1;
    } else if (colWon) out.colWins += 1;
  }
  return out;
}

function tone(rate: number, games: number) {
  if (!games) return "text-stone-600";
  if (rate >= 0.6) return "bg-emerald-950/70 text-emerald-200";
  if (rate <= 0.4) return "bg-rose-950/70 text-rose-200";
  return "bg-stone-900/80 text-stone-300";
}

export function MatchupBoard({
  onReport,
  picked,
  setPicked,
  filter,
  setFilter,
  playerFilter,
  setPlayerFilter,
  pinned = false,
}: {
  onReport?: (report: SimReport) => void;
  picked: string[];
  setPicked: (next: string[] | ((cur: string[]) => string[])) => void;
  filter: "all" | PathwayCurve | "custom";
  setFilter: (next: "all" | PathwayCurve | "custom") => void;
  playerFilter: "all" | SeatController;
  setPlayerFilter: (next: "all" | SeatController) => void;
  pinned?: boolean;
}) {
  const [duels, setDuels] = useState<DuelResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [perSide, setPerSide] = useState(5);
  const [seatA, setSeatA] = useState<SeatController>("ai");
  const [seatB, setSeatB] = useState<SeatController>("ai");
  const [usedSeeds, setUsedSeeds] = useState<number[]>([]);
  const [focus, setFocus] = useState<string[] | null>(null);
  const [sides, setSides] = useState<[SeatController, SeatController]>(["ai", "ai"]);
  const [sortCol, setSortCol] = useState<string>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const tableSort = useSort<keyof SeatRow>("winRate");

  const cells = useMemo(() => (duels ? buildMatrix(duels) : null), [duels]);
  const detailIds = focus && focus.length >= 2 && focus[0] !== focus[1] ? focus : picked;
  const allow = playerFilter === "all" ? null : new Set<SeatController>([playerFilter]);
  const detail = useMemo(
    () => (duels ? seatRows(duels, detailIds, allow, sides) : []),
    [duels, detailIds, playerFilter, sides],
  );
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
      if (!duels) return 0;
      if (against === "total") {
        let wins = 0;
        let losses = 0;
        for (const other of picked) {
          if (other === id) continue;
          const pair = pairScore(duels, id, other, allow, sides);
          wins += pair.rowWins;
          losses += pair.colWins;
        }
        return wins + losses ? wins / (wins + losses) : 0;
      }
      const pair = pairScore(duels, id, against, allow, sides);
      const decided = pair.rowWins + pair.colWins;
      return decided ? pair.rowWins / decided : 0;
    };
    return [...picked].sort((a, b) => compareValues(score(a), score(b), sortDir));
  }, [duels, picked, sortCol, sortDir, allow, sides]);

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
    const result = await runRoundRobin(
      perSide,
      (done, total) => setProgress(`${done} / ${total}`),
      { a: seatA, b: seatB },
    );
    setDuels(result.duels);
    setSides([seatA, seatB]);
    setUsedSeeds(result.seeds);
    onReport?.(result.report);
    setBusy(false);
  }

  const gamesEach = perSide * 2;

  const short = (id: string) => PATHWAYS.find((p) => p.id === id)?.name.replace(/^The /, "") ?? id;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-100">Round robin</h2>
          <p className="mt-1 text-sm text-stone-400">
            Every pathway meets every pathway, including itself. Each pairing is played {gamesEach}{" "}
            times, and each seat goes first once per seed. The seeds are drawn anew for every run.
            That is 253 pairings and {(253 * gamesEach).toLocaleString()} duels. A cell reads row
            wins / column wins, so Fool 6/4 against Death is Death 4/6 against Fool. The filters
            below stay in place on the other stat tabs, and those tables recount the same run.
            {usedSeeds.length > 0 && ` This run used seeds ${usedSeeds.join(", ")}.`}
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
          <SeatPick label="Row" value={seatA} disabled={busy} onChange={setSeatA} />
          <SeatPick label="Column" value={seatB} disabled={busy} onChange={setSeatB} />
          <Button className="bg-amber-600 text-stone-950 hover:bg-amber-500" disabled={busy} onClick={() => void run()}>
            {busy ? progress : duels ? "Run round robin again" : "Run 22×22"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Filter label="All 22" active={filter === "all"} onClick={() => pickCurve("all")} />
        <Filter label="Early peak" active={filter === "early"} onClick={() => pickCurve("early")} />
        <Filter label="Mid peak" active={filter === "mid"} onClick={() => pickCurve("mid")} />
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
        <Filter label="All players" active={playerFilter === "all"} onClick={() => setPlayerFilter("all")} />
        <Filter label="NN" active={playerFilter === "nn"} onClick={() => setPlayerFilter("nn")} />
        <Filter label="AI" active={playerFilter === "ai"} onClick={() => setPlayerFilter("ai")} />
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
        <div className={cn("overflow-auto rounded-xl border border-stone-700/60", pinned && "max-h-[38vh]")}>
          <table className="border-collapse text-left text-[0.65rem]">
            <thead className={pinned ? "sticky top-0 z-20 bg-stone-950" : undefined}>
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
                  if (other === row || !duels) continue;
                  const pair = pairScore(duels, row, other, allow, sides);
                  wins += pair.rowWins;
                  losses += pair.colWins;
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
                      const pair = duels ? pairScore(duels, row, col, allow, sides) : null;
                      const mirror = row === col;
                      const rowWins = mirror ? (pair?.firstWins ?? 0) : (pair?.rowWins ?? 0);
                      const colWins = mirror ? (pair?.secondWins ?? 0) : (pair?.colWins ?? 0);
                      const pairDecided = rowWins + colWins;
                      const label = pair?.games ? `${rowWins}/${colWins}` : "—";
                      const rate = pairDecided ? rowWins / pairDecided : 0;
                      const undecided = (pair?.games ?? 0) - pairDecided;
                      return (
                        <td key={col} className="p-0.5">
                          <button
                            type="button"
                            title={
                              mirror
                                ? `${short(row)} mirror. First player ${pair?.firstWins ?? 0}, second player ${pair?.secondWins ?? 0}${undecided ? `, ${undecided} with no winner` : ""}.`
                                : `${short(row)} ${rowWins} / ${short(col)} ${colWins}. HP ${pair?.hp ?? 0}, Sanity ${pair?.sanity ?? 0}, Ascension ${pair?.ascension ?? 0}${undecided ? `. ${undecided} with no winner` : ""}.`
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

function SeatPick({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: SeatController;
  disabled: boolean;
  onChange: (next: SeatController) => void;
}) {
  return (
    <label className="text-xs text-stone-400">
      {label}
      <select
        className="mt-1 block rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SeatController)}
      >
        <option value="ai">Search</option>
        <option value="nn">Network</option>
      </select>
    </label>
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
