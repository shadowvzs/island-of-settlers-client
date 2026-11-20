import { describe, expect, it } from "vitest";

import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { withPersianClosedVaultJoins } from "../src/render-common/buildings/persian-roof-joins";
import { createRomanOccupationRoof } from "../src/renderers/three/buildings/roman-occupation-roof";

const roof: BuildingPart = { shape: "occupation-roof", occupationRoof: "barrel", surface: "roof",
  position: [0, 1.44, 0], size: [2, 1, 2], radialSegments: 16, stage: 3 };
const cap: BuildingPart = { shape: "persian-room", occupationRoof: "barrel", surface: "plaster",
  position: [0, 1.377, 0], size: [2, .87, 2], stage: 2 };
const recipe = { parts: [cap, roof] } as BuildingRecipe;

describe("closed Persian vault joints", () => {
  it("pairs oval infill with its own barrel, leaving open iwans and accepted towers unchanged", () => {
    const open = { ...roof, position: [0, 1.44, 2] as [number, number, number] };
    const result = withPersianClosedVaultJoins({ ...recipe, parts: [cap, roof, open] }, 17);
    expect(result.parts[1]!.persianRoofPlan).toEqual([1, 1]);
    expect(result.parts[2]).toBe(open);
    for (const id of [4, 9]) expect(withPersianClosedVaultJoins(recipe, id)).toBe(recipe);
  });
  for (const detailed of [true, false]) it(`closes an oval roof edge while retaining the tiled barrel profile (${detailed})`, () => {
    const part = { ...roof, radialSegments: detailed ? 16 : 6, persianRoofPlan: [.88, .86] as [number, number] };
    const geometry = createRomanOccupationRoof(part, detailed), p = geometry.getAttribute("position");
    const n = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
    let rim = 0, peak = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), ellipse = (x / .44) ** 2 + (z / .43) ** 2;
      expect(ellipse).toBeLessThanOrEqual(1.00001);
      expect(Number.isFinite(n.getX(i) + uv.getX(i))).toBe(true);
      if (Math.abs(n.getY(i)) < .01 && ellipse > .97) rim++;
      peak = Math.max(peak, p.getY(i));
    }
    expect(rim).toBeGreaterThan(30);
    expect(peak).toBeGreaterThanOrEqual(.429);
    expect(p.count / 3).toBeLessThan(detailed ? 4000 : 600);
    geometry.dispose();
  });
});
