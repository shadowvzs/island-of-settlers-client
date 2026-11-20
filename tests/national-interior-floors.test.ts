import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getBuildingInteriorFloorSites } from "../src/render-common/buildings/building-interior-floors";
import type { BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { withNationalInteriorFloors } from "../src/render-common/buildings/national-interior-floors";
import { PERSIAN_ROOM_INNER_RADIUS } from "../src/render-common/buildings/persian-room-dimensions";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

const nations = ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"] as const;
it.each(nations)("preserves %s recipe anchors and contacts with idempotent finishes at every level and LOD", (nation) => {
  for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const)
    for (const definition of BUILDING_CATALOG) {
      const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
      const finished = withNationalInteriorFloors(recipe, nation, definition.id, detailed);
      expect(finished, `${nation}/${definition.id}/${level}/${detailed}`).toEqual(recipe);
      for (const site of getBuildingInteriorFloorSites(recipe, definition.id)) {
        expect(site.position[1]).toBeCloseTo(site.part.position[1] + site.part.size[1] / 2);
        expect(site.part.stock).toBeUndefined();
        expect(site.part.workyardAssembly).toBeUndefined();
      }
    }
});
it("repairs Viking and Nubian Lodge finishes and Maya floor projection while retaining their palettes", () => {
  for (const detailed of [true, false]) for (const nation of ["viking", "nubian", "maya"] as const) {
    for (const definition of BUILDING_CATALOG) {
      const recipe = createNationBuildingRecipe(definition, nation, detailed);
      for (const site of getBuildingInteriorFloorSites(recipe, definition.id)) {
        if (nation === "maya") { expect(site.part.mayaMasonryUv).toBeUndefined(); expect(site.part.worldUv).toBe(1); }
        if (definition.id === 62) {
          const surfaces = { viking: "planks", nubian: "stone", maya: "cut-stone" };
          expect(site.part.surface).toBe(surfaces[nation]);
        }
      }
    }
  }
});
it("only changes the supported Chinese hollow tower top, preserving its structural sides and triangle budget", () => {
  for (const detailed of [true, false]) for (const id of [4, 16]) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "chinese", detailed);
    const top = recipe.parts.find(part => part.interiorFloorFaces === "top")!;
    const side = recipe.parts.find(part => part.interiorFloorFaces === "sides")!;
    expect(top.surface).toBe("planks"); expect(side.surface).not.toBe("planks");
    expect(top.position).toEqual(side.position); expect(top.size).toEqual(side.size);
    const a = createRomanPartGeometry(top, detailed), b = createRomanPartGeometry(side, detailed);
    const original = createRomanPartGeometry({ ...side, interiorFloorFaces: undefined }, detailed);
    try { expect(a.index!.count + b.index!.count).toBe(original.index!.count); }
    finally { a.dispose(); b.dispose(); original.dispose(); }
  }
});
it("fills actual Persian hollow rooms with cap-only inner-profile stone floors at the original threshold", () => {
  let floors = 0;
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    const recipe = createNationBuildingRecipe(definition, "persian", detailed);
    for (const floor of recipe.parts.filter(part => part.shape === "cylinder" && part.interiorFloorFaces === "top")) {
      floors++;
      const room = recipe.parts.find(part => part.shape === "persian-room" && part.size[1] >= .4 &&
        Math.abs(part.position[1] - part.size[1] / 2) < .00001 &&
        part.position[0] === floor.position[0] && part.position[2] === floor.position[2] &&
        Math.abs(part.size[0] * PERSIAN_ROOM_INNER_RADIUS * 2 - floor.size[0]) < .00001)!;
      expect(room).toBeDefined(); expect(floor.surface).toBe("cut-stone");
      const geometry = createRomanPartGeometry(floor, detailed);
      try {
        expect(geometry.index!.count).toBeGreaterThanOrEqual((detailed ? 32 : 14) * 3);
        const vertices = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
        for (const vertex of geometry.index!.array) {
          expect(vertices.getY(vertex)).toBeCloseTo(.024, 6); expect(normals.getY(vertex)).toBe(1);
          const x = (vertices.getX(vertex) - floor.position[0]) / (floor.size[0] / 2);
          const z = (vertices.getZ(vertex) - floor.position[2]) / (floor.size[2] / 2);
          expect(x * x + z * z).toBeLessThanOrEqual(1.000001);
        }
      } finally { geometry.dispose(); }
    }
  }
  expect(floors).toBeGreaterThan(50);
});
it("does not invent floors for an open well, solid tower, high roof slab or stock platform", () => {
  const recipe: BuildingRecipe = { door: [0, 0, 1], doorProfile: "flat", mechanism: [0, 1, 0], workerExit: [0, 0, 1], workPoint: [1, 0, 0], parts: [
    { shape: "persian-room", surface: "plaster", position: [0, .5, 0], size: [1, 1, 1], stage: 1 },
    { shape: "box", surface: "stone", position: [0, 1.02, 0], size: [2, .04, 2], stage: 4 }
  ] };
  const finished = withNationalInteriorFloors(recipe, "persian", 0, true);
  expect(finished.parts).toHaveLength(3);
  expect(finished.parts.slice(0, 2)).toEqual(recipe.parts);
  expect(finished.door).toBe(recipe.door);
  for (const nation of nations) {
    const well = createNationBuildingRecipe(getBuildingDefinition(35), nation, false);
    expect(well.parts.some(part => part.interiorFloorFaces)).toBe(false);
  }
  const solid = createNationBuildingRecipe(getBuildingDefinition(4), "nubian", false);
  expect(solid.parts.some(part => part.interiorFloorFaces)).toBe(false);
});
