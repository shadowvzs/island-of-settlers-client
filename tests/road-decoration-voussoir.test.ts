import { expect, it } from "vitest";

import type { RoadArchStone } from "../src/render-common/road-decoration-recipe";
import { createRubbleRoadArchRecipe } from "../src/render-common/road-decoration-rubble";
import { createRoadVoussoirGeometry } from "../src/renderers/three/road-decoration-voussoir";

it.each([true, false])("has matching radial cut planes, thin nonoverlapping joints and a fitted keystone at detail %s", detailed => {
  const stones = createRubbleRoadArchRecipe(detailed).parts.filter((part): part is RoadArchStone =>
    "kind" in part && part.kind === "arch-stone" && !part.mortar);
  expect(stones).toHaveLength(13);
  expect(stones[6]!.to - stones[6]!.from).toBeGreaterThan(.15);
  for (const [index, stone] of stones.entries()) {
    if (index) {
      const gap = stone.from - stones[index - 1]!.to;
      expect(gap).toBeGreaterThan(0); expect(gap).toBeLessThan(.00401);
      expect(stone.innerRadius).toBe(stones[index - 1]!.innerRadius);
      expect(stone.thickness).toBe(stones[index - 1]!.thickness);
    }
    const geometry = createRoadVoussoirGeometry(stone, detailed);
    try {
      const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
      const fromDepth: number[] = [], toDepth: number[] = [];
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex) - stone.position[0], y = positions.getY(vertex) - stone.position[1];
        const angle = Math.atan2(y, x), radius = Math.hypot(x, y);
        expect(angle).toBeGreaterThanOrEqual(stone.from - 1e-6);
        expect(angle).toBeLessThanOrEqual(stone.to + 1e-6);
        expect(radius).toBeGreaterThanOrEqual(stone.innerRadius - 1e-6);
        expect(radius).toBeLessThanOrEqual(stone.innerRadius + stone.thickness + 1e-6);
        if (Math.abs(angle - stone.from) < 1e-6) fromDepth.push(positions.getZ(vertex));
        if (Math.abs(angle - stone.to) < 1e-6) toDepth.push(positions.getZ(vertex));
        expect(Number.isFinite(normals.getX(vertex) + normals.getY(vertex) + normals.getZ(vertex))).toBe(true);
      }
      for (const depths of [fromDepth, toDepth]) {
        expect(depths.length).toBeGreaterThan(0);
        expect(Math.max(...depths)).toBeCloseTo(stone.depth / 2 - .014, 6);
        expect(Math.min(...depths)).toBeCloseTo(-stone.depth / 2 + .014, 6);
      }
    } finally { geometry.dispose(); }
  }
});
