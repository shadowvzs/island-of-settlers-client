import { describe, expect, it } from "vitest";

import { createBiomeFields, type MaterialInputs } from "../src/shared/world/generation/materials";
import { createThemeSampler, createUniformLayout } from "../src/shared/world/generation/theme-field";
import type { GridSize } from "../src/shared/world/grid-geometry";

const grid: GridSize = { cellsX: 16, cellsZ: 16 };
const count = (grid.cellsX + 1) * (grid.cellsZ + 1);
const zeros = () => new Float32Array(count);

const inputs = (wetness: Float32Array): MaterialInputs => {
  const heights = new Float32Array(count).fill(2);
  const weights = createUniformLayout("meadow")({ grid, heights });
  return {
    coastDistance: new Float32Array(count).fill(20),
    heights,
    massifContact: zeros(),
    massifFoot: zeros(),
    mineGround: zeros(),
    mineZone: new Uint16Array(count),
    plateauMask: zeros(),
    riverDistance: new Float32Array(count).fill(20),
    seaDistance: new Float32Array(count).fill(20),
    stillWater: zeros(),
    theme: createThemeSampler(grid, weights),
    waterDepth: zeros(),
    waterSurface: new Float32Array(count).fill(-0.5),
    wetness,
    topography: { curvature: zeros(), exposure: zeros(), heatLoad: new Float32Array(count).fill(0.5) }
  };
};

describe("drainage wetness in the moisture field (M01b)", () => {
  it("keeps valley floors moister than the same ground without drainage wetness", () => {
    const dry = createBiomeFields(grid, 7, inputs(zeros()), 1);
    const wet = createBiomeFields(grid, 7, inputs(new Float32Array(count).fill(1)), 1);
    expect(wet.moisture[5 * 17 + 8]!).toBeGreaterThan(dry.moisture[5 * 17 + 8]!);
    expect(wet.moisture[5 * 17 + 8]! - dry.moisture[5 * 17 + 8]!).toBeGreaterThan(0.1);
  });
});
