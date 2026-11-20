import { describe, expect, it } from "vitest";

import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import { createRockShape, ROCK_FAMILY } from "../src/render-common/rocks/rock-shapes";
import type { RockTerrain } from "../src/render-common/rocks/rock-terrain";
import { groundScreeStone } from "../src/render-common/rocks/scree-grounding";

const shape = createRockShape(ROCK_FAMILY.broken, 2, "low");
const stone: RockInstance = {
  axes: [
    [0.8, 0.1, 0],
    [-0.03, 0.5, 0],
    [0, 0.02, 0.6]
  ],
  centre: [4, 200, 4],
  exposure: 0.2,
  family: ROCK_FAMILY.broken,
  high: false,
  moss: 0,
  role: ROCK_ROLE.rubble,
  slab: -1,
  tint: 0.5,
  variant: 2
};
const terrain = (height: RockTerrain["height"]): RockTerrain => ({
  cellsX: 10,
  cellsZ: 10,
  height,
  moisture: () => 0,
  mountain: () => 1,
  visibility: () => 1
});

describe("terrain-fitted render-only scree", () => {
  it.each([0, 0.2, -0.35])("buries the actual lower vertices on slope %s", (slope) => {
    const ground = terrain((x, z) => 2 + x * slope + z * 0.08);
    const fitted = groundScreeStone(stone, shape, ground)!;
    expect(fitted).not.toBeNull();
    expect(stone.centre[1]).toBe(200);
    expect(fitted.axes).toBe(stone.axes);
    let above = 0;
    for (let index = 0; index < shape.positions.length; index += 3) {
      const [x, y, z] = Array.from(shape.positions.slice(index, index + 3)) as [number, number, number];
      const point = fitted.centre.map(
        (centre, axis) =>
          centre + fitted.axes[0][axis]! * x + fitted.axes[1][axis]! * y + fitted.axes[2][axis]! * z
      );
      const clearance = point[1]! - ground.height(point[0]!, point[2]!);
      if (y <= 0) expect(clearance).toBeLessThan(-0.035);
      above = Math.max(above, clearance);
    }
    expect(above).toBeGreaterThan(0.075);
  });

  it("rejects a foundation at the edge although the centre is clear", () => {
    const ground = { ...terrain(() => 0), isBuildLand: (x: number) => x > 4.1 };
    expect(ground.isBuildLand(stone.centre[0])).toBe(false);
    expect(groundScreeStone(stone, shape, ground)).toBeNull();
  });

  it("keeps a river and tree clearance outside the centre free", () => {
    const ground = terrain(() => 0);
    expect(groundScreeStone(stone, shape, ground, (x) => x > 4.1)).toBeNull();
    const river = { ...ground, river: (x: number) => (x > 4.1 ? 0 : 3) };
    expect(groundScreeStone(stone, shape, river)).toBeNull();
  });

  it("omits a fully swallowed chip on an extremely steep face", () => {
    expect(
      groundScreeStone(
        stone,
        shape,
        terrain((x) => x * 8)
      )
    ).toBeNull();
  });
});
