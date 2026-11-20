import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS, generateWorld, type WorldOptions } from "../src/shared/world/generation/generate-world";
import { createShapeFields } from "../src/shared/world/generation/heights";
import { chooseLandform, createLandformLayout } from "../src/shared/world/generation/landforms";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll } from "./helpers/cached-worlds";

/** The gates of tests/mountain-landforms.test.ts, applied to the option world. */
const MAX_RISE_OVER_TWO_CELLS = 3.2;
const RIVER_MARGIN = 5;
const CLIFF_MASK_LIMIT = 0.05;

/** River free, so the coast comparison is not blurred by river mouths traced on different valleys. */
const PLAIN: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, cellsX: 256, cellsZ: 256, rivers: 0, seed: 1234 };
const ERODED: WorldOptions = { ...PLAIN, fluvialErosion: 1 };
const ISLANDS: WorldOptions = { ...ERODED, landform: "archipelago", mountains: .35, rivers: 2 };

const hashHeights = (world: WorldData) =>
  createHash("sha1").update(Buffer.from(world.heights.buffer, world.heights.byteOffset, world.heights.byteLength))
    .digest("hex").slice(0, 16);

const getSteepestRise = (options: WorldOptions, world: WorldData) => {
  const grid = { cellsX: options.cellsX, cellsZ: options.cellsZ };
  const layout = createLandformLayout(options.seed, options.landform ?? chooseLandform(options.seed));
  const { cliffMask } = createShapeFields(grid, options.seed, layout, options.mountains);
  const stride = grid.cellsX + 1;
  const isNatural = (index: number) =>
    cliffMask[index]! <= CLIFF_MASK_LIMIT && world.riverDistance[index]! >= RIVER_MARGIN;
  let steepest = 0;
  for (let z = 0; z <= grid.cellsZ - 2; z += 1) for (let x = 0; x <= grid.cellsX - 2; x += 1) {
    const index = z * stride + x;
    for (const other of [index + 2, index + 2 * stride]) {
      if (!isNatural(index) || !isNatural(other)) continue;
      steepest = Math.max(steepest, Math.abs(world.heights[other]! - world.heights[index]!));
    }
  }
  return steepest;
};

describe("fluvialErosion option (M03 pilot)", () => {
  const fresh = freshWorldBeforeAll(ERODED);

  it("carves the massifs and keeps the coastline and the start plateau usable", () => {
    const plain = cachedWorld(PLAIN), eroded = cachedWorld(ERODED);
    let lowered = 0, coastMoved = 0, sea = 0;
    for (let index = 0; index < plain.heights.length; index++) {
      if (plain.heights[index]! > 3 && eroded.heights[index]! < plain.heights[index]! - .5) lowered++;
      if (plain.heights[index]! <= 0) sea++;
      if ((plain.heights[index]! <= 0) !== (eroded.heights[index]! <= 0)) coastMoved++;
    }
    expect(lowered).toBeGreaterThan(500);
    // The carving never touches the sea or the lowland base, so the coastline stays where it was.
    expect(coastMoved / sea).toBeLessThan(.002);
    expect(eroded.start).toEqual(expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }));
    const stride = eroded.cellsX;
    for (let z = Math.floor(eroded.start.z) - 2; z <= Math.floor(eroded.start.z) + 2; z++)
      for (let x = Math.floor(eroded.start.x) - 2; x <= Math.floor(eroded.start.x) + 2; x++)
        expect(eroded.buildCap[z * stride + x]).toBe(BUILD.large);
  });

  it("keeps the natural slope gate of the mountain landforms", () => {
    expect(getSteepestRise(ERODED, cachedWorld(ERODED))).toBeLessThanOrEqual(MAX_RISE_OVER_TWO_CELLS);
  });

  it("is deterministic: a fresh generation hashes like the cached one", () => {
    expect(hashHeights(fresh())).toBe(hashHeights(cachedWorld(ERODED)));
    expect(hashHeights(cachedWorld(PLAIN))).not.toBe(hashHeights(cachedWorld(ERODED)));
  });

  it("keeps the reserved plots, HQ and harbour of playable islands", () => {
    const world = generateWorld(ISLANDS);
    expect(world.generatedRivers!.length).toBeGreaterThanOrEqual(1);
    for (const site of world.playableIslands!.sites) {
      expect(site.buildingCount).toBe(4);
      expect(site.harbour).toBeDefined();
      for (let z = site.z - 10; z < site.z + 10; z++) for (let x = site.x - 10; x < site.x + 10; x++)
        expect(world.buildCap[z * world.cellsX + x]).toBe(BUILD.large);
    }
    expect(world.generationProvenance?.options.fluvialErosion).toBe(1);
  });
});
