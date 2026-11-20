import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS, generateWorld, type WorldOptions } from "../src/shared/world/generation/generate-world";
import { BLOCKING, BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll } from "./helpers/cached-worlds";

/** The game's default relief of a home island (eroded massifs), with and without the summit uplift. */
const ERODED: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, fluvialErosion: 1, rivers: 0, seed: 1234, terrainVariation: 1 };
const TALL: WorldOptions = { ...ERODED, peakUplift: 1 };
const ISLANDS: WorldOptions = { ...TALL, landform: "archipelago", mountains: .35, rivers: 2 };

const hashHeights = (world: WorldData) =>
  createHash("sha1").update(Buffer.from(world.heights.buffer, world.heights.byteOffset, world.heights.byteLength))
    .digest("hex").slice(0, 16);

const buildableShare = (world: WorldData) =>
  world.buildClass.reduce((sum, value) => sum + (value >= BUILD.small && value <= BUILD.large ? 1 : 0), 0) /
  world.buildClass.length;

/** Free cells reachable from the HQ over free cells (4-connected flood fill). */
const floodFromStart = (world: WorldData) => {
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
  return reached;
};

/** Buildable cells the HQ cannot walk to. */
const countUnreachableBuildable = (world: WorldData) => {
  const reached = floodFromStart(world);
  return world.buildClass.reduce((sum, value, index) =>
    sum + (value >= BUILD.small && value <= BUILD.large && !reached[index] ? 1 : 0), 0);
};

describe("peakUplift option (MC-04)", () => {
  const fresh = freshWorldBeforeAll(TALL);

  it("raises the summits well above today's massifs", () => {
    const plain = cachedWorld(ERODED), tall = cachedWorld(TALL);
    // terrain-seed-v10 rounds the needle tips into crowns (summit-crowns.ts): about 2 lower than 19.8.
    expect(Math.max(...tall.heights)).toBeGreaterThanOrEqual(17);
    expect(Math.max(...tall.heights)).toBeGreaterThan(Math.max(...plain.heights) * 1.4);
  });

  it("keeps the building land, its reach from the HQ and the start plateau", () => {
    const plain = cachedWorld(ERODED), tall = cachedWorld(TALL);
    expect(Math.abs(buildableShare(tall) - buildableShare(plain))).toBeLessThan(.01);
    expect(countUnreachableBuildable(tall)).toBeLessThanOrEqual(countUnreachableBuildable(plain) + 40);
    for (let z = Math.floor(tall.start.z) - 2; z <= Math.floor(tall.start.z) + 2; z++)
      for (let x = Math.floor(tall.start.x) - 2; x <= Math.floor(tall.start.x) + 2; x++)
        expect(tall.buildCap[z * tall.cellsX + x]).toBe(BUILD.large);
  });

  it("is deterministic and recorded in the provenance", () => {
    expect(hashHeights(fresh())).toBe(hashHeights(cachedWorld(TALL)));
    expect(hashHeights(cachedWorld(ERODED))).not.toBe(hashHeights(cachedWorld(TALL)));
    expect(cachedWorld(TALL).generationProvenance?.options.peakUplift).toBe(1);
  });

  it("keeps the reserved plots, HQ and harbour of playable islands", () => {
    const world = generateWorld(ISLANDS);
    for (const site of world.playableIslands!.sites) {
      expect(site.buildingCount).toBe(4);
      expect(site.harbour).toBeDefined();
      for (let z = site.z - 10; z < site.z + 10; z++) for (let x = site.x - 10; x < site.x + 10; x++)
        expect(world.buildCap[z * world.cellsX + x]).toBe(BUILD.large);
    }
  });
});
