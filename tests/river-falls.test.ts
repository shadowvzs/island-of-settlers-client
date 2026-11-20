import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORLD_OPTIONS,
  shapeTerrain,
  type WorldOptions
} from "../src/shared/world/generation/generate-world";
import type { Landform } from "../src/shared/world/generation/landforms";
import type { CarvedRiver } from "../src/shared/world/generation/river-carving";
import { isLedgeFall, LEDGE_DROP } from "../src/shared/world/generation/river-falls";
import { SAMPLE_SPACING } from "../src/shared/world/generation/river-line";
import { createUniformLayout } from "../src/shared/world/generation/theme-field";
import { type GridSize,sampleBilinear } from "../src/shared/world/grid-geometry";
import type { Waterfall } from "../src/shared/world/world-data";
import { cachedWorldBeforeAll } from "./helpers/cached-worlds";

const LANDFORMS: Landform[] = ["island", "archipelago", "peninsula"];
const SEEDS = [1234, 7];
/** Level fall over a short stretch (cells) that must contain a waterfall. */
const DROP_STRETCH = 3;
const DROP_LIMIT = 1.5;
/** Plunge pools hold at least this much water in the middle. */
const MIN_POOL_DEPTH = 0.4;

const shapeWorld = (landform: Landform, seed: number) => {
  const options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, landform, seed };
  const grid: GridSize = { cellsX: options.cellsX, cellsZ: options.cellsZ };
  const shape = shapeTerrain(grid, seed, options, createUniformLayout(options.theme));
  return { grid, heights: shape.heights, rivers: shape.rivers, water: shape.water };
};

const WORLDS = LANDFORMS.flatMap((landform) =>
  SEEDS.map((seed) => ({ landform, seed, world: shapeWorld(landform, seed) }))
);

const getLandMedian = (heights: Float32Array) => {
  const land = heights.filter((height) => height > 0).sort();
  return land[Math.floor(land.length / 2)]!;
};

const isNearFall = (waterfalls: Waterfall[], x: number, z: number, reach: number) =>
  waterfalls.some((fall) => Math.hypot(fall.x - x, fall.z - z) <= reach);

/** Steps where the level falls more than DROP_LIMIT within DROP_STRETCH cells. */
const findSteepDrops = (river: CarvedRiver) => {
  const span = Math.round(DROP_STRETCH / SAMPLE_SPACING);
  const steps: number[] = [];
  for (let step = 0; step + span < river.profile.length; step += 1) {
    if (river.profile[step]! - river.profile[step + span]! > DROP_LIMIT) steps.push(step);
  }
  return steps;
};

describe("river sources and falls", () => {
  const getIsland = cachedWorldBeforeAll({
    ...DEFAULT_WORLD_OPTIONS,
    landform: "island",
    seed: 7
  });

  it.each(WORLDS)("$landform $seed: sources lie in the uplands", ({ world }) => {
    const median = getLandMedian(world.heights);
    for (const river of world.rivers.courses) {
      expect(river.profile[0]!).toBeGreaterThan(median);
    }
  });

  it.each(WORLDS)("$landform $seed: no river climbs", ({ world }) => {
    for (const river of world.rivers.courses) {
      for (let step = 1; step < river.profile.length; step += 1) {
        expect(river.profile[step]!).toBeLessThanOrEqual(river.profile[step - 1]!);
      }
    }
  });

  it.each(WORLDS)("$landform $seed: steep drops are waterfalls", ({ world }) => {
    const { waterfalls } = world.rivers;
    // Playable Islands without upland relief grow no springs (river-sources.ts), so no falls.
    if (world.rivers.courses.length > 0) expect(waterfalls.length).toBeGreaterThan(0);
    for (const fall of waterfalls) {
      expect(fall.top - fall.bottom).toBeGreaterThanOrEqual(LEDGE_DROP);
      expect(fall.width).toBeGreaterThan(0);
    }
    for (const river of world.rivers.courses) {
      for (const step of findSteepDrops(river)) {
        const point = river.points[step]!;
        expect(isNearFall(waterfalls, point.x, point.z, DROP_STRETCH + 1)).toBe(true);
      }
    }
  });

  it.each(WORLDS)("$landform $seed: a plunge pool lies below every fall", ({ world }) => {
    for (const fall of world.rivers.waterfalls) {
      const { waterDepth, waterSurface } = world.water;
      const depth = sampleBilinear(world.grid, waterDepth, fall.poolX, fall.poolZ);
      expect(depth).toBeGreaterThan(MIN_POOL_DEPTH);
      expect(sampleBilinear(world.grid, waterSurface, fall.poolX, fall.poolZ)).toBeLessThan(
        fall.bottom + 0.05
      );
      expect(fall.poolRadius).toBeGreaterThan(fall.width / 2);
    }
  });

  it("steps the cascades of the generated rivers into ledges", () => {
    const ledges = WORLDS.flatMap(({ world }) => world.rivers.waterfalls.filter(isLedgeFall));
    expect(ledges.length).toBeGreaterThan(WORLDS.length * 3);
  });

  it("exposes the falls, the river distance and the wet rock to the renderers", () => {
    const world = getIsland();
    expect(world.waterfalls.length).toBeGreaterThan(0);
    for (const fall of world.waterfalls) {
      expect(sampleBilinear(world, world.wetRock, fall.x, fall.z)).toBeGreaterThan(200);
      expect(sampleBilinear(world, world.riverDistance, fall.poolX, fall.poolZ)).toBeLessThan(1);
    }
    const dryLand = world.wetRock.filter((wet, index) => wet === 0 && world.heights[index]! > 0);
    expect(dryLand.length).toBeGreaterThan(world.wetRock.length * 0.3);
  });
});
