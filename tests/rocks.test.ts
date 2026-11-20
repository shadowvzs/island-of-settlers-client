import { describe, expect, it } from "vitest";

import { createClearFog, getIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { createLabCliffTerrain } from "../src/render-common/rocks/lab-cliff";
import { buildRockMesh } from "../src/render-common/rocks/rock-mesh";
import { placeRocks } from "../src/render-common/rocks/rock-placement";
import { createRockLibrary, ROCK_FAMILIES } from "../src/render-common/rocks/rock-shapes";
import { createWorldRockTerrain } from "../src/render-common/rocks/rock-terrain";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createMountainHeights } from "../src/shared/world/generation/mountains";
import { createMountainField } from "../src/shared/world/rock-cover";
import { cachedWorld } from "./helpers/cached-worlds";

const library = createRockLibrary();

describe("rock shapes", () => {
  it("fill the unit box exactly for every family", () => {
    for (const family of ROCK_FAMILIES) {
      const { positions } = library[family]![0]!.high;
      for (let axis = 0; axis < 3; axis += 1) {
        const values = Array.from(positions).filter((_, index) => index % 3 === axis);
        expect(Math.min(...values)).toBeCloseTo(-0.5, 4);
        expect(Math.max(...values)).toBeCloseTo(0.5, 4);
      }
    }
  });
});

describe("cliff rocks", () => {
  const options = { erosion: 0.3, geology: "layered" as const, height: 5, seed: 38192 };
  const terrain = createLabCliffTerrain(options);
  const rocks = placeRocks(terrain, { geology: options.geology, seed: options.seed });

  it("are deterministic per seed and differ between seeds", () => {
    expect(placeRocks(terrain, { geology: "layered", seed: 38192 })).toEqual(rocks);
    expect(placeRocks(terrain, { geology: "layered", seed: 7 })).not.toEqual(rocks);
  });

  it("cover the face with slabs, a lip and rubble at the foot", () => {
    const roles = new Set(rocks.map((rock) => rock.role));
    expect(rocks.length).toBeGreaterThan(40);
    for (const role of [0, 2, 3]) expect(roles.has(role as 0 | 2 | 3)).toBe(true);
  });

  it("drop rubble and detail at the far LOD", () => {
    const near = buildRockMesh(rocks, library, terrain, { detail: "auto", skipRubble: false });
    const far = buildRockMesh(rocks, library, terrain, { detail: "low", skipRubble: true });
    expect(far.triangles).toBeLessThan(near.triangles * 0.5);
  });
});

describe("mountains", () => {
  it("grow tall ridged masses where the mask asks for them", () => {
    const grid = { cellsX: 96, cellsZ: 96 };
    const mask = new Float32Array(97 * 97);
    for (let z = 30; z < 70; z += 1) for (let x = 30; x < 70; x += 1) mask[z * 97 + x] = 1;
    const room = new Float32Array(97 * 97).fill(40);
    const heights = createMountainHeights(grid, 5, mask, room, { amount: 1, landShare: 0.5 });
    expect(Math.max(...heights)).toBeGreaterThan(7);
    expect(heights[0]).toBe(0);
  });
});

describe("mountain field", () => {
  it("reaches from a peak down to the foot of its faces, not beyond", () => {
    const grid = { cellsX: 8, cellsZ: 8 };
    const heights = new Float32Array(81).fill(1);
    heights[4 * 9 + 4] = 7;
    const field = createMountainField(grid, heights);
    expect(field[4 * 9 + 4]).toBe(1);
    expect(field[4 * 9 + 6]).toBe(1);
    expect(field[4 * 9 + 7]).toBe(0);
    expect(field[0]).toBe(0);
  });
});

it("keeps coastal plates supported when a face column crosses an uneven slope", () => {
  const world = cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 128,
    cellsZ: 128,
    mountains: 2,
    themeLayout: "regions"
  });
  const terrain = createWorldRockTerrain(world, createClearFog(world));
  const rocks = getIslandRocks(world);
  expect(rocks.length).toBeGreaterThan(10);
  // This real generated coast previously left a plate around y=5 over ground around y=1.
  for (const rock of rocks.filter(
    ({ centre }) => Math.hypot(centre[0] - 59.5, centre[2] - 10) < 0.7
  )) {
    const lower = rock.centre[1] - rock.axes.reduce((sum, axis) => sum + Math.abs(axis[1]), 0) / 2;
    expect(lower).toBeLessThan(terrain.height(rock.centre[0], rock.centre[2]) + 0.1);
  }
});
