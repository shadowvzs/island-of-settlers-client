import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GENERATED_RIVER_LIMIT } from "../src/shared/world/editing/generated-river-types";
import {
  getIslandRadiusRoom,
  ISLAND_SPACE,
  type IslandSite,
  planPlayableIslands,
  reservedIslandGround
} from "../src/shared/world/generation/archipelago-rules";
import { generateAdventureWorld, generateColonyWorld } from "../src/shared/world/generation/colony-world";
import {
  DEFAULT_WORLD_OPTIONS,
  RIVER_AREA_EXPONENT,
  shapeTerrain,
  type WorldOptions
} from "../src/shared/world/generation/generate-world";
import { growIslandsForRivers, UPLAND_ISLAND_RADIUS } from "../src/shared/world/generation/island-uplands";
import { RADIUS_GROWTH, SOURCE_RADIUS } from "../src/shared/world/generation/river-carving";
import { LEDGE_DROP } from "../src/shared/world/generation/river-falls";
import { MOUTH_LENGTH, SAMPLE_SPACING } from "../src/shared/world/generation/river-line";
import { createUniformLayout } from "../src/shared/world/generation/theme-field";
import { scaleCount } from "../src/shared/world/generation/world-scale";
import type { GridSize } from "../src/shared/world/grid-geometry";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/** Owner decision DEC-06 (2026-10-19): Islands maps that request rivers grow uplands. */
const islandOptions = (size: number, seed: number, rivers: number, islandCount?: number): WorldOptions => ({
  ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, islandCount, landform: "archipelago", mountains: .35, rivers,
  seed
});

/** The whole-map river total the option asks for (generator form: Few 0.01, Normal 2). */
const getRequestedRivers = (size: number, rivers: number) =>
  Math.min(GENERATED_RIVER_LIMIT, scaleCount({ cellsX: size, cellsZ: size }, rivers, RIVER_AREA_EXPONENT));

const shapeIslands = (options: WorldOptions) => {
  const grid = { cellsX: options.cellsX, cellsZ: options.cellsZ };
  return shapeTerrain(grid, options.seed, options, createUniformLayout(options.theme));
};

/** Every coast envelope keeps its full ship channel to the others and its sea margin to the map edge. */
const expectChannelsKept = (size: number, sites: readonly IslandSite[]) => {
  const grid = { cellsX: size, cellsZ: size };
  sites.forEach((site, index) => {
    expect(getIslandRadiusRoom(grid, sites, index)).toBeGreaterThanOrEqual(site.radius);
    for (const other of sites.slice(index + 1)) {
      const distance = Math.hypot(other.x - site.x, other.z - site.z);
      expect(distance).toBeGreaterThanOrEqual(site.radius + other.radius + ISLAND_SPACE.channelWidth);
    }
  });
};

const getLandMedian = (heights: Float32Array) => {
  const land = heights.filter((height) => height > 0).sort();
  return land[Math.floor(land.length / 2)]!;
};

/** Cells around a spring searched for the upland it drains. */
const SPRING_PEAK_REACH = 8;

const getHighestAround = (grid: GridSize, heights: Float32Array, point: { x: number; z: number }, reach: number) => {
  let highest = -Infinity;
  for (let z = Math.round(point.z) - reach; z <= Math.round(point.z) + reach; z++) {
    for (let x = Math.round(point.x) - reach; x <= Math.round(point.x) + reach; x++)
      highest = Math.max(highest, heights[z * (grid.cellsX + 1) + x] ?? -Infinity);
  }
  return highest;
};

const hashWorld = (world: WorldData | null) => {
  const hash = createHash("sha1");
  if (!world) return "none";
  for (const layer of [world.heights, world.waterDepth, world.buildCap, world.blocking, world.props.types])
    hash.update(Buffer.from(layer.buffer, layer.byteOffset, layer.byteLength));
  hash.update(JSON.stringify(world.playableIslands ?? null));
  return hash.digest("hex").slice(0, 16);
};

// Sizes and seeds stay within the docs/contracts/playable-islands.md counts (one island on 128 maps).
const RIVER_CASES = [[128, 7], [128, 1234], [256, 1234], [256, 42], [512, 1234]] as const;

describe("Islands uplands for requested rivers", () => {
  it.each(RIVER_CASES)("%i map seed %i: rivers flow from the uplands to the sea", (size, seed) => {
    const options = islandOptions(size, seed, 2);
    const grid = { cellsX: size, cellsZ: size };
    const shape = shapeTerrain(grid, seed, options, createUniformLayout(options.theme));
    const { courses } = shape.rivers;
    const median = getLandMedian(shape.heights);
    expect(courses.length).toBeGreaterThanOrEqual(1);
    for (const river of courses) {
      // The spring lies above the plain, below an upland peak.
      expect(river.profile[0]!).toBeGreaterThan(median);
      expect(getHighestAround(grid, shape.heights, river.points[0]!, SPRING_PEAK_REACH)).toBeGreaterThan(median + 1);
      for (const point of river.points)
        expect(shape.islandSites!.some((site) => reservedIslandGround(site, point.x, point.z))).toBe(false);
      const estuary = river.mouthStep - Math.round(MOUTH_LENGTH / SAMPLE_SPACING);
      for (let step = 0; step < estuary; step++)
        expect(river.radius[step]!).toBeLessThanOrEqual(SOURCE_RADIUS + RADIUS_GROWTH);
    }
    for (const fall of shape.rivers.waterfalls) expect(fall.top - fall.bottom).toBeGreaterThanOrEqual(LEDGE_DROP);
  }, 30_000);

  it.each([[128, 7, .01], [256, 1234, 2]] as const)(
    "%i map seed %i (rivers %f): keeps the reserved plots, HQ and harbour usable",
    (size, seed, rivers) => {
      const world = cachedWorld(islandOptions(size, seed, rivers));
      expect(world.generatedRivers!.length).toBeGreaterThanOrEqual(1);
      for (const site of world.playableIslands!.sites) {
        expect(site.buildingCount).toBe(4);
        expect(site.harbour).toBeDefined();
        for (let z = site.z - 10; z < site.z + 10; z++) for (let x = site.x - 10; x < site.x + 10; x++)
          expect(world.buildCap[z * size + x]).toBe(BUILD.large);
      }
    }, 30_000);

  it("keeps deterministic dry-island/colony/adventure baselines with current starter plot estimates", () => {
    // v6 corrects starter forest clearings to catalog HQ/house plots and the full road reservation.
    // Pre-v6 aggregate hashes (including vegetation): df7e885c8b0e047a / 1f81ca45f910ddc4 / 776918ba616e605b.
    // The home stone/coal/iron guarantee (home-resources.ts) comes after this baseline.
    expect(hashWorld(cachedWorld({ ...islandOptions(192, 42, 0), homeResources: false }))).toBe("aaa34b1084f7b663");
    expect(hashWorld(generateColonyWorld({ ore: "coal", seed: 99, theme: "forest" }))).toBe("16925f7e2d8b9884");
    expect(hashWorld(generateAdventureWorld({ seed: 5, size: 128, theme: "swamp" }))).toBe("50f2ace0ae33c5d1");
  }, 30_000);

  // Size, seed, island count (undefined: the size table), rivers option, rivers placed (DEC-06 follow-up).
  // v8 natural coast: at 192/99 one of the four requested courses no longer reaches the sea (3).
  it.each([
    [128, 7, undefined, 2, 2], [192, 99, undefined, 2, 3], [192, 99, undefined, .01, 1],
    [256, 42, undefined, 2, 6], [256, 42, 2, 2, 4], [256, 7, 4, .01, 1], [512, 1234, undefined, 2, 16],
    [512, 42, 12, .01, 1]
  ] as const)("%i map seed %i (%s islands, rivers %f): %i rivers in total for the whole map",
    (size, seed, islandCount, rivers, placed) => {
      const shape = shapeIslands(islandOptions(size, seed, rivers, islandCount));
      const requested = getRequestedRivers(size, rivers);
      expect(shape.rivers.courses.length).toBeLessThanOrEqual(requested);
      expect(shape.rivers.courses.length).toBe(placed);
    }, 60_000);

  it("enlarges a small island in place for a missing river, keeping every channel and neighbour", () => {
    const options = islandOptions(192, 99, 2, 4);
    const grid = { cellsX: 192, cellsZ: 192 };
    const planned = planPlayableIslands(grid, options.seed, false, 4);
    const world = cachedWorld(options);
    const sites = world.playableIslands!.sites;
    expect(world.seed).toBe(options.seed);
    const grown = sites.filter((site, index) => site.radius !== planned[index]!.radius);
    expect(grown).toHaveLength(1);
    expect(grown[0]!.radius).toBeGreaterThanOrEqual(UPLAND_ISLAND_RADIUS);
    sites.forEach((site, index) => {
      expect([site.x, site.z]).toEqual([planned[index]!.x, planned[index]!.z]);
      expect(site.radius).toBeGreaterThanOrEqual(planned[index]!.radius);
    });
    expectChannelsKept(192, sites);
    expect(world.generatedRivers!.length).toBeGreaterThan(0);
    expect(world.generatedRivers!.length).toBeLessThanOrEqual(getRequestedRivers(192, 2));
  }, 30_000);

  it("leaves islands without room for uplands as planned (no merging, no river)", () => {
    const options = islandOptions(192, 1234, 2, 3);
    const grid = { cellsX: 192, cellsZ: 192 };
    const planned = planPlayableIslands(grid, options.seed, false, 3);
    expect(growIslandsForRivers(grid, planned, getRequestedRivers(192, 2))).toBeUndefined();
    const shape = shapeIslands(options);
    expect(shape.islandSites).toEqual(planned);
    expect(shape.rivers.courses).toHaveLength(0);
  }, 30_000);

  it("grows only as many small islands as the missing rivers need, the largest first", () => {
    const grid = { cellsX: 512, cellsZ: 512 };
    const site = { buildingCount: 4, phase: 0, spaceDepth: 20, spaceWidth: 20 };
    const sites: IslandSite[] = [
      { ...site, radius: 60, x: 120, z: 120 }, { ...site, radius: 34, x: 380, z: 120 },
      { ...site, radius: 36, x: 120, z: 380 }, { ...site, radius: 30, x: 380, z: 380 }
    ];
    expect(growIslandsForRivers(grid, sites, 0)).toBeUndefined();
    const grown = growIslandsForRivers(grid, sites, 1)!;
    expect(grown.map((island) => island.radius)).toEqual([60, 34, UPLAND_ISLAND_RADIUS, 30]);
    const more = growIslandsForRivers(grid, sites, 3)!;
    expect(more.map((island) => island.radius)).toEqual([60, 34, UPLAND_ISLAND_RADIUS + 4, 30]);
    expectChannelsKept(512, more);
    expect(sites[2]!.radius).toBe(36);
  });
});
