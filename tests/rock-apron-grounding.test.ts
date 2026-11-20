import { expect, it } from "vitest";

import type { GeologyMap } from "../src/render-common/rocks/geology";
import { placeMountainApron } from "../src/render-common/rocks/rock-apron";
import { createRockShape,ROCK_FAMILY } from "../src/render-common/rocks/rock-shapes";
import type { RockTerrain } from "../src/render-common/rocks/rock-terrain";

it.each([0, .35, -.6])("grounds actual mountain-foot blocks across their lower surface on slope %s", slope => {
  const terrain: RockTerrain = { cellsX: 24, cellsZ: 24, height: (x,z) => 4 + slope*x + .08*z,
    moisture: () => 0, mountain: () => 1, visibility: () => 1 };
  const blocks = placeMountainApron({ terrain, family: () => ROCK_FAMILY.slab,
    geology: { tint: () => .5 } as unknown as GeologyMap,
    talus: () => ({ amount: 1, run: 0 }), tryReserve: () => true }, 123,
    { index: 0, minX: 3, minZ: 3, maxX: 9, maxZ: 9 });
  expect(blocks.length).toBeGreaterThan(10);
  for (const block of blocks) {
    const shape = createRockShape(block.family, block.variant, block.high ? "high" : "low");
    for (let i = 0; i < shape.positions.length; i += 3) {
      const [x,y,z] = Array.from(shape.positions.slice(i,i+3)) as [number,number,number];
      if (y > 0) continue;
      const point = block.centre.map((centre,axis) => centre + block.axes[0][axis]!*x + block.axes[1][axis]!*y + block.axes[2][axis]!*z);
      expect(point[1]! - terrain.height(point[0]!,point[2]!)).toBeLessThan(0);
    }
  }
});
