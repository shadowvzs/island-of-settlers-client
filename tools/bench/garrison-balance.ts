import {
  BALANCE_SEEDS,   type BalanceSummary, forceSize, type ForceSpec,
MILITARY_BUILDING_NAMES, runSeeds, simulateColonyAssault,
  simulateGarrisonAssault, simulateWallAssault, summarize, typicalForce} from "./garrison-balance-harness";

/**
 * Siege and garrison balance report (docs/contracts/settlement-military-contract.md, "Garrison balance").
 * Run: `npx tsx tools/bench/garrison-balance.ts` — `CASES=garrisons,walls,colonies` limits the
 * sections, `SEEDS=10` the seeds per case (at least ten for the documented numbers), `DIFFICULTY=medium`
 * the colony cases (the colony section is slow: run one process per difficulty in parallel).
 */
const difficulties = new Set((process.env.DIFFICULTY ?? "easy,medium,hard").split(","));
const sections = new Set((process.env.CASES ?? "garrisons,walls,colonies").split(","));
const seeds = BALANCE_SEEDS.slice(0, Number(process.env.SEEDS ?? BALANCE_SEEDS.length));
const AVERAGE: readonly number[] = [0, 1];
const VETERANS: readonly number[] = [1, 2];
const SUPPORT = { "melee": {}, "+archers": { archers: true }, "+cavalry": { cavalry: true },
  "mixed": { archers: true, cavalry: true } } as const;

const percent = (value: number) => `${Math.round(value * 100)} %`;
const row = (cells: readonly (string | number)[]) => console.log(`| ${cells.join(" | ")} |`);
const header = (cells: readonly string[]) => { row(cells); row(cells.map(() => "---")); };
const summaryCells = (summary: BalanceSummary) => [percent(summary.winRate), summary.meanLosses.toFixed(1),
  percent(summary.lossShare), summary.meanWinSeconds === null ? "–" : `${Math.round(summary.meanWinSeconds)} s`];
const forceLabel = (force: ForceSpec) => `${forceSize(force)} (${force.shield ?? 0} sw, ${force.heavy ?? 0} ax, ` +
  `${force.archer ?? 0} ar, ${force.cavalry ?? 0} cav; ranks ${force.ranks.join("/")})`;

const garrisonSection = () => {
  console.log(`\n### Single garrisons (rank 0 defenders, ${seeds.length} seeds)\n`);
  header(["Building", "Force", "Support", "Win", "Losses", "Loss share", "Time to capture"]);
  for (const typeId of [1, 2, 4, 9]) for (const size of [4, 8, 12, 16])
    for (const [label, support] of Object.entries(SUPPORT)) {
      if (label === "mixed") continue;
      const force = typicalForce(size, support);
      const summary = summarize(runSeeds(seed => simulateGarrisonAssault({ force, seed, typeId }), seeds));
      row([MILITARY_BUILDING_NAMES[typeId]!, size, label, ...summaryCells(summary)]);
    }
};

/** Seconds to fell an undefended colony fort's walls (owner decision 2026-10-13: forts are destroyed). */
const wallSection = () => {
  console.log(`\n### Colony fort walls (undefended, ${seeds.length} seeds)\n`);
  header(["Building", "Force", "Support", "Mean time to fell", "Slowest"]);
  for (const typeId of [1, 2, 4, 9]) for (const size of [10, 15, 30]) for (const label of ["melee", "mixed"] as const) {
    const force = typicalForce(size, SUPPORT[label], AVERAGE);
    const times = seeds.map(seed => simulateWallAssault({ force, seed, typeId }));
    const felled = times.filter((time): time is number => time !== null);
    const mean = felled.length ? `${Math.round(felled.reduce((sum, time) => sum + time, 0) / felled.length)} s` : "–";
    const slowest = felled.length === times.length ? `${Math.max(...felled)} s` : "not felled";
    row([MILITARY_BUILDING_NAMES[typeId]!, size, label, mean, slowest]);
  }
};

/** Owner targets (2026-10-13): easy ~12–15 soldiers, medium ~25–30, hard 40+ (veterans). */
const COLONY_CASES = [
  ["easy", 10, AVERAGE], ["easy", 12, AVERAGE], ["easy", 15, AVERAGE],
  ["medium", 22, AVERAGE], ["medium", 25, AVERAGE], ["medium", 28, AVERAGE], ["medium", 30, AVERAGE],
  ["hard", 35, VETERANS], ["hard", 40, VETERANS], ["hard", 45, VETERANS], ["hard", 50, VETERANS],
  ["hard", 50, AVERAGE]
] as const;

const colonySection = () => {
  console.log(`\n### Colonies (every fort of the island, ${seeds.length} seeds)\n`);
  header(["Difficulty", "Force", "Support", "Win", "Losses", "Loss share", "Time to win"]);
  const cases = COLONY_CASES.filter(([difficulty]) => difficulties.has(difficulty));
  for (const [difficulty, size, ranks] of cases) for (const label of ["melee", "mixed"] as const) {
    const force = typicalForce(size, SUPPORT[label], ranks);
    const summary = summarize(runSeeds(seed => simulateColonyAssault({ difficulty, force, seed }), seeds));
    row([difficulty, forceLabel(force), label, ...summaryCells(summary)]);
  }
};

if (sections.has("garrisons")) garrisonSection();
if (sections.has("walls")) wallSection();
if (sections.has("colonies")) colonySection();
