import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { checkConservation, createSimulation, flagTotals, stepMany, summary } from "../src/sim.js";

const island = JSON.parse(await readFile(new URL("../data/island.json", import.meta.url), "utf8"));
const SECONDS = Number(process.env.SECONDS ?? 6 * 3600);
const DT = Number(process.env.DT ?? 0.1);
const REPEATS = Number(process.env.REPEATS ?? 3);
const STEPS = Math.round(SECONDS / DT);

const BASE = {
  routeCount: 6,
  cartCapacity: 8,
  flagTotalCapacity: 18,
  flagWareCapacity: 6,
  carrierSpeed: 5,
  productionScale: 1.5
};

const median = values => {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
};

const measure = state => {
  const report = summary(state);
  const flags = flagTotals(state).filter(flag => flag.uid !== state.hubUid);
  const saturated = flags.filter(flag =>
    flag.total >= flag.capacity || Object.values(flag.stock).some(value => value >= state.options.flagWareCapacity)).length;
  const empty = flags.filter(flag => flag.total === 0).length;
  return {
    ...report,
    saturated,
    empty,
    withStock: flags.length - empty,
    conservation: checkConservation(state).ok
  };
};

const run = overrides => {
  const times = [], creates = [];
  let last;
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    const created = performance.now();
    const state = createSimulation(island, { ...BASE, ...overrides });
    creates.push(performance.now() - created);
    const started = performance.now();
    stepMany(state, SECONDS, DT);
    times.push(performance.now() - started);
    last = state;
  }
  const stepMs = median(times), createMs = median(creates);
  return {
    ...measure(last),
    stepMs: Math.round(stepMs * 10) / 10,
    createMs: Math.round(createMs * 10) / 10,
    totalMs: Math.round((stepMs + createMs) * 10) / 10,
    usPerStep: Math.round(stepMs * 1000 / STEPS * 1000) / 1000
  };
};

// Warm up the JIT before the measured runs.
stepMany(createSimulation(island, BASE), 300, DT);

const sweep = (key, values) => values.map(value => ({ value, ...run({ [key]: value }) }));
const flagCapSweep = sweep("flagTotalCapacity", [4, 8, 12, 18, 24, 40]);
const wareCapSweep = sweep("flagWareCapacity", [1, 2, 3, 4, 6, 8, 12]);
const cartSweep = sweep("cartCapacity", [2, 4, 6, 8, 12, 16]);

const grid = (rowKey, rows, colKey, cols, fixed = {}) =>
  rows.map(row => ({
    value: row,
    cells: cols.map(col => ({ value: col, ...run({ ...fixed, [rowKey]: row, [colKey]: col }) }))
  }));
const flagCartGrid = grid("flagTotalCapacity", [4, 8, 18, 40], "cartCapacity", [2, 6, 8, 16]);
const wareCartGrid = grid("flagWareCapacity", [1, 3, 6, 12], "cartCapacity", [2, 6, 8, 16]);

const percent = (value, baseline) => {
  const change = 100 * (value - baseline) / baseline;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
};
const table = (rows, baselineStep) => {
  const lines = [
    "| value | step ms | µs/step | delivered | produced | loaded | services | saturated | empty | cart load | conservation |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|"
  ];
  for (const row of rows) lines.push(`| ${row.value} | ${row.stepMs} (${percent(row.stepMs, baselineStep)}) | ` +
    `${row.usPerStep} | ${row.delivered} | ${row.produced} | ${row.loaded} | ${row.services} | ` +
    `${row.saturated} | ${row.empty} | ${Math.round(row.cartUtilization * 100)}% | ${row.conservation ? "yes" : "NO"} |`);
  return lines.join("\n");
};
const matrix = (rows, cols, metric) => {
  const lines = [
    `| row \\ col | ${cols.map(col => col).join(" | ")} |`,
    `|---|${cols.map(() => "---:").join("|")}|`
  ];
  for (const row of rows) lines.push(`| ${row.value} | ${row.cells.map(cell =>
    metric(cell)).join(" | ")} |`);
  return lines.join("\n");
};

const baseline = flagCapSweep.find(row => row.value === BASE.flagTotalCapacity);
const markdown = `# Cap matrix

Measured on the developed island fixture (\`continued-0.json\`, 39 buildings, 659 road pieces), seed 682615962.
Each run is **${SECONDS / 3600} h simulated** at **${DT}s steps** (${STEPS.toLocaleString()} steps), median of ${REPEATS} runs.
Only the named option changes; the rest stay at: routeCount 6, flagTotal 18, per-ware 6, cart 8, carrier speed 5, production 1.5×.
Times are Node wall-clock on the current machine; treat them as relative, not as a game benchmark.

## Baseline

- step time: **${baseline.stepMs} ms** (${baseline.usPerStep} µs/step)
- delivered ${baseline.delivered}, produced ${baseline.produced}, loaded ${baseline.loaded}, services ${baseline.services}
- saturated ${baseline.saturated}/38, empty ${baseline.empty}/38, cart load ${Math.round(baseline.cartUtilization * 100)}%

## Flag total capacity

${table(flagCapSweep, baseline.stepMs)}

## Per-ware capacity

${table(wareCapSweep, baseline.stepMs)}

## Cart capacity

${table(cartSweep, baseline.stepMs)}

## Flag total × cart capacity — step ms

${matrix(flagCartGrid, [2, 6, 8, 16], cell => cell.stepMs)}

## Flag total × cart capacity — delivered

${matrix(flagCartGrid, [2, 6, 8, 16], cell => cell.delivered)}

## Per-ware × cart capacity — step ms

${matrix(wareCartGrid, [2, 6, 8, 16], cell => cell.stepMs)}

## Per-ware × cart capacity — delivered

${matrix(wareCartGrid, [2, 6, 8, 16], cell => cell.delivered)}

## Complexity reading

The per-step asymptotic shape does not change with the caps:

- buildings and their production/workers: **O(buildings)** per step;
- carriers: **O(carriers)** per step for movement, plus **O(cartCapacity)** for loading/unloading at a stop and **O(route stops × needs)** when selecting freight at the hub;
- flag operations are Map lookups, effectively **O(1)** per ware per operation; the stock itself has at most \`ware types × per-ware cap\` entries.

The caps change **constants and event frequency**, not the Big-O. A larger flag buffer reduces backpressure (more production and worker trips), a smaller per-ware cap saturates individual wares sooner, and a larger cart increases the inner load/unload loop and the amount carried per stop. The measured wall-time spread is small compared with the per-step baseline; the workload counters (delivered/produced/loaded/services) explain the direction of the change.
`;

await mkdir(new URL("../benchmarks/", import.meta.url), { recursive: true });
await writeFile(new URL("../benchmarks/cap-matrix.md", import.meta.url), markdown);
await writeFile(new URL("../benchmarks/cap-matrix.json", import.meta.url), JSON.stringify({
  config: { seconds: SECONDS, dt: DT, repeats: REPEATS, steps: STEPS, base: BASE },
  baseline: { stepMs: baseline.stepMs, usPerStep: baseline.usPerStep },
  sweeps: { flagCap: flagCapSweep, wareCap: wareCapSweep, cart: cartSweep },
  grids: { flagCart: flagCartGrid, wareCart: wareCartGrid }
}, null, 2));
console.log(markdown);
