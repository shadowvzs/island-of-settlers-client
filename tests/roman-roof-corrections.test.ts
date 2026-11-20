import { Mesh, MeshStandardMaterial, Raycaster, Texture, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingPart,createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import type { LevelPart } from "../src/render-common/buildings/levels/level-kit";
import { addOpenDormerBody, addOpenRoofVentStorey } from "../src/render-common/buildings/levels/level-roof-vent";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { applyRoofReviewPrototype } from "../src/render-common/buildings/roof-review-prototype";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createRomanHarborBeacon } from "../src/renderers/three/buildings/roman-harbor-beacon";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const obsoleteEnd = (part: BuildingPart) => part.surface === "stone" && part.topScale?.[0] === .02 &&
  part.topOffset !== undefined && part.size[2] === .11;

it.each([true, false])("removes the old cross-facing Woodcutter gables with the complete roof (%s)", detailed => {
  const definition = getBuildingDefinition(17);
  const original = createRomanBuildingRecipe(definition, detailed);
  expect(original.parts.filter(obsoleteEnd)).toHaveLength(2);
  const broken = { ...original, parts: original.parts.map(part => ({ ...part, roofSupport: undefined })) };
  expect(applyRoofReviewPrototype(broken, 17, "roman", detailed).recipe.parts.filter(obsoleteEnd)).toHaveLength(2);
  for (const level of [1, 2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(definition, "roman", detailed, level);
    expect(recipe.parts.filter(obsoleteEnd)).toEqual([]);
    expect(recipe.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
    expect(recipe.door).toEqual(original.door);
    expect(recipe.parts.some(part => part.surface === "roof" && part.position[2] > .8)).toBe(true);
  }
});

it.each([true, false])("renders roof openings with shared alpha black while timber stays opaque (%s)", detailed => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const nation of ["roman", "viking"] as const) for (const id of [1, 17, 34, 37, 40]) {
      const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, nation, detailed, 5);
      const panes = recipe.parts.filter(part => part.windowShadowDecorative && part.windowShadow);
      expect(panes.length, `${nation}/${id}`).toBeGreaterThan(0);
      for (const pane of panes) {
        expect(pane.shape).toBe("window-shadow");
        expect(pane.position).not.toEqual(pane.windowOpeningPosition);
      }
      const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
      try {
        expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget(nation, id)[detailed ? 0 : 1] * 1.15);
        let shadows = 0;
        model.root.traverse(object => {
          if (!(object instanceof Mesh) || !object.userData.windowShadow) return;
          shadows++;
          const material = object.material as MeshStandardMaterial;
          expect(material.color.getHex()).toBe(0); expect(material.opacity).toBe(.5);
          expect(material.transparent).toBe(true); expect(material.depthWrite).toBe(false);
        });
        expect(shadows).toBeGreaterThan(0);
        expect(materials.wood.opacity).toBe(1); expect(materials.planks.opacity).toBe(1);
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it.each([true, false])("keeps actual air space between vent slats and through dormer reveals (%s)", detailed => {
  const parts: BuildingPart[] = [], material = new MeshStandardMaterial();
  const kit = { add: (part: LevelPart) => { parts.push({ stage: 4, ...part }); }, detailed };
  addOpenRoofVentStorey(kit, [0, 1, 0], .34, .2, .045, true);
  const solids = parts.filter(part => !part.windowShadow).map(part => new Mesh(createRomanPartGeometry(part, detailed), material));
  solids.forEach(mesh => mesh.updateMatrixWorld(true));
  const gap = detailed ? 1.025 : 1;
  expect(new Raycaster(new Vector3(0, gap, .8), new Vector3(0, 0, -1)).intersectObjects(solids)).toEqual([]);
  solids.forEach(mesh => mesh.geometry.dispose());
  parts.length = 0;
  addOpenDormerBody(kit, [0, 1, 1], [0, 0, 1], .97, 1.25, .34, .45, .16, "stone");
  const walls = parts.map(part => new Mesh(createRomanPartGeometry(part, detailed), material));
  walls.forEach(mesh => mesh.updateMatrixWorld(true));
  const hit = new Raycaster(new Vector3(0, 1.125, 2), new Vector3(0, 0, -1)).intersectObjects(walls)[0];
  expect(hit).toBeDefined(); expect(hit!.point.z).toBeLessThan(.6);
  walls.forEach(mesh => mesh.geometry.dispose()); material.dispose();
});

it("keeps the real shore beacon brazier opaque and its warm finish privately owned", () => {
  const materials = createPlainBuildingMaterials();
  const ironMap = new Texture(); materials.iron.map = ironMap; materials.iron.vertexColors = true;
  const beacon = createRomanHarborBeacon(39, materials, false, undefined, true)!;
  const base = beacon.root.getObjectByName("harbor_beacon_brazier") as Mesh;
  const material = base.material as MeshStandardMaterial;
  expect(material).not.toBe(materials.iron); expect(material.opacity).toBe(1);
  expect(material.transparent).toBe(false); expect(material.name).toBe("roman-beacon-weathered-bronze");
  expect(material.map).toBeNull(); expect(material.metalness).toBe(.2);
  expect(base.geometry.hasAttribute("color")).toBe(false); expect(material.vertexColors).toBe(false);
  expect(materials.iron.vertexColors).toBe(true);
  expect(materials.iron.map).toBe(ironMap);
  expect(base.userData.ownedMaterial).toBe(true);
  beacon.root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    if (object.userData.ownedMaterial) (object.material as MeshStandardMaterial).dispose();
  });
  Object.values(materials).forEach(source => source.dispose());
  ironMap.dispose();
});
