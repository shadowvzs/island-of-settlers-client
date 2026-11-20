import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORLD_OPTIONS,
  shapeTerrain,
  type WorldOptions
} from "../src/shared/world/generation/generate-world";
import type { Landform } from "../src/shared/world/generation/landforms";
import {
  type CarvedRiver,
  MAX_BEND_WIDENING,
  RADIUS_GROWTH,
  SOURCE_RADIUS} from "../src/shared/world/generation/river-carving";
import { getCurvatures, MOUTH_LENGTH, SAMPLE_SPACING } from "../src/shared/world/generation/river-line";
import { applyMeanders } from "../src/shared/world/generation/river-meanders";
import { createUniformLayout } from "../src/shared/world/generation/theme-field";
import { floodSea } from "../src/shared/world/generation/water";
import { type GridSize,sampleBilinear } from "../src/shared/world/grid-geometry";
import { createRandom } from "../src/shared/world/rng";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorldBeforeAll } from "./helpers/cached-worlds";

const LANDFORMS: Landform[] = ["island", "archipelago", "peninsula"];
const SEEDS = [1234, 7];
/** Bend curvature limit (1 / cells) over 2 cells each side: heading change below about 65°. */
const MAX_CURVATURE = 0.55;
/** Gameplay width: most of the course is at most this wide (cells of water). */
const MAX_TYPICAL_WIDTH = 6.5;
/** Chord half length (cells) for the meander amplitude. */
const CHORD_REACH = 10;
const WIDTH_PROBE_STEP = 0.25;
const SEA_LEVEL = 0;

interface ShapedWorld {
  grid: GridSize;
  heights: Float32Array;
  rivers: CarvedRiver[];
  waterDepth: Float32Array;
}

const shapeWorld = (landform: Landform, seed: number): ShapedWorld => {
  const options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, landform, seed };
  const grid = { cellsX: options.cellsX, cellsZ: options.cellsZ };
  const shape = shapeTerrain(grid, seed, options, createUniformLayout(options.theme));
  return {
    grid,
    heights: shape.heights,
    rivers: shape.rivers.courses,
    waterDepth: shape.water.waterDepth
  };
};

const WORLDS = LANDFORMS.flatMap((landform) =>
  SEEDS.map((seed) => ({ landform, seed, world: shapeWorld(landform, seed) }))
);

const getVertex = (grid: GridSize, x: number, z: number) =>
  Math.round(z) * (grid.cellsX + 1) + Math.round(x);

/** Water across the course at a sample (cells), probing both sides of the centreline. */
const getWaterWidth = (world: ShapedWorld, river: CarvedRiver, step: number) => {
  const { points } = river;
  const before = points[Math.max(0, step - 2)]!;
  const after = points[Math.min(points.length - 1, step + 2)]!;
  const length = Math.hypot(after.x - before.x, after.z - before.z);
  const normalX = -(after.z - before.z) / length;
  const normalZ = (after.x - before.x) / length;
  const point = points[step]!;
  let width = 0;
  for (const side of [1, -1]) {
    for (let along = 0; along < 20; along += WIDTH_PROBE_STEP) {
      const x = point.x + normalX * along * side;
      const z = point.z + normalZ * along * side;
      if (sampleBilinear(world.grid, world.waterDepth, x, z) <= 0) break;
      width += WIDTH_PROBE_STEP;
    }
  }
  return width;
};

/** Every vertex of the water body around a start vertex (4-connected). */
const floodWater = (world: ShapedWorld, start: number) => {
  const stride = world.grid.cellsX + 1;
  const reached = new Uint8Array(world.waterDepth.length);
  const stack = [start];
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (reached[index] || !(world.waterDepth[index]! > 0)) continue;
    reached[index] = 1;
    const x = index % stride;
    if (x > 0) stack.push(index - 1);
    if (x < world.grid.cellsX) stack.push(index + 1);
    if (index >= stride) stack.push(index - stride);
    if (index + stride < world.waterDepth.length) stack.push(index + stride);
  }
  return reached;
};

/** Mean distance of the centreline from the chord across ±CHORD_REACH cells, per course third. */
const getMeanderByThird = (river: Pick<CarvedRiver, "points" | "mouthStep">) => {
  const reach = CHORD_REACH / SAMPLE_SPACING;
  const { mouthStep, points } = river;
  const thirds = new Float64Array(3);
  const counts = new Float64Array(3);
  for (let step = reach; step < mouthStep - reach; step += 1) {
    const from = points[step - reach]!;
    const to = points[step + reach]!;
    const point = points[step]!;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const cross = (to.x - from.x) * (point.z - from.z) - (to.z - from.z) * (point.x - from.x);
    const third = Math.min(2, Math.floor((step / mouthStep) * 3));
    thirds[third] = thirds[third]! + Math.abs(cross / length);
    counts[third] = counts[third]! + 1;
  }
  return Array.from(thirds, (sum, index) => sum / Math.max(1, counts[index]!));
};

const getEstuaryStart = (river: CarvedRiver) =>
  river.mouthStep - Math.round(MOUTH_LENGTH / SAMPLE_SPACING);

describe("river mouths", () => {
  const getIsland = cachedWorldBeforeAll({
    ...DEFAULT_WORLD_OPTIONS,
    landform: "island",
    seed: 7
  });

  it.each(WORLDS)("$landform $seed: every river opens into the sea", ({ world }) => {
    // Islands requesting rivers grow uplands (DEC-06), so every landform has springs.
    expect(world.rivers.length).toBeGreaterThan(0);
    const sea = floodSea(world.grid, world.heights, SEA_LEVEL);
    for (const river of world.rivers) {
      const last = river.points[river.points.length - 1]!;
      expect(sea[getVertex(world.grid, last.x, last.z)]).toBe(1);
      // no sand bar: the channel holds water from the estuary out to the sea
      for (let step = getEstuaryStart(river); step < river.points.length; step += 1) {
        const point = river.points[step]!;
        expect(sampleBilinear(world.grid, world.waterDepth, point.x, point.z)).toBeGreaterThan(0);
      }
      const estuary = river.points[getEstuaryStart(river)]!;
      const water = floodWater(world, getVertex(world.grid, estuary.x, estuary.z));
      expect(water.some((reached, index) => reached === 1 && sea[index] === 1)).toBe(true);
    }
  });

  it.each(WORLDS)(
    "$landform $seed: the mouth is at least as wide as the river bed",
    ({ world }) => {
      for (const river of world.rivers) {
        const riverWidth = river.radius[getEstuaryStart(river)]! * 2;
        expect(getWaterWidth(world, river, river.mouthStep)).toBeGreaterThanOrEqual(riverWidth);
      }
    }
  );

  it("keeps reeds, sedges and dune grass out of the mouths", () => {
    const shaped = WORLDS.find((entry) => entry.landform === "island" && entry.seed === 7)!;
    const plants: number[] = [PROP.reeds, PROP.cattail, PROP.sedge];
    const { props } = getIsland();
    for (const river of shaped.world.rivers) {
      const mouth = river.points[river.mouthStep]!;
      for (let index = 0; index < props.count; index += 1) {
        if (!plants.includes(props.types[index]!)) continue;
        const distance = Math.hypot(props.x[index]! - mouth.x, props.z[index]! - mouth.z);
        expect(distance).toBeGreaterThan(river.radius[river.mouthStep]!);
      }
    }
  });
});

describe("river course", () => {
  it.each(WORLDS)("$landform $seed: no sharp corners", ({ world }) => {
    for (const river of world.rivers) {
      const curvatures = getCurvatures(river.points, 2 / SAMPLE_SPACING);
      for (let step = 4; step < river.mouthStep - 4; step += 1) {
        expect(Math.abs(curvatures[step]!)).toBeLessThan(MAX_CURVATURE);
      }
    }
  });

  it.each(WORLDS)("$landform $seed: the width stays at gameplay scale", ({ world }) => {
    const maxRadius = SOURCE_RADIUS + RADIUS_GROWTH;
    for (const river of world.rivers) {
      const widths: number[] = [];
      for (let step = 0; step < getEstuaryStart(river); step += 1) {
        const radius = river.radius[step]!;
        expect(radius).toBeGreaterThanOrEqual(SOURCE_RADIUS * 0.5);
        expect(radius).toBeLessThanOrEqual(maxRadius);
        if (step % 4 === 0) widths.push(getWaterWidth(world, river, step));
      }
      widths.sort((a, b) => a - b);
      expect(widths[Math.floor(widths.length * 0.75)]!).toBeLessThanOrEqual(MAX_TYPICAL_WIDTH);
      expect(maxRadius * 2 * (1 + MAX_BEND_WIDENING)).toBeLessThan(MAX_TYPICAL_WIDTH);
    }
  });

  it("lowland meander offsets grow downstream independently of mountain-directed turns", () => {
    // Real headwaters may turn sharply around a massif. Measuring their total chord deviation
    // mixes the base route with the added meanders, so isolate the latter on a straight lowland.
    const grid = { cellsX: 256, cellsZ: 64 };
    const heights = new Float32Array((grid.cellsX + 1) * (grid.cellsZ + 1)).fill(0.8);
    const base = Array.from({ length: 401 }, (_, step) => ({
      x: 20 + step * SAMPLE_SPACING,
      z: 32
    }));
    const totals = new Float64Array(3);
    for (const seed of [1234, 7, 42, 9001, 19, 73]) {
      const points = applyMeanders(grid, base, { heights, room: () => 8 }, createRandom(seed));
      getMeanderByThird({ points, mouthStep: points.length - 1 }).forEach(
        (mean, third) => (totals[third] = totals[third]! + mean)
      );
    }
    const [upper, middle, lower] = Array.from(totals);
    expect(lower!).toBeGreaterThan(upper! * 1.2);
    expect(middle!).toBeGreaterThan(upper!);
  });

  it("bends are irregular: uneven spacing, not a symmetric rhythm", () => {
    const halfBends: number[] = [];
    for (const { world } of WORLDS) {
      for (const river of world.rivers) {
        const curvatures = getCurvatures(river.points, 4 / SAMPLE_SPACING);
        let sign = 0;
        let start = -1;
        for (let step = Math.floor(river.mouthStep / 2); step < river.mouthStep; step += 1) {
          const curvature = curvatures[step]!;
          if (Math.abs(curvature) < 0.04 || Math.sign(curvature) === sign) continue;
          if (start >= 0) halfBends.push((step - start) * SAMPLE_SPACING);
          sign = Math.sign(curvature);
          start = step;
        }
      }
    }
    const mean = halfBends.reduce((sum, length) => sum + length, 0) / halfBends.length;
    const variance =
      halfBends.reduce((sum, length) => sum + (length - mean) ** 2, 0) / halfBends.length;
    expect(halfBends.length).toBeGreaterThan(20);
    expect(Math.sqrt(variance) / mean).toBeGreaterThan(0.3);
  });
});
