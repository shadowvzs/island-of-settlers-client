import { describe, expect, it } from "vitest";

import { getMinZoom } from "../src/render-common/camera-state";
import {
  DEFAULT_WORLD_OPTIONS,
  type WorldOptions
} from "../src/shared/world/generation/generate-world";
import {
  chooseLandform,
  createLandformLayout,
  type Landform,
  LANDFORMS} from "../src/shared/world/generation/landforms";
import { findMainLand } from "../src/shared/world/generation/plateaus";
import { getLinearScale, scaleCount } from "../src/shared/world/generation/world-scale";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

const REFERENCE: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128 };
const SEEDS = [1234, 7, 42, 2024];

const getLandShare = (world: WorldData) =>
  world.waterDepth.filter((depth) => depth === 0).length / world.waterDepth.length;

/** Share of dry vertices along one map border. */
const getBorderLand = (world: WorldData, side: "x0" | "x1" | "z0" | "z1") => {
  const stride = world.cellsX + 1;
  let land = 0;
  for (let step = 0; step <= world.cellsX; step += 1) {
    const x = { x0: 0, x1: world.cellsX, z0: step, z1: step }[side];
    const z = { x0: step, x1: step, z0: 0, z1: world.cellsZ }[side];
    if (world.waterDepth[z * stride + x] === 0) land += 1;
  }
  return land / stride;
};

const countLandmasses = (world: WorldData) => {
  const mainLand = findMainLand(world, world.heights);
  const main = mainLand.reduce((sum, value) => sum + value, 0);
  const land = world.heights.filter((height) => height > 0).length;
  return { main, rest: land - main };
};

const generate = (landform: Landform, seed: number) =>
  cachedWorld({ ...REFERENCE, ...(landform === "archipelago" ? { cellsX: 192, cellsZ: 192 } : {}), landform, seed });

describe("world scale", () => {
  it("keeps the reference counts on 128 x 128 and scales them with the area", () => {
    const reference = { cellsX: 128, cellsZ: 128 };
    const big = { cellsX: 256, cellsZ: 256 };
    expect(getLinearScale(big)).toBe(2);
    expect(scaleCount(reference, 3)).toBe(3);
    expect(scaleCount(big, 3)).toBe(12);
    expect(scaleCount(big, 2, 0.8)).toBe(6);
  });

  it("lets a bigger map zoom out further, down to a floor", () => {
    expect(getMinZoom(128, 128)).toBeCloseTo(0.2);
    expect(getMinZoom(96, 96)).toBeCloseTo(0.2);
    expect(getMinZoom(256, 256)).toBeCloseTo(0.1);
    expect(getMinZoom(512, 512)).toBeCloseTo(0.05);
  });
});

describe("landform selection", () => {
  it("is deterministic per seed, the default seed is one island", () => {
    expect(chooseLandform(DEFAULT_WORLD_OPTIONS.seed)).toBe("island");
    for (let seed = 0; seed < 50; seed += 1) {
      expect(chooseLandform(seed)).toBe(chooseLandform(seed));
    }
  });

  it("picks every landform for some seeds", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, seed) => chooseLandform(seed)));
    expect([...seen].sort()).toEqual([...LANDFORMS].sort());
  });

  it("opens a peninsula only on a far border (x = 0 or z = 0)", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(["x0", "z0"]).toContain(createLandformLayout(seed, "peninsula").openSide);
      expect(createLandformLayout(seed, "island").openSide).toBeNull();
    }
  });
});

describe.each(SEEDS)("landforms of seed %i", (seed) => {
  it("island: one landmass in the middle, sea on every border", () => {
    const world = generate("island", seed);
    expect(getLandShare(world)).toBeGreaterThan(0.38);
    expect(getLandShare(world)).toBeLessThan(0.65);
    for (const side of ["x0", "x1", "z0", "z1"] as const)
      expect(getBorderLand(world, side)).toBe(0);
  });

  it("archipelago: separated playable islands, sea on every border", () => {
    const world = generate("archipelago", seed);
    const { main, rest } = countLandmasses(world);
    expect(getLandShare(world)).toBeGreaterThan(0.1);
    expect(getLandShare(world)).toBeLessThan(0.5);
    expect(rest).toBeGreaterThan(main * 0.05);
    for (const side of ["x0", "x1", "z0", "z1"] as const)
      expect(getBorderLand(world, side)).toBe(0);
  });

  it("peninsula: land runs off the open border, sea on the others", () => {
    const world = generate("peninsula", seed);
    const open = createLandformLayout(seed, "peninsula").openSide!;
    expect(getLandShare(world)).toBeGreaterThan(0.3);
    expect(getLandShare(world)).toBeLessThan(0.6);
    // the open border is land up to the corners, where the closed borders bring the sea back
    expect(getBorderLand(world, open)).toBeGreaterThan(0.9);
    expect(getBorderLand(world, "x1")).toBe(0);
    expect(getBorderLand(world, "z1")).toBe(0);
  });

  it.each(LANDFORMS)("%s: the start is on the main land with dry ground around it", (landform) => {
    const world = generate(landform, seed);
    const mainLand = findMainLand(world, world.heights);
    const stride = world.cellsX + 1;
    const { x, z } = world.start;
    if (landform !== "archipelago") expect(mainLand[z * stride + x]).toBe(1);
    else expect(world.playableIslands!.sites.some(site => site.headquarters.x === x && site.headquarters.z === z)).toBe(true);
    expect(world.buildClass[z * world.cellsX + x]).toBeGreaterThanOrEqual(BUILD.small);
    for (let dz = -5; dz <= 5; dz += 1) {
      for (let dx = -5; dx <= 5; dx += 1) {
        expect(world.waterDepth[(z + dz) * stride + x + dx]).toBe(0);
      }
    }
  });
});

describe("the 256 x 256 default world", () => {
  const options = { ...DEFAULT_WORLD_OPTIONS, landform: "peninsula" as const, seed: 99 };
  const freshWorld = freshWorldBeforeAll(options);
  preloadWorlds(options);
  it("is deterministic for a forced landform", () => {
    const first = freshWorld();
    const second = cachedWorld(options);
    expect(first.cellsX).toBe(256);
    expect(second.heights).toEqual(first.heights);
    expect(second.props.x).toEqual(first.props.x);
    expect(second.fog).toEqual(first.fog);
  });
});
