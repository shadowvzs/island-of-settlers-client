import { expect, it } from "vitest";

import { createTopographyFields } from "../src/shared/world/generation/topography-fields";

const SIZE = 33;
const grid = { cellsX: SIZE - 1, cellsZ: SIZE - 1 };
const index = (x: number, z: number) => z * SIZE + x;

it("marks the sun-facing slope as warm and a bowl as a hollow", () => {
  const heights = new Float32Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++)
    heights[index(x, z)] = x * .25 + ((x - 16) ** 2 + (z - 16) ** 2) * .004;
  const fields = createTopographyFields(grid, heights);
  expect(fields.heatLoad[index(8, 16)]!).toBeGreaterThan(.5);
  expect(fields.curvature[index(16, 16)]!).toBeGreaterThan(0);
});

it("distinguishes a windward ridge from the sheltered ground behind it", () => {
  const heights = new Float32Array(SIZE * SIZE), windX = .9165, windZ = .4008;
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const along = (x - 16) * windX + (z - 16) * windZ;
    heights[index(x, z)] = Math.max(0, 2 - Math.abs(along)) * .4;
  }
  const fields = createTopographyFields(grid, heights);
  expect(fields.exposure[index(17, 16)]!).toBeLessThan(0);
  expect(fields.exposure[index(16, 16)]!).toBeGreaterThan(0);
});
