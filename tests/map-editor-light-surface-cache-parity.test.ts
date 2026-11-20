import { describe, expect, it } from "vitest";

import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { applyStampChanges } from "../src/shared/world/editing/terrain/terrain-apply";
import {
  addStamp,
  createTerrainEditState,
  raiseStampAt,
  removeStampsNear
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { toVertexBounds } from "../src/shared/world/editing/terrain/terrain-vertices";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { bakeTerrainLight, rebakeTerrainLight } from "../src/shared/world/lighting";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const SIZES = [256, 512] as const;
const OPTIONS = (size: number) =>
  ({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, erosionDroplets: 8000, seed: 123 });
const worldOf = (size: number) => cachedWorld(OPTIONS(size));

preloadWorlds(...SIZES.map(OPTIONS));

/** First byte where two views differ (exact Uint8 parity), or -1. */
const firstDifference = (actual: ArrayBufferView, expected: ArrayBufferView) => {
  const first = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const second = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
  if (first.length !== second.length) return 0;
  for (let index = 0; index < first.length; index += 1)
    if (first[index] !== second[index]) return index;
  return -1;
};

/** The cached-surface bake equals the full-map light derivation byte for byte. */
const expectLightParity = (world: WorldData, context: string) => {
  const full = bakeTerrainLight(world, world.heights, world.waterSurface, world.sun);
  const shadow = firstDifference(world.sunShadow, full.sunShadow);
  expect(shadow, `${context}: sun shadow differs at byte ${shadow}`).toBe(-1);
  const ao = firstDifference(world.ambientOcclusion, full.ambientOcclusion);
  expect(ao, `${context}: ambient occlusion differs at byte ${ao}`).toBe(-1);
};

/** Highest dry ground of a cell region's vertices (the shadow it cast before a change). */
const highestIn = (world: WorldData, cells: ReturnType<typeof toVertexBounds>) => {
  let highest = -Infinity;
  const stride = world.cellsX + 1;
  for (let z = cells.minZ; z <= cells.maxZ; z += 1)
    for (let x = cells.minX; x <= cells.maxX; x += 1)
      highest = Math.max(highest, world.heights[z * stride + x]!);
  return highest;
};

const findEditSpot = (world: WorldData) => {
  for (let z = 20; z < world.cellsZ - 20; z += 1) {
    for (let x = 20; x < world.cellsX - 20; x += 1) {
      const vertex = z * (world.cellsX + 1) + x;
      if (world.buildClass[z * world.cellsX + x] === BUILD.large &&
        world.coastDistance[vertex]! > 14 && world.riverDistance[vertex]! > 18)
        return { x: x + 0.5, z: z + 0.5 };
    }
  }
  throw new Error("no dry inland edit spot");
};

type Edit = (world: WorldData, state: ReturnType<typeof createTerrainEditState>,
  ground: Parameters<typeof applyStampChanges>[3]) =>
  ReturnType<typeof applyStampChanges>;

const raiseTo = (level: number, spot: { x: number; z: number }, kind?: "lake"): Edit =>
  (world, state, ground) => {
    const change = state.stamps.length === 0
      ? addStamp(state, spot, 1, 51, { kind })
      : raiseStampAt(state, spot.x, spot.z, 51, kind);
    return applyStampChanges(world, state, [change], ground);
  };

const removeAll = (radius: number, spot: { x: number; z: number }): Edit =>
  (world, state, ground) =>
    applyStampChanges(world, state, removeStampsNear(state, spot.x, spot.z, radius), ground);

describe("cached light surface at chunk and map edges", () => {
  for (const size of SIZES) {
    it(`matches the full bake after sequential edge edits on ${size}²`, () => {
      const world = worldOf(size);
      expect(world.cellsX).toBe(size);
      const stride = world.cellsX + 1;
      const regions = [
        { maxX: 0, maxZ: 0, minX: 0, minZ: 0 },
        { maxX: 4, maxZ: 4, minX: 0, minZ: 0 },
        { maxX: size - 1, maxZ: size - 1, minX: size - 5, minZ: size - 5 },
        { maxX: 34, maxZ: 50, minX: 31, minZ: 47 },
        { maxX: size - 1, maxZ: 2, minX: 0, minZ: 0 }
      ];
      for (const [index, cells] of regions.entries()) {
        const highestBefore = highestIn(world, toVertexBounds(cells));
        for (let z = cells.minZ; z <= cells.maxZ + 1; z += 1) {
          for (let x = cells.minX; x <= cells.maxX + 1; x += 1) {
            const vertex = z * stride + x;
            world.heights[vertex] = world.heights[vertex]! + (index % 2 === 0 ? 1.37 : -2.05);
            // Every other region raises the water too: the surface is max(terrain, water).
            if (index % 2 === 0)
              world.waterSurface[vertex] = Math.max(
                world.waterSurface[vertex]!,
                world.heights[vertex]! + 0.75
              );
          }
        }
        rebakeTerrainLight(
          world,
          world.heights,
          world.waterSurface,
          world.sun,
          toVertexBounds(cells),
          world,
          highestBefore
        );
        expectLightParity(world, `${size}² region ${index}`);
      }
    }, 60_000);
  }
});

describe("cached light surface through terrain edits", () => {
  for (const size of SIZES) {
    it(`matches the full bake through stamp growth, undo/redo and removal on ${size}²`, () => {
      const world = worldOf(size), state = createTerrainEditState(), spot = findEditSpot(world);
      let ground: ReturnType<typeof applyStampChanges>["ground"] | null = null;
      for (let level = 1; level <= 3; level += 1) {
        const applied = raiseTo(level, spot)(world, state, ground);
        ground = applied.ground;
        expectLightParity(world, `${size}² mountain level ${level}`);
      }

      const snapshot = createWorldSnapshot(world, state);
      snapshot.capture();
      const raised = raiseTo(4, spot)(world, state, ground);
      ground = raised.ground;
      expectLightParity(world, `${size}² undo capture`);
      const diff = snapshot.diff();
      expect(diff).not.toBeNull();
      applyWorldDiff(world, state, diff!, "before");
      expectLightParity(world, `${size}² undo`);
      applyWorldDiff(world, state, diff!, "after");
      expectLightParity(world, `${size}² redo`);

      // The undo cleared the cache; a further stamp rebuilds it from the restored terrain.
      const afterRedo = raiseTo(5, spot)(world, state, ground);
      ground = afterRedo.ground;
      expectLightParity(world, `${size}² after redo`);

      const removed = removeAll(24, spot)(world, state, ground);
      expect(state.stamps).toHaveLength(0);
      expectLightParity(world, `${size}² removal (cells ${JSON.stringify(removed.cells)})`);
    }, 120_000);

    it(`matches the full bake through lake growth and removal on ${size}²`, () => {
      const world = worldOf(size), state = createTerrainEditState(), spot = findEditSpot(world);
      let ground: ReturnType<typeof applyStampChanges>["ground"] | null = null;
      for (let level = 1; level <= 3; level += 1) {
        const applied = raiseTo(level, spot, "lake")(world, state, ground);
        ground = applied.ground;
        expect(applied.waterChanged).toBe(true);
        expectLightParity(world, `${size}² lake level ${level}`);
      }
      removeAll(24, spot)(world, state, ground);
      expect(state.stamps).toHaveLength(0);
      expectLightParity(world, `${size}² lake removal`);
    }, 120_000);
  }
});
