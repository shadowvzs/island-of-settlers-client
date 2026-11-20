import { describe, expect, it } from "vitest";

import { createPropStones, createStone } from "../src/render-common/rocks/meadow-stones";
import { createRockShape } from "../src/render-common/rocks/rock-shapes";
import type { RockTerrain } from "../src/render-common/rocks/rock-terrain";
import { createRandom } from "../src/shared/world/rng";
import { PROP } from "../src/shared/world/world-data";

describe("sloped stone ground contact", () => {
  it("embeds the lower shell instead of balancing a wide stone on its centre", () => {
    const terrain: RockTerrain = { cellsX: 32, cellsZ: 32, height: (x, z) => .7 * x + .3 * z,
      mountain: () => 0, moisture: () => .2, visibility: () => 1 };
    const stone = createStone(terrain, () => 0, createRandom(42), { centre: [16, 16], radius: 1, yaw: .7 });
    const shape = createRockShape(stone.family, stone.variant, stone.high ? "high" : "low");
    for (let i = 0; i < shape.positions.length; i += 3) {
      const point = shape.positions.subarray(i, i + 3);
      if (point[1]! > -.15) continue;
      const world = [0, 1, 2].map(axis => stone.centre[axis]! +
        stone.axes[0][axis]! * point[0]! + stone.axes[1][axis]! * point[1]! + stone.axes[2][axis]! * point[2]!);
      expect(world[1]!).toBeLessThan(terrain.height(world[0]!, world[2]!));
    }
    expect(stone.centre[0]).toBe(16); expect(stone.centre[2]).toBe(16);
  });
  it("keeps companions off an adjacent cliff even when the main prop lies on level ground", () => {
    const terrain: RockTerrain = { cellsX: 32, cellsZ: 32,
      height: x => x > 16.5 ? (x - 16.5) * 3 : 0,
      mountain: () => 1, moisture: () => .2, visibility: () => 1 };
    const stones = createPropStones(PROP.largeRock, { scale: 2, x: 16, z: 16, yaw: 0 },
      { random: createRandom(42), terrain, tint: () => 0 });
    expect(stones.length).toBeGreaterThan(0);
    expect(stones.every(stone => stone.centre[0] < 16.5)).toBe(true);
  });
});
