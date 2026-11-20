import { describe, expect, it } from "vitest";

import { bakeTerrainLight, computeNormals, DEFAULT_SUN, removePlanarOcclusion } from "../src/shared/world/lighting";

const GRID = { cellsX: 32, cellsZ: 32 };
const vertexCount = (GRID.cellsX + 1) * (GRID.cellsZ + 1);

/** Heights of a surface `height(x, z)` on the test grid, with its bake and normals. */
const bake = (height: (x: number, z: number) => number) => {
  const heights = new Float32Array(vertexCount);
  for (let z = 0; z <= GRID.cellsZ; z++) for (let x = 0; x <= GRID.cellsX; x++) heights[z * 33 + x] = height(x, z);
  const light = bakeTerrainLight(GRID, heights, new Float32Array(vertexCount).fill(-10), DEFAULT_SUN);
  return { light, normals: computeNormals(GRID, heights) };
};

const corrected = ({ light, normals }: ReturnType<typeof bake>, x: number, z: number) => {
  const index = z * 33 + x;
  return removePlanarOcclusion(light.ambientOcclusion[index]!, normals[index * 3]!, normals[index * 3 + 1]!,
    normals[index * 3 + 2]!);
};

describe("WALL-PATCHES planar occlusion removal", () => {
  it("leaves a plain slope unoccluded although the bake darkens it", () => {
    const slope = bake((x, z) => x * 0.9 + z * 0.3);
    expect(slope.light.ambientOcclusion[16 * 33 + 16]).toBeLessThan(200);
    expect(corrected(slope, 16, 16)).toBeGreaterThan(250);
  });

  it("keeps the occlusion of a gully cut into the slope", () => {
    const gully = bake((x, z) => x * 0.9 + 3 * Math.min(1, Math.abs(z - 16) / 3));
    expect(corrected(gully, 16, 16)).toBeLessThan(230);
  });

  it("changes nothing on flat ground", () => {
    const flat = bake(() => 1);
    expect(corrected(flat, 16, 16)).toBe(flat.light.ambientOcclusion[16 * 33 + 16]);
  });
});
