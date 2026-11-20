import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORLD_OPTIONS,
  shapeTerrain,
  type WorldOptions
} from "../src/shared/world/generation/generate-world";
import { createShapeFields } from "../src/shared/world/generation/heights";
import { chooseLandform, createLandformLayout } from "../src/shared/world/generation/landforms";
import { createMassifShape } from "../src/shared/world/generation/mountain-ridges";
import { createUniformLayout } from "../src/shared/world/generation/theme-field";
import type { GridSize } from "../src/shared/world/grid-geometry";
import { createRandom } from "../src/shared/world/rng";
import { cachedWorld } from "./helpers/cached-worlds";

const SLOW = 60_000;
/** Largest rise over two cells outside the cliff mask and away from river gorges and falls. */
const MAX_RISE_OVER_TWO_CELLS = 3.2;
/** Gorges and falls are carved cliffs: river beds and their banks are left out of the check. */
const RIVER_MARGIN = 5;
const CLIFF_MASK_LIMIT = 0.05;

const WORLDS: Partial<WorldOptions>[] = [
  { cellsX: 256, cellsZ: 256, seed: 1234 },
  { cellsX: 256, cellsZ: 256, mountains: 2, seed: 7 },
  { cellsX: 128, cellsZ: 128, landform: "archipelago", seed: 42 },
  { cellsX: 128, cellsZ: 128, landform: "peninsula", seed: 42 },
  { cellsX: 64, cellsZ: 64, mountains: 2, seed: 5 }
];

const toOptions = (world: Partial<WorldOptions>): WorldOptions => ({
  ...DEFAULT_WORLD_OPTIONS,
  ...world
});

const getGrid = (options: WorldOptions): GridSize => ({
  cellsX: options.cellsX,
  cellsZ: options.cellsZ
});

const shapeWorld = (options: WorldOptions) =>
  shapeTerrain(getGrid(options), options.seed, options, createUniformLayout(options.theme));

/** Largest rise between vertices two cells apart (along x or z) where natural slopes apply. */
const getSteepestRise = (options: WorldOptions) => {
  const world = cachedWorld(options);
  const grid = getGrid(options);
  const layout = createLandformLayout(
    options.seed,
    options.landform ?? chooseLandform(options.seed)
  );
  const { cliffMask } = createShapeFields(grid, options.seed, layout, options.mountains);
  const stride = grid.cellsX + 1;
  const isNatural = (index: number) =>
    cliffMask[index]! <= CLIFF_MASK_LIMIT && world.riverDistance[index]! >= RIVER_MARGIN;
  let steepest = 0;
  for (let z = 0; z <= grid.cellsZ - 2; z += 1) {
    for (let x = 0; x <= grid.cellsX - 2; x += 1) {
      const index = z * stride + x;
      for (const other of [index + 2, index + 2 * stride]) {
        if (!isNatural(index) || !isNatural(other)) continue;
        steepest = Math.max(steepest, Math.abs(world.heights[other]! - world.heights[index]!));
      }
    }
  }
  return steepest;
};

const findHighest = (heights: Float32Array) =>
  heights.reduce((best, height, index) => (height > heights[best]! ? index : best), 0);

/** Farthest distance (cells) from the summit within the ground above `fraction` of its height. */
const getSummitReach = (grid: GridSize, heights: Float32Array, fraction: number) => {
  const stride = grid.cellsX + 1;
  const summit = findHighest(heights);
  const limit = heights[summit]! * fraction;
  const seen = new Uint8Array(heights.length);
  const stack = [summit];
  seen[summit] = 1;
  let reach = 0;
  while (stack.length > 0) {
    const index = stack.pop()!;
    const dx = (index % stride) - (summit % stride);
    const dz = Math.floor(index / stride) - Math.floor(summit / stride);
    reach = Math.max(reach, Math.hypot(dx, dz));
    for (const other of [index + 1, index - 1, index + stride, index - stride]) {
      if (other < 0 || other >= heights.length || seen[other] || heights[other]! < limit) continue;
      seen[other] = 1;
      stack.push(other);
    }
  }
  return reach;
};

/** Highest ground within `radius` cells and the mean ground on the ring at `ring` cells. */
const sampleAround = (grid: GridSize, heights: Float32Array, x: number, z: number) => {
  const stride = grid.cellsX + 1;
  const read = (angle: number, radius: number) =>
    heights[
      Math.round(z + Math.sin(angle) * radius) * stride + Math.round(x + Math.cos(angle) * radius)
    ]!;
  let highest = -Infinity;
  let ring = 0;
  for (let step = 0; step < 16; step += 1) {
    const angle = (step / 16) * Math.PI * 2;
    ring += read(angle, 4) / 16;
    for (let radius = 1; radius <= 8; radius += 1) highest = Math.max(highest, read(angle, radius));
  }
  return { highest, ring };
};

describe("natural mountain landforms", () => {
  it.each(WORLDS.map(toOptions))(
    "no spikes: $cellsX² seed $seed $landform rises at most 3.2 over two cells",
    (options) => {
      expect(getSteepestRise(options)).toBeLessThanOrEqual(MAX_RISE_OVER_TWO_CELLS);
    },
    SLOW
  );

  // Playable Islands (docs/contracts/playable-islands.md) flatten each island's reserved centre clearing,
  // so a crest and mountain springs are no longer guaranteed there; the cliff-free check covers it.
  const NATURAL_RELIEF = WORLDS.slice(0, 3).filter(world => world.landform !== "archipelago");
  it.each(NATURAL_RELIEF.map(toOptions))(
    "ridges: the highest summit continues as a crest ($cellsX² seed $seed)",
    (options) => {
      const { heights } = shapeWorld(options);
      expect(heights[findHighest(heights)]!).toBeGreaterThan(9);
      expect(getSummitReach(getGrid(options), heights, 0.5)).toBeGreaterThan(17);
    },
    SLOW
  );

  it.each(NATURAL_RELIEF.map(toOptions))(
    "springs sit in valleys below the peaks ($cellsX² seed $seed)",
    (options) => {
      const { heights, rivers } = shapeWorld(options);
      expect(rivers.courses.length).toBeGreaterThan(0);
      for (const course of rivers.courses) {
        const spring = course.points[0]!;
        const ground = heights[Math.round(spring.z) * (options.cellsX + 1) + Math.round(spring.x)]!;
        const around = sampleAround(getGrid(options), heights, spring.x, spring.z);
        expect(around.highest - ground).toBeGreaterThan(1.5);
        expect(around.ring).toBeGreaterThan(ground);
      }
    },
    SLOW
  );
});

describe("massif anatomy", () => {
  const seed = { axis: 0.4, height: 12, inland: 2, size: 1, x: 100, z: 100 };
  const shapes = [1, 2, 3, 4, 5].map((value) => createMassifShape(seed, 9, createRandom(value)));

  it("has a main crest with peaks and lower saddles between them", () => {
    for (const { ridges } of shapes) {
      const crest = ridges[0]!.crest;
      const peaks = crest.filter(
        (height, index) => height >= (crest[index - 1] ?? 0) && height >= (crest[index + 1] ?? 0)
      );
      expect(peaks.length).toBeGreaterThanOrEqual(2);
      const highest = Math.max(...crest);
      const middle = crest.slice(Math.round(crest.length * 0.2), Math.round(crest.length * 0.8));
      expect(Math.min(...middle)).toBeGreaterThan(highest * 0.4);
      expect(Math.min(...middle)).toBeLessThan(highest * 0.95);
    }
  });

  it("has a steep cliff side, a gentle back slope, spurs and cirques", () => {
    for (const { cirques, ridges } of shapes) {
      const [left, right] = ridges[0]!.slopes;
      expect(Math.max(left, right) / Math.min(left, right)).toBeGreaterThan(1.6);
      expect(ridges.length).toBeGreaterThanOrEqual(6);
      expect(cirques.length).toBeGreaterThanOrEqual(2);
      for (const cirque of cirques) expect(cirque.floor).toBeLessThan(cirque.rim * 0.6);
    }
  });
});
