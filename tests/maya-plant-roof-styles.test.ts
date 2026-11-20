import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { mayaPlantRoofCoreHeight, type MayaPlantRoofStyle } from "../src/render-common/buildings/maya-plant-roof-profile";
import { createMayaThatchRoof } from "../src/renderers/three/buildings/maya-thatch-roof";

it.each([true, false])("retains each Maya roof's material after the production cover replacement (%s)", detailed => {
  const surfaces = { maize: "straw", palm: "palm-thatch", reed: "roof-thatch" };
  const observed = new Set<string>();
  for (const definition of BUILDING_CATALOG) for (const level of [1, 2, 3, 4, 5] as BuildingLevel[]) {
    const recipe = leveledBuildingRecipe(definition, "maya", detailed, level);
    for (const part of recipe.parts) {
      if (part.shape !== "occupation-roof" || !part.plantRoofStyle) continue;
      observed.add(part.plantRoofStyle);
      expect(part.surface, `${definition.id}/L${level}/${part.plantRoofStyle}`).toBe(surfaces[part.plantRoofStyle]);
    }
  }
  expect([...observed].sort()).toEqual(["maize", "palm", "reed"]);
});

it.each([true, false])("gives palm, reed and maize roofs distinct closed geometry on the same structural core (%s)", detailed => {
  const signatures = new Set<string>();
  for (const style of ["palm", "reed", "maize"] as MayaPlantRoofStyle[]) {
    const part: BuildingPart = { occupationRoof: "hip", plantRoofStyle: style, position: [0, 0, 0],
      shape: "occupation-roof", size: [2, .8, 2], stage: 3, surface: "straw" };
    const geometry = createMayaThatchRoof(part, detailed);
    signatures.add(Array.from(geometry.getAttribute("position").array).slice(-90).join(","));
    expect(geometry.userData.thatch.plantRoofStyle).toBe(style);
    expect(geometry.userData.thatch.alphaCards).toBe(false);
    expect(geometry.getAttribute("position").count / 3).toBeLessThan(detailed ? 4500 : 650);
    geometry.setDrawRange(0, geometry.userData.thatch.coreVertices);
    const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    for (const x of [-.39, -.15, .13, .36]) for (const z of [-.37, -.11, .16, .35]) {
      const hit = new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObject(mesh)[0];
      expect(hit).toBeDefined();
      expect(hit!.point.y).toBeCloseTo(mayaPlantRoofCoreHeight(part, x, z)!, 6);
    }
    expect(mayaPlantRoofCoreHeight(part, .49, 0)).toBeNull();
    geometry.dispose(); material.dispose();
  }
  expect(signatures.size).toBe(3);
});
