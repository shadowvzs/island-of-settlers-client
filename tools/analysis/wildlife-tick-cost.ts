import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

import { createAnimalManager } from "../../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../../src/render-common/wildlife/nav/island-nav";
import { countAnimals, loadIsland, median, savedAnimals } from "./wildlife-measure-helpers";

/**
 * Wildlife CPU per settlement tick and save bytes with the real manager (Wildlife 2.0, S10): only
 * touched regions simulate their animals, whatever the camera (D2). Node numbers. Scenarios:
 * `quiet` (no activity: every region dormant), `hunters` (four hunters' scans around the island
 * centre every 10 s), `awake` (every region touched every 10 s: all animals simulated).
 * Usage: npx tsx tools/analysis/wildlife-tick-cost.ts <save.json | colony:N | fresh:save | dense:SIZE:SPACING>...
 *   [--ticks 2000] [--warmup TICKS]
 */
/** Saved populations are live at once; a new one settles its failed placements (3 s retries). */
const SAVED_WARMUP_TICKS = 100;
const NEW_WARMUP_TICKS = 1200;
/** A hunter's prey scan radius (resourceWorkRadius("wildlife")) and the scan cadence. */
const HUNTER_RANGE = 36;
const SCAN_TICKS = 200;
const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : undefined;
};
const TICKS = flagValue("--ticks") ?? 2000;
const WARMUP = flagValue("--warmup");
const sources = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));

type Manager = ReturnType<typeof createAnimalManager>;
type Touch = (animals: Manager, size: { x: number; z: number }) => void;

const SCENARIOS: Record<string, Touch> = {
  quiet: () => undefined,
  hunters: (animals, size) => {
    for (const [dx, dz] of [[-20, -20], [20, -20], [-20, 20], [20, 20]] as const)
      animals.listHuntTargets("wildlife", { x: size.x / 2 + dx, z: size.z / 2 + dz }, HUNTER_RANGE);
  },
  awake: (animals, size) => {
    animals.listHuntTargets("wildlife", { x: size.x / 2, z: size.z / 2 }, Math.hypot(size.x, size.z));
  }
};

const saveBytes = (animals: Manager) => {
  const json = JSON.stringify(animals.saveState());
  return { gzip: gzipSync(json, { level: 6 }).length, json: json.length };
};

const measure = (animals: Manager, touch: Touch, size: { x: number; z: number }) => {
  const samples: number[] = [];
  let simulated = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    if (tick % SCAN_TICKS === 0) touch(animals, size);
    const started = performance.now();
    animals.step();
    samples.push(performance.now() - started);
    simulated = Math.max(simulated, countAnimals(animals.debug.pool).total!);
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const p99 = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * .99)]!;
  return { msPerTick: { mean: +mean.toFixed(4), median: +median(samples).toFixed(4), p99: +p99.toFixed(3) },
    regions: animals.countSimulatedRegions(), save: saveBytes(animals), simulatedPeak: simulated };
};

for (const source of sources) {
  const island = await loadIsland(source);
  const saved = savedAnimals(island);
  const navStarted = performance.now();
  const nav = createIslandNav(island.world, []);
  const navMs = Math.round(performance.now() - navStarted);
  const size = { x: island.world.cellsX, z: island.world.cellsZ };
  for (const [name, touch] of Object.entries(SCENARIOS)) {
    const created = performance.now();
    const animals = createAnimalManager(island.world, nav, saved ? structuredClone(saved) : undefined);
    animals.step();
    const startMs = +(performance.now() - created).toFixed(1);
    const warmup = WARMUP ?? (saved ? SAVED_WARMUP_TICKS : NEW_WARMUP_TICKS);
    for (let tick = 0; tick < warmup; tick++) animals.step();
    const result = measure(animals, touch, size);
    console.log(JSON.stringify({ alive: animals.countAlive(), homeRegions: animals.countHomeRegions(),
      island: island.label, navMs, scenario: name, startMs, ...result }));
  }
}
