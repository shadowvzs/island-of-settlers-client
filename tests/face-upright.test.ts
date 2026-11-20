import { describe, expect, it } from "vitest";

import { createFaceUpright, type VertexRegion } from "../src/render-common/rocks/face-upright";
import type { WorldData } from "../src/shared/world/world-data";

const SIZE = 48;

/**
 * A synthetic island: lowland at 1 for x < 20, a straight face rising `rise` over `run` cells,
 * a plateau behind it; far from water unless `water` is set.
 */
const createWorld = (rise: number, run: number, water = 32) => {
  const stride = SIZE + 1, heights = new Float32Array(stride * stride);
  for (let z = 0; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) {
    const t = Math.min(1, Math.max(0, (x - 20) / run));
    heights[z * stride + x] = 1 + rise * t;
  }
  const distance = new Float32Array(stride * stride).fill(water);
  return { cellsX: SIZE, cellsZ: SIZE, coastDistance: distance, heights, riverDistance: distance } as unknown as WorldData;
};

const WHOLE: VertexRegion = { maxX: SIZE, maxZ: SIZE, minX: 0, minZ: 0 };
const out = new Float32Array(2);

const shiftAt = (world: WorldData, x: number, z: number, region = WHOLE) => {
  createFaceUpright(world, region).shift(x, z, out);
  return [out[0]!, out[1]!] as const;
};

describe("upright rock faces (MC-02, render only)", () => {
  it("stands a tall steep face upright toward its lip", () => {
    const world = createWorld(4, 2);
    const upright = createFaceUpright(world, WHOLE);
    expect(upright.active).toBe(true);
    upright.shift(20, 24, out);
    const foot = 20 + out[0]!;
    upright.shift(22, 24, out);
    const lip = 22 + out[0]!;
    expect(lip - foot).toBeLessThan(0.8);
    expect(Math.abs(out[0]!)).toBeLessThan(0.3);
    expect(shiftAt(world, 30, 24)[0]).toBe(0);
    expect(shiftAt(world, 10, 24)[0]).toBe(0);
  });

  it("keeps the drawn surface monotonic across the face (no folds)", () => {
    const world = createWorld(6, 3);
    const upright = createFaceUpright(world, WHOLE);
    let previous = -Infinity;
    for (let x = 15; x <= 28; x += 0.5) {
      upright.shift(x, 24, out);
      expect(x + out[0]!).toBeGreaterThan(previous);
      previous = x + out[0]!;
    }
  });

  it("gives a vertex shared by two chunks the same shift", () => {
    const world = createWorld(5, 2);
    const left: VertexRegion = { maxX: 21, maxZ: 32, minX: 0, minZ: 0 };
    const right: VertexRegion = { maxX: 48, maxZ: 32, minX: 21, minZ: 0 };
    for (const z of [8, 16, 24]) expect(shiftAt(world, 21, z, left)).toEqual(shiftAt(world, 21, z, right));
  });

  it("leaves short banks, shores and river banks as they are", () => {
    expect(createFaceUpright(createWorld(1, 1), WHOLE).active).toBe(false);
    expect(createFaceUpright(createWorld(5, 2, 1), WHOLE).active).toBe(false);
  });

  it("turns the normal of a moved face toward the horizontal", () => {
    const world = createWorld(4, 2);
    const upright = createFaceUpright(world, WHOLE);
    const normal = Float32Array.of(-0.89, 0.45, 0);
    const ground = (x: number) => 1 + 4 * Math.min(1, Math.max(0, (x - 20) / 2));
    upright.bendNormal(21, 24, ground, normal, 0);
    expect(normal[1]).toBeLessThan(0.45);
    expect(Math.hypot(normal[0]!, normal[1]!, normal[2]!)).toBeCloseTo(1, 5);
  });
});

describe("upright faces keep bowls and crests solid", () => {
  /** A round bowl (floor 1, rim 6 at radius 8) inside a high plateau. */
  const createBowl = () => {
    const stride = SIZE + 1, heights = new Float32Array(stride * stride);
    for (let z = 0; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) {
      const distance = Math.hypot(x - 24, z - 24);
      heights[z * stride + x] = 1 + 5 * Math.min(1, Math.max(0, (distance - 4) / 4));
    }
    const far = new Float32Array(stride * stride).fill(32);
    return { cellsX: SIZE, cellsZ: SIZE, coastDistance: far, heights, riverDistance: far } as unknown as WorldData;
  };

  it("never stands the walls of a bowl upright (no arena)", () => {
    const upright = createFaceUpright(createBowl(), WHOLE);
    for (const [x, z] of [[30, 24], [24, 18], [19, 29]] as const) {
      upright.shift(x, z, out);
      expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(0.15);
    }
  });
});
