import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { romanFurnaceAnchors } from "../src/render-common/buildings/roman-furnaces";
import { buildingSolidBoxes } from "../src/renderers/three/buildings/building-hidden-triangles";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

it("cuts real bakery and smelter masonry, with opaque reveals/rear and unchanged effects anchors in both detail tiers", () => {
  for (const id of [32, 26]) for (const detailed of [true, false]) {
    const recipe = createRomanBuildingRecipe(getBuildingDefinition(id), detailed);
    const body = recipe.parts.filter(part => part.fireboxCut);
    const shadow = recipe.parts.find(part => part.windowShadowContour && part.windowShadowDecorative)!;
    expect(body.length, `body/${id}/${detailed}`).toBe(id === 32 ? 2 : 1);
    expect(buildingSolidBoxes(body)).toEqual([]);
    expect(shadow.windowOpeningPosition![2] - shadow.position[2]).toBeCloseTo(.22 * .72);
    expect(recipe.parts.some(part => part.shape === "firebox-reveal" && part.surface === "stone")).toBe(true);
    const [x, y, front] = shadow.windowOpeningPosition!;
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const meshes = body.map(part => new Mesh(createRomanPartGeometry(part, detailed), material));
    try {
      for (const mesh of meshes) mesh.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(x, y, front + .1), new Vector3(0, 0, -1), 0, .1 + .21);
      expect(ray.intersectObjects(meshes), `solid masonry still plugs ${id}/${detailed}`).toEqual([]);
      const side = new Raycaster(new Vector3(x + .25, y, front + .1), new Vector3(0, 0, -1), 0, .3);
      expect(side.intersectObjects(meshes).length).toBeGreaterThan(0);
      for (let index = 0; index < body.length; index++) {
        const part = body[index]!, geometry = meshes[index]!.geometry;
        geometry.computeBoundingBox();
        expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(part.position[0] - part.size[0] / 2 - .001);
        expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(part.position[0] + part.size[0] / 2 + .001);
      }
      expect(romanFurnaceAnchors(getBuildingDefinition(id), recipe)!.fire).toBeDefined();
    } finally { for (const mesh of meshes) mesh.geometry.dispose(); material.dispose(); }
  }
});

it("retains actual working cavity geometry across every national bakery/smelter and level", () => {
  for (const nation of ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"] as const)
    for (const detailed of [true, false]) for (const id of [26, 32]) for (const level of [1, 2, 3, 4, 5] as const) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(id), nation, detailed, level);
      expect(recipe.parts.some(part => part.fireboxCut), `${nation}/${id}/${level}/${detailed}/cut`).toBe(true);
      expect(recipe.parts.some(part => part.shape === "firebox-reveal"), `${nation}/${id}/${level}/${detailed}/reveal`).toBe(true);
      expect(recipe.parts.some(part => part.windowShadowContour && part.windowShadowDecorative), `${nation}/${id}/${level}/${detailed}/shadow`).toBe(true);
    }
});


it("keeps all 320 national furnace variants within strict original triangle caps", () => {
  stubPaintCanvas(); const materials = createPlainBuildingMaterials();
  const failures: string[] = [];
  try {
    for (const nation of ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"] as const)
      for (const detailed of [true, false]) for (const id of [26, 32]) for (const level of [1, 2, 3, 4, 5] as const) {
        const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, nation, detailed, level);
        const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
        const triangles = model.triangles(false), cap = nationTriangleBudget(nation, id)[detailed ? 0 : 1];
        if (triangles > cap) failures.push(`${nation}/${id}/${level}/${detailed}: ${triangles}/${cap}`);
        const mouth = recipe.parts.find(part => part.fireboxMouth)!;
        model.update(0, { construction: 1, working: false, door: 0 }); model.root.updateMatrixWorld(true);
        const origin = new Vector3(...mouth.windowOpeningPosition!); origin.z += .08;
        const end = origin.clone(); end.z -= .28;
        model.root.localToWorld(origin); model.root.localToWorld(end);
        const ray = new Raycaster(origin, end.clone().sub(origin).normalize(), 0, origin.distanceTo(end));
        const plugs = ray.intersectObject(model.root, true).filter(hit => {
          if (!(hit.object instanceof Mesh) || hit.object.userData.windowShadow || !hit.object.visible) return false;
          const pack = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
          return pack.some(material => !material.transparent && material.opacity === 1);
        });
        if (plugs.length) failures.push(`${nation}/${id}/${level}/${detailed}: opaque throat plug`);
        model.dispose();
      }
    expect(failures, failures.join("\n")).toEqual([]);
  } finally { Object.values(materials).forEach(material => material.dispose()); }
}, 30_000);
