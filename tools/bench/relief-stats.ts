import { performance } from "node:perf_hooks";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { DEFAULT_WORLD_OPTIONS, generateWorld, type WorldOptions } from "../../src/shared/world/generation/generate-world";
import { BUILD, SLOPE, type WorldData } from "../../src/shared/world/world-data";

/**
 * Relief probe (MC-01): one JSON line per seed with the peak height, vertex counts above 7/10/15/20,
 * the slope class histogram, the buildable cell share, the land sector count, the steepest cell rise
 * and the generation time. Run from `island-of-settlers-client/`:
 *   SEEDS=1234,42,7 SIZE=256 OPTIONS='{"fluvialErosion":1}' npx tsx tools/bench/relief-stats.ts
 * CHOICE=<query> starts from the island page's choice (e.g. CHOICE='fluvialErosion=1') instead of
 * DEFAULT_WORLD_OPTIONS; OPTIONS is merged on top either way.
 */
const seeds = (process.env.SEEDS ?? "1234,42,7").split(",").map(Number);
const size = Number(process.env.SIZE ?? 256);
const extra = JSON.parse(process.env.OPTIONS ?? "{}") as Partial<WorldOptions>;
const choiceQuery = process.env.CHOICE;
const HEIGHT_MARKS = [7, 10, 15, 20] as const;

const baseOptions = (): WorldOptions => {
  if (choiceQuery === undefined) return { ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size };
  const choice = readIslandChoice(new URLSearchParams(`size=${size}&${choiceQuery}`), DEFAULT_ISLAND_CHOICE);
  return { ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice) };
};

const steepestRise = (world: WorldData) => {
  const stride = world.cellsX + 1;
  let steepest = 0;
  for (let z = 0; z < world.cellsZ; z += 1) for (let x = 0; x < world.cellsX; x += 1) {
    const corners = [z * stride + x, z * stride + x + 1, (z + 1) * stride + x, (z + 1) * stride + x + 1]
      .map(index => world.heights[index]!);
    steepest = Math.max(steepest, Math.max(...corners) - Math.min(...corners));
  }
  return steepest;
};

const countLandSectors = (world: WorldData) => {
  const sectors = new Set<number>();
  world.sector.forEach((sector, index) => { if (world.waterDepth[index] === 0 && sector > 0) sectors.add(sector); });
  return sectors.size;
};

const describe = (world: WorldData, milliseconds: number) => {
  const slope = { flat: 0, gentle: 0, steep: 0, cliff: 0 };
  const names = Object.entries(SLOPE).map(([name]) => name as keyof typeof slope);
  world.slopeClass.forEach(value => { slope[names[value]!] += 1; });
  const buildable = world.buildClass.reduce((sum, value) => sum + (value >= BUILD.small && value <= BUILD.large ? 1 : 0), 0);
  const above = Object.fromEntries(HEIGHT_MARKS.map(mark =>
    [`above${mark}`, world.heights.reduce((sum, height) => sum + (height > mark ? 1 : 0), 0)]));
  return {
    seed: world.seed,
    maxHeight: Number(Math.max(...world.heights).toFixed(2)),
    ...above,
    slope,
    buildableShare: Number((buildable / world.buildClass.length).toFixed(4)),
    landSectors: countLandSectors(world),
    steepestRise: Number(steepestRise(world).toFixed(2)),
    milliseconds: Math.round(milliseconds)
  };
};

for (const seed of seeds) {
  const started = performance.now();
  const world = generateWorld({ ...baseOptions(), ...extra, seed });
  console.log(JSON.stringify(describe(world, performance.now() - started)));
}
