import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { getWaterlineFoot, LILY_FLOAT } from "../src/shared/world/generation/water-plants";
import { sampleBilinear, sampleSmooth } from "../src/shared/world/grid-geometry";
import {
  BLOCKING,
  BUILD,
  MATERIAL_COUNT,
  PROP,
  type WorldData
} from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

/**
 * Reeds and cattails may stand in the shallows (wading beds at the water line), sedges right at
 * the water line, lilies float.
 */
const WETLAND_EDGE = new Set<number>([PROP.reeds, PROP.cattail, PROP.sedge, PROP.waterLily]);

/** Foot heights a prop may have: the ground; wading plants the water line; lilies the surface. */
const getFootHeights = (world: WorldData, type: number, x: number, z: number) => {
  const ground = sampleSmooth(world, world.heights, x, z);
  const surface = sampleBilinear(world, world.waterSurface, x, z);
  if (type === PROP.waterLily) return [surface + LILY_FLOAT];
  if (type === PROP.reeds || type === PROP.cattail)
    return [ground, getWaterlineFoot(ground, surface)];
  return [ground];
};

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };

const hashArrays = (world: WorldData) => {
  let hash = 2166136261;
  const arrays = [
    world.heights,
    world.splat,
    world.props.x,
    world.props.types,
    world.buildClass,
    world.fog
  ];
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return hash;
};

describe("generateWorld", () => {
  const world = cachedWorld(SMALL);
  const freshWorld = freshWorldBeforeAll(SMALL);
  preloadWorlds({ ...SMALL, seed: SMALL.seed + 1 });

  it("is deterministic for a seed and changes with the seed", () => {
    expect(hashArrays(freshWorld())).toBe(hashArrays(world));
    expect(hashArrays(cachedWorld({ ...SMALL, seed: SMALL.seed + 1 }))).not.toBe(
      hashArrays(world)
    );
  });

  it("has an island: land in the middle, sea on the border", () => {
    const stride = world.cellsX + 1;
    const centre = Math.floor(world.cellsZ / 2) * stride + Math.floor(world.cellsX / 2);
    const land = world.waterDepth.filter((depth) => depth === 0).length / world.waterDepth.length;
    expect(world.waterDepth[0]).toBeGreaterThan(0);
    expect(world.heights[centre]).toBeGreaterThan(world.seaLevel);
    expect(land).toBeGreaterThan(0.3);
    expect(land).toBeLessThan(0.7);
  });

  it("stores normalised splat weights per vertex", () => {
    for (let vertex = 0; vertex < world.heights.length; vertex += 97) {
      let sum = 0;
      for (let material = 0; material < MATERIAL_COUNT; material += 1) {
        sum += world.splat[vertex * MATERIAL_COUNT + material]!;
      }
      expect(Math.abs(sum - 255)).toBeLessThanOrEqual(4);
    }
  });

  it("places props on dry ground at the surface height (water plants at the water line)", () => {
    const { props } = world;
    for (let index = 0; index < props.count; index += 1) {
      const x = props.x[index]!;
      const z = props.z[index]!;
      const feet = getFootHeights(world, props.types[index]!, x, z);
      expect(feet.some((foot) => Math.abs(foot - props.y[index]!) < 1e-3)).toBe(true);
      if (WETLAND_EDGE.has(props.types[index]!)) continue;
      const cell = Math.floor(z) * world.cellsX + Math.floor(x);
      expect(world.blocking[cell]).not.toBe(BLOCKING.water);
    }
  });

  it("never allows building on water or cliffs", () => {
    world.blocking.forEach((blocking, cell) => {
      if (blocking === BLOCKING.water || blocking === BLOCKING.cliff) {
        expect(world.buildClass[cell]).toBe(BUILD.none);
      }
    });
  });

  it("derives walkability from terrain and props", () => {
    world.blocking.forEach((blocking, cell) => {
      if (blocking === BLOCKING.water) expect(world.walkCost[cell]).toBe(0);
    });
    const start = Math.floor(world.start.z) * world.cellsX + Math.floor(world.start.x);
    expect(world.walkCost[start]).toBeGreaterThanOrEqual(10);
  });

  it("keeps the start on buildable land", () => {
    const cell = Math.floor(world.start.z) * world.cellsX + Math.floor(world.start.x);
    expect(world.buildClass[cell]).toBeGreaterThanOrEqual(BUILD.small);
  });
});
