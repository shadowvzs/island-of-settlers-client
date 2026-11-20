import { Mesh } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { buildingPartNavigationVolumes, getBuildingNavigationProfile } from "../src/render-common/buildings/building-navigation-profile";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { withIndigenousFloorHides } from "../src/render-common/buildings/indigenous-floor-hides";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { getRomanWareStockSlots } from "../src/render-common/buildings/roman-ware-stock";
import { createIndigenousFloorHideMaterial } from "../src/renderers/three/buildings/indigenous-floor-hide-material";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("places only decorative seated skins without changing stock, actor anchors or existing room surfaces", () => {
  let covered = 0;
  for (const definition of BUILDING_CATALOG) for (const detailed of [true, false]) {
    const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, 1);
    const source = { ...recipe, parts: recipe.parts.filter(part => part.shape !== "indigenous-floor-hide") };
    const result = withIndigenousFloorHides(source, definition.id);
    expect(result.parts.filter(part => part.shape !== "indigenous-floor-hide")).toEqual(source.parts);
    for (const key of ["door", "doorDimensions", "mechanism", "navigation", "workerExit", "workPoint"] as const)
      expect(result[key]).toBe(source[key]);
    expect(withIndigenousFloorHides(result, definition.id)).toBe(result);
    const hides = result.parts.filter(part => part.shape === "indigenous-floor-hide");
    if (hides.length) covered++;
    for (const hide of hides) {
      expect(hide.stage).toBe(4); expect(hide.stock).toBeUndefined();
      const geometry = createRomanPartGeometry(hide, detailed);
      try {
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        const bearing = hide.position[1] - hide.size[1] / 2;
        expect(bounds.min.y).toBeCloseTo(bearing, 6);
        expect(bounds.max.y - bearing).toBeLessThan(.01);
      } finally {geometry.dispose();}
    }
    if ([18, 35].includes(definition.id)) expect(hides, `Open bay floor ${definition.id}`).toHaveLength(0);
  }
  expect(covered).toBeGreaterThan(40);
  for (const nation of ["roman", "japanese", "chinese", "persian", "maya", "nubian", "viking"] as const)
    expect(leveledBuildingRecipe(getBuildingDefinition(20), nation, false, 1).parts
      .some(part => part.shape === "indigenous-floor-hide")).toBe(false);
});

it("keeps soft rugs out of actual inferred navigation and preserves every packed stock slot", () => {
  const affected = new Set<number>();
  for (const definition of BUILDING_CATALOG) for (const level of [1, 2, 3, 4, 5] as const) {
    const profile = getBuildingNavigationProfile(definition.id, "indigenous", level);
    const hides = profile.recipe.parts.filter(part => part.shape === "indigenous-floor-hide");
    if (!hides.length) continue;
    affected.add(definition.id);
    const parts = profile.recipe.parts.filter(part => !part.stock);
    expect(buildingPartNavigationVolumes(parts, profile.scale), `${definition.id}/${level} walking volumes`)
      .toEqual(buildingPartNavigationVolumes(parts.filter(part => part.shape !== "indigenous-floor-hide"), profile.scale));
    expect(buildingPartNavigationVolumes(hides, profile.scale)).toEqual([]);
    for (const detailed of [true, false]) {
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const source = { ...recipe, parts: recipe.parts.filter(part => part.shape !== "indigenous-floor-hide") };
      const { scale } = getRomanBuildingWorldSizing(definition);
      expect(getRomanWareStockSlots(recipe, scale), `${definition.id}/${level}/${detailed} packed slots`)
        .toEqual(getRomanWareStockSlots(source, scale));
    }
  }
  expect(affected.size).toBe(52);
});

it("renders the actual room hides in one shared surface batch per model inside the original caps", () => {
  const materials = createPlainBuildingMaterials();
  // Simultaneous buildings keep their shared family maps resident during this model matrix.
  const high = createIndigenousFloorHideMaterial(true), minimal = createIndigenousFloorHideMaterial(false);
  try {for (const id of [0, 6, 7, 20, 33, 59]) for (const detailed of [true, false]) for (const level of [1, 5] as const) {
    const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
    expect(recipe.parts.filter(part => part.shape === "indigenous-floor-hide").length, `${id}/${level}`)
      .toBeGreaterThan(0);
    const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
    try {
      const floorMeshes = model.root.getObjectByName("construction_4")!.children.filter(object =>
        object instanceof Mesh && object.userData.buildingSurface === "hide" && object.userData.ownedMaterial);
      expect(floorMeshes).toHaveLength(1);
      expect(model.triangles(false), `${id}/${detailed}/${level}`)
        .toBeLessThanOrEqual(nationTriangleBudget("indigenous", id)[detailed ? 0 : 1]);
      model.update(0, { construction: .6, door: 0, working: false });
      expect(floorMeshes[0]!.parent!.visible).toBe(false);
      model.update(0, { construction: 1, door: 0, working: false });
      expect(floorMeshes[0]!.parent!.visible).toBe(true);
    } finally {model.dispose();}
  }} finally {
    high.dispose(); minimal.dispose(); Object.values(materials).forEach(material => material.dispose());
  }
});
