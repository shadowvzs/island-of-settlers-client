import { expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { createLiveFog } from "../src/render-common/live-fog";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const makeWorld = (cellsX: number, cellsZ: number) => ({ cellsX, cellsZ,
  fog: Uint8Array.from({ length: cellsX * cellsZ }, (_, index) => (index * 17 + index % 7) % 3),
  fogRevision: 0 } as WorldData);

/** Reference the original clipped kernel, including its asymmetric vertex/cell-centre alignment. */
const referenceFog = (world: WorldData) => {
  const result = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x <= world.cellsX; x++) {
    let sum = 0, count = 0;
    for (let dz = z - 3; dz <= z + 2; dz++) for (let dx = x - 3; dx <= x + 2; dx++) {
      if (dx < 0 || dz < 0 || dx >= world.cellsX || dz >= world.cellsZ) continue;
      sum += world.fog[dz * world.cellsX + dx]! / FOG.visible;
      count++;
    }
    result[z * (world.cellsX + 1) + x] = count ? sum / count : 0;
  }
  return result;
};

it("preserves every blurred fog vertex at boundaries and on small, rectangular and full-size maps", () => {
  for (const [width, depth] of [[1, 1], [2, 7], [19, 11], [256, 256]]) {
    const world = makeWorld(width!, depth!);
    expect(createVertexFog(world)).toEqual(referenceFog(world));
  }
});

it("reuses live fog buffers and preserves texture bytes after revealing and hiding cells", () => {
  const world = makeWorld(13, 9), live = createLiveFog(world), pixels = live.pixels;
  expect(live.update()).toBe(false);
  for (const state of [FOG.visible, FOG.hidden, FOG.discovered]) {
    world.fog.fill(state, 10, 63);
    world.fogRevision!++;
    expect(live.update()).toBe(true);
    expect(live.pixels).toBe(pixels);
    const reference = referenceFog(world), stride = world.cellsX + 1;
    for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
      const v = z * stride + x;
      const value = Math.round((reference[v]! + reference[v + 1]! + reference[v + stride]!
        + reference[v + stride + 1]!) * 255 / 4);
      expect([...pixels.subarray((z * world.cellsX + x) * 4, (z * world.cellsX + x) * 4 + 4)])
        .toEqual([value, value, value, 255]);
    }
  }
});
