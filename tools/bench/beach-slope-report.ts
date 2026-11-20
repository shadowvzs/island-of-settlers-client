import { writeFileSync } from "node:fs";

import {
  DEFAULT_WORLD_OPTIONS,
  generateWorld
} from "../../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../../src/shared/world/grid-geometry";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../src/shared/world/world-data";

/**
 * Sea shore slope report of generated islands (no browser): for every sea waterline crossing on
 * a vertex edge, the slope of the smooth (rendered) ground at the waterline, split into sandy
 * beaches and other shores, plus how far inland the ground is dry (.05 above the water) and no
 * steeper than a Fisher's stance grade (.5 rise per cell).
 * Run: `npx tsx tools/bench/beach-slope-report.ts` (SEEDS=1234,123,7 OUT=report.json).
 */
const seeds = (process.env.SEEDS ?? "1234,123,7,42,99,2024,5,777").split(",").map(Number);
const STANCE_SLOPE = 0.5;
const FEET_ABOVE_WATER = 0.05;
const SLOPE_STEP = 0.1;
const BINS = [0, 10, 15, 20, 25, 30, 35, 40, 45, 90];
const INLAND_CELLS = 4;

interface ShoreSample {
  dryReach: number;
  waterlineDegrees: number;
  sand: boolean;
}

const toDegrees = (rise: number) => (Math.atan(rise) * 180) / Math.PI;

const isSeaVertex = (world: WorldData, index: number) =>
  world.heights[index]! < world.seaLevel && world.waterSurface[index] === world.seaLevel &&
  world.riverDistance[index]! > 3;

const getSandWeight = (world: WorldData, index: number) =>
  world.splat[index * MATERIAL_COUNT + MATERIAL.sand]! / 255;

/** Smooth (rendered) ground height `along` cells inland of a sea vertex, towards a land vertex. */
const createProfile = (world: WorldData, sea: number, land: number) => {
  const stride = world.cellsX + 1, offset = land - sea;
  const directionX = Math.abs(offset) === 1 ? offset : 0;
  const directionZ = directionX ? 0 : Math.sign(offset);
  const x = sea % stride, z = Math.floor(sea / stride);
  return (along: number) => sampleSmooth(world, world.heights, x + directionX * along, z + directionZ * along);
};

const getSlope = (profile: (along: number) => number, along: number) =>
  (profile(along + SLOPE_STEP) - profile(along - SLOPE_STEP)) / (2 * SLOPE_STEP);

/** Waterline (cells from the sea vertex) on the smooth surface, by bisection. */
const findWaterline = (profile: (along: number) => number, seaLevel: number) => {
  let low = 0, high = 1;
  for (let pass = 0; pass < 20; pass += 1) {
    const middle = (low + high) / 2;
    if (profile(middle) < seaLevel) low = middle;
    else high = middle;
  }
  return high;
};

/** Cells inland of the waterline to a dry point a Fisher may stand on (height, grade). */
const getDryReach = (profile: (along: number) => number, waterline: number, seaLevel: number) => {
  for (let along = waterline; along < waterline + INLAND_CELLS; along += 0.05) {
    const dry = profile(along) >= seaLevel + FEET_ABOVE_WATER;
    if (dry && Math.abs(getSlope(profile, along)) <= STANCE_SLOPE) return along - waterline;
  }
  return INLAND_CELLS;
};

const sampleCrossing = (world: WorldData, sea: number, land: number): ShoreSample => {
  const profile = createProfile(world, sea, land);
  const waterline = findWaterline(profile, world.seaLevel);
  return {
    dryReach: getDryReach(profile, waterline, world.seaLevel),
    waterlineDegrees: toDegrees(Math.abs(getSlope(profile, waterline))),
    sand: getSandWeight(world, land) >= 0.5
  };
};

const collectShore = (world: WorldData) => {
  const stride = world.cellsX + 1, samples: ShoreSample[] = [];
  for (let index = 0; index < world.heights.length; index += 1) {
    if (world.heights[index]! < world.seaLevel) continue;
    const x = index % stride, z = Math.floor(index / stride);
    if (x < 2 || z < 2 || x > world.cellsX - 2 || z > world.cellsZ - 2) continue;
    const neighbours = [-1, 1, -stride, stride];
    for (const offset of neighbours) {
      const sea = index + offset;
      if (!isSeaVertex(world, sea)) continue;
      samples.push(sampleCrossing(world, sea, index));
    }
  }
  return samples;
};

const histogram = (values: number[]) =>
  BINS.slice(0, -1).map((from, bin) => {
    const to = BINS[bin + 1]!;
    const share = values.filter(value => value >= from && value < to).length / (values.length || 1);
    return { bin: `${from}-${to}`, share: +share.toFixed(3) };
  });

const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return +(sorted[Math.floor(q * (sorted.length - 1))] ?? NaN).toFixed(2);
};

const summarise = (samples: ShoreSample[]) => {
  const degrees = samples.map(sample => sample.waterlineDegrees);
  const reach = samples.map(sample => sample.dryReach);
  return {
    count: samples.length,
    degrees: { median: quantile(degrees, 0.5), p25: quantile(degrees, 0.25), p75: quantile(degrees, 0.75) },
    dryReach: { median: quantile(reach, 0.5), p75: quantile(reach, 0.75), p90: quantile(reach, 0.9) },
    histogram: histogram(degrees)
  };
};

/** Buildable cells (any build class) within three cells of the sea: room for shore buildings. */
const countShoreBuildCells = (world: WorldData) => {
  let count = 0;
  for (let cell = 0; cell < world.buildClass.length; cell += 1) {
    const distance = world.coastDistance[cell]!;
    if (world.buildClass[cell]! > 0 && distance > 0 && distance <= 3) count += 1;
  }
  return count;
};

const pooled: ShoreSample[] = [];
const perSeed = seeds.map(seed => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, seed });
  const samples = collectShore(world);
  pooled.push(...samples);
  return {
    beach: summarise(samples.filter(sample => sample.sand)),
    other: summarise(samples.filter(sample => !sample.sand)),
    seed,
    shoreBuildCells: countShoreBuildCells(world)
  };
});
const all = {
  beach: summarise(pooled.filter(sample => sample.sand)),
  other: summarise(pooled.filter(sample => !sample.sand))
};
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ all, perSeed }, null, 2) + "\n");
for (const { beach, other, seed, shoreBuildCells } of perSeed) {
  console.log(`seed ${seed}: beach ${beach.count} median ${beach.degrees.median} deg, dry reach median ` +
    `${beach.dryReach.median} p90 ${beach.dryReach.p90}; other ${other.count} median ` +
    `${other.degrees.median} deg; shore build cells ${shoreBuildCells}`);
}
console.log("all beach", JSON.stringify(all.beach));
console.log("all other", JSON.stringify(all.other));
