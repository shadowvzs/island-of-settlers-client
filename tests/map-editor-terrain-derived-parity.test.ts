import { describe, expect, it } from "vitest";

import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import {
  applyStampChanges,
  refreshEditedVertexLayers
} from "../src/shared/world/editing/terrain/terrain-apply";
import {
  addStamp,
  createTerrainEditState,
  raiseStampAt,
  removeStampsNear
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createHeightLevels } from "../src/shared/world/generation/heights";
import { computeNormals } from "../src/shared/world/lighting";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const SIZES = [256, 512] as const;
const OPTIONS = (size: number) =>
  ({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, erosionDroplets: 8000, seed: 123 });
const worldOf = (size: number) => cachedWorld(OPTIONS(size));

preloadWorlds(...SIZES.map(OPTIONS));

/** First byte where two views differ (exact Float32 / Uint8 parity), or -1. */
const firstDifference = (actual: ArrayBufferView, expected: ArrayBufferView) => {
  const first = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
  const second = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
  if (first.length !== second.length) return 0;
  for (let index = 0; index < first.length; index += 1)
    if (first[index] !== second[index]) return index;
  return -1;
};

/** The bounded edit derivations equal the full-map derivations byte for byte. */
const expectDerivedParity = (world: WorldData, context: string) => {
  const normals = firstDifference(world.normals, computeNormals(world, world.heights));
  expect(normals, `${context}: normals differ at byte ${normals}`).toBe(-1);
  const levels = firstDifference(world.heightLevels, createHeightLevels(world.heights));
  expect(levels, `${context}: height levels differ at byte ${levels}`).toBe(-1);
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

describe("bounded terrain derivations", () => {
  for (const size of SIZES) {
    it(`match full normals and height levels at map and chunk edges on ${size}²`, () => {
      const world = worldOf(size);
      expect(world.cellsX).toBe(size);
      const baseHeights = world.heights.slice();
      const baseNormals = computeNormals(world, baseHeights);
      const baseLevels = createHeightLevels(baseHeights);
      const regions = [
        { maxX: 0, maxZ: 0, minX: 0, minZ: 0 },
        { maxX: 4, maxZ: 4, minX: 0, minZ: 0 },
        { maxX: size - 1, maxZ: size - 1, minX: size - 5, minZ: size - 5 },
        { maxX: 34, maxZ: 50, minX: 31, minZ: 47 },
        { maxX: size - 1, maxZ: 38, minX: 0, minZ: 35 }
      ];
      for (const [index, cells] of regions.entries()) {
        world.heights.set(baseHeights);
        world.normals.set(baseNormals);
        world.heightLevels.set(baseLevels);
        const stride = world.cellsX + 1;
        for (let z = cells.minZ; z <= cells.maxZ + 1; z += 1) {
          for (let x = cells.minX; x <= cells.maxX + 1; x += 1) {
            const vertex = z * stride + x;
            world.heights[vertex] = world.heights[vertex]! + (index % 2 === 0 ? 1.37 : -2.05);
          }
        }
        refreshEditedVertexLayers(world, cells);
        expectDerivedParity(world, `${size}² region ${index}`);
      }
    }, 30_000);
  }
});

describe("bounded derivations through terrain edits", () => {
  for (const size of SIZES) {
    it(`match full derivations through stamp growth, undo/redo and removal on ${size}²`, () => {
      const world = worldOf(size), state = createTerrainEditState(), spot = findEditSpot(world);
      let ground: ReturnType<typeof applyStampChanges>["ground"] | null = null;
      for (let level = 1; level <= 5; level += 1) {
        const applied = raiseTo(level, spot)(world, state, ground);
        ground = applied.ground;
        expectDerivedParity(world, `${size}² mountain level ${level}`);
      }

      const snapshot = createWorldSnapshot(world, state);
      snapshot.capture();
      const raised = raiseTo(6, spot)(world, state, ground);
      ground = raised.ground;
      expectDerivedParity(world, `${size}² undo capture`);
      const diff = snapshot.diff();
      expect(diff).not.toBeNull();
      applyWorldDiff(world, state, diff!, "before");
      expectDerivedParity(world, `${size}² undo`);
      applyWorldDiff(world, state, diff!, "after");
      expectDerivedParity(world, `${size}² redo`);

      const removed = removeAll(24, spot)(world, state, ground);
      expect(state.stamps).toHaveLength(0);
      expectDerivedParity(world, `${size}² removal (cells ${JSON.stringify(removed.cells)})`);
      expect(world.terrainRevision).toBeGreaterThan(0);
    }, 60_000);

    it(`match full derivations through lake growth and removal on ${size}²`, () => {
      const world = worldOf(size), state = createTerrainEditState(), spot = findEditSpot(world);
      let ground: ReturnType<typeof applyStampChanges>["ground"] | null = null;
      for (let level = 1; level <= 4; level += 1) {
        const applied = raiseTo(level, spot, "lake")(world, state, ground);
        ground = applied.ground;
        expect(applied.waterChanged).toBe(true);
        expectDerivedParity(world, `${size}² lake level ${level}`);
      }
      removeAll(24, spot)(world, state, ground);
      expect(state.stamps).toHaveLength(0);
      expectDerivedParity(world, `${size}² lake removal`);
    }, 60_000);
  }
});
