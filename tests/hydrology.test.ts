import { expect, it } from "vitest";

import { createHydrology } from "../src/shared/world/generation/hydrology";

const SIZE = 33;
const grid = { cellsX: SIZE - 1, cellsZ: SIZE - 1 };
const index = (x: number, z: number) => z * SIZE + x;
const valley = () => {
  const heights = new Float32Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++)
    heights[index(x, z)] = z === 0 ? -1 : Math.abs(x - 16) * .2 + z * .03;
  return heights;
};

it("drains the valley downstream while ridges stay drier", () => {
  const heights = valley(), fields = createHydrology(grid, heights, 0);
  expect(fields.area[index(16, 2)]!).toBeGreaterThan(fields.area[index(16, 12)]!);
  expect(fields.wetness[index(16, 12)]!).toBeGreaterThan(fields.wetness[index(4, 12)]!);
});

it("is deterministic across repeated calls", () => {
  const heights = valley();
  const first = createHydrology(grid, heights, 0), second = createHydrology(grid, heights, 0);
  expect(Array.from(first.area)).toEqual(Array.from(second.area));
  expect(Array.from(first.filled)).toEqual(Array.from(second.filled));
  expect(Array.from(first.receiver)).toEqual(Array.from(second.receiver));
  expect(Array.from(first.wetness)).toEqual(Array.from(second.wetness));
});
