import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS, generateWorld, type WorldOptions } from "../src/shared/world/generation/generate-world";
import { BLOCKING, BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll } from "./helpers/cached-worlds";

/** The game's home island relief, without and with tall cliff bands. */
const PLAIN: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, fluvialErosion: 1, rivers: 0, seed: 1234, terrainVariation: 1 };
const BANDS: WorldOptions = { ...PLAIN, cliffBands: 1 };
const ISLANDS: WorldOptions = { ...BANDS, landform: "archipelago", mountains: .35, rivers: 2 };

const buildable = (value: number) => value >= BUILD.small && value <= BUILD.large;

/** Buildable cells the HQ cannot walk to (4-connected flood fill over free cells). */
const countUnreachableBuildable = (world: WorldData) => {
  const reached = new Uint8Array(world.blocking.length);
  const queue = [Math.floor(world.start.z) * world.cellsX + Math.floor(world.start.x)];
  reached[queue[0]!] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!, x = cell % world.cellsX;
    for (const next of [x > 0 ? cell - 1 : -1, x < world.cellsX - 1 ? cell + 1 : -1, cell - world.cellsX,
      cell + world.cellsX]) {
      if (next < 0 || next >= reached.length || reached[next] || world.blocking[next] !== BLOCKING.free) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return world.buildClass.reduce((sum, value, index) => sum + (buildable(value) && !reached[index] ? 1 : 0), 0);
};

/** Lowland cells (below the massifs) whose corners rise at least 2.2: a band wall spans about two cells. */
const countTallWalls = (world: WorldData) => {
  const stride = world.cellsX + 1;
  let walls = 0;
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const corners = [z * stride + x, z * stride + x + 1, (z + 1) * stride + x, (z + 1) * stride + x + 1]
      .map(index => world.heights[index]!);
    if (Math.max(...corners) - Math.min(...corners) >= 2.2 && Math.max(...corners) < 9) walls++;
  }
  return walls;
};

describe("cliffBands option (MC-07)", () => {
  const fresh = freshWorldBeforeAll(BANDS);

  it("adds tall walls on the terraced lowland", () => {
    expect(countTallWalls(cachedWorld(BANDS))).toBeGreaterThan(countTallWalls(cachedWorld(PLAIN)) + 80);
  });

  it("keeps the building land reachable from the HQ and most of it buildable", () => {
    const plain = cachedWorld(PLAIN), bands = cachedWorld(BANDS);
    expect(countUnreachableBuildable(bands)).toBeLessThanOrEqual(countUnreachableBuildable(plain) + 40);
    const share = (world: WorldData) => world.buildClass.reduce((sum, value) => sum + (buildable(value) ? 1 : 0), 0);
    expect(share(bands)).toBeGreaterThanOrEqual(share(plain) * 0.95);
    for (let z = Math.floor(bands.start.z) - 2; z <= Math.floor(bands.start.z) + 2; z++)
      for (let x = Math.floor(bands.start.x) - 2; x <= Math.floor(bands.start.x) + 2; x++)
        expect(bands.buildCap[z * bands.cellsX + x]).toBe(BUILD.large);
  });

  it("is deterministic and recorded in the provenance", () => {
    expect(Array.from(fresh().heights)).toEqual(Array.from(cachedWorld(BANDS).heights));
    expect(cachedWorld(BANDS).generationProvenance?.options.cliffBands).toBe(1);
  });

  it("keeps the reserved plots, HQ and harbour of playable islands", () => {
    const world = generateWorld(ISLANDS);
    for (const site of world.playableIslands!.sites) {
      expect(site.buildingCount).toBe(4);
      expect(site.harbour).toBeDefined();
    }
  });
});
