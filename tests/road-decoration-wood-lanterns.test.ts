import { Box3, type DataTexture, type Mesh, type MeshStandardMaterial, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { getRoadDecorationItem } from "../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationMessages } from "../src/app/player-inventory/road-decoration-presentation";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { createWoodenRoadLanternRecipe } from "../src/render-common/road-decoration-wood-lanterns";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createDecorationAssetLoader } from "../src/renderers/three/road-decoration-asset-loader";
import { createRoadDecorationModel } from "../src/renderers/three/road-decoration-model";
import { createWoodenRoadLanternModel } from "../src/renderers/three/road-decoration-wood-lantern";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each(["japanese", "chinese"] as const)("loads registered %s wooden lanterns with canonical physical bounds and bounded near/far models", async nation => {
  const item = `roadDecoration:${nation}-wooden-lantern:native`;
  expect(getRoadDecorationItem(item)).toMatchObject({ category: "lanterns", shopAvailable: true, price: 5 });
  expect(roadDecorationMessages(item)?.name).toBeDefined();
  const definition = getRoadDecoration(`${nation}-wooden-lantern`)!;
  expect(definition.family).toBe("wooden-lantern");
  const physical = roadDecorationClearance(definition);
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) for (const tier of ["near", "far"] as const) {
      const model = await createDecorationAssetLoader(() => materials, detailed)(item, item, () => true, tier);
      expect(model).toBeDefined();
      try {
        const bounds = new Box3().setFromObject(model!.root);
        expect(bounds.min.y).toBeCloseTo(0, 5);
        const profile = ornamentalDecorationProfile(item, detailed)!;
        expect(model!.triangles).toBeLessThanOrEqual(tier === "near" ? profile.cost : profile.farCost);
        model!.root.updateMatrixWorld(true);
        model!.root.traverse(object => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          const positions = mesh.geometry.getAttribute("position");
          for (let index = 0; index < positions.count; index++) {
            const point = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
            expect(physical.volumes.some(box => point.x >= box.min[0] - .00001 && point.x <= box.max[0] + .00001 &&
              point.y >= box.min[1] - .00001 && point.y <= box.max[1] + .00001 &&
              point.z >= box.min[2] - .00001 && point.z <= box.max[2] + .00001)).toBe(true);
          }
        });
      } finally { model?.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("distinct wooden lanterns have flat support, compact verge footprints and bounded native geometry", () => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) for (const nation of ["japanese", "chinese"] as const) {
      const recipe = createWoodenRoadLanternRecipe(nation, detailed), model = createRoadDecorationModel(recipe, materials, detailed);
      try {
        const bounds = new Box3().setFromObject(model.root);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-.00001);
        expect(bounds.min.y).toBeLessThan(.001);
        expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(.301);
        expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(.301);
        expect(model.triangles, `${nation}/${detailed}`).toBeLessThanOrEqual(detailed ? 3_500 : 1_000);
        expect(recipe.wind).toBe(0);
      } finally { model.dispose(); }
    }
    expect(createWoodenRoadLanternRecipe("japanese", true).parts).not.toEqual(createWoodenRoadLanternRecipe("chinese", true).parts);
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("Japanese paper stays neutral instead of inheriting dyed clothing and frees only its private surface", () => {
  const materials = createPlainBuildingMaterials(), borrowed = vi.fn();
  materials.cloth.addEventListener("dispose", borrowed);
  const model = createWoodenRoadLanternModel("japanese", true, materials);
  try {
    const paper = (model.root.getObjectByName("cloth") as Mesh).material as MeshStandardMaterial;
    const texture = paper.map as DataTexture, freed = vi.fn(); texture.addEventListener("dispose", freed);
    expect(paper).not.toBe(materials.cloth);
    expect(texture.image.data![0]).toBeGreaterThan(220);
    expect(Math.abs(texture.image.data![0]! - texture.image.data![1]!)).toBeLessThan(5);
    model.dispose(); model.dispose();
    expect(freed).toHaveBeenCalledOnce(); expect(texture.image.data).toBeNull();
    expect(borrowed).not.toHaveBeenCalled();
  } finally { model.dispose(); Object.values(materials).forEach(material => material.dispose()); }
});

it.each([true, false])("joins Chinese diagonals to actual corner posts and bears both roof tiers at detail %s", detailed => {
  const recipe = createWoodenRoadLanternRecipe("chinese", detailed);
  const braces = recipe.parts.filter(part => !("kind" in part) && part.shape === "box" && part.size[0] === .008);
  expect(braces).toHaveLength(detailed ? 12 : 6);
  for (const brace of braces) {
    if ("kind" in brace) throw new Error("Expected solid brace");
    for (const sign of [-1, 1]) {
      const end = new Vector3(0, sign * brace.size[1] / 2, 0);
      for (const [axis, angle] of (brace.rotation ?? [0, 0, 0]).entries())
        end.applyAxisAngle(new Vector3(Number(axis === 0), Number(axis === 1), Number(axis === 2)), angle);
      end.add(new Vector3(...brace.position));
      expect(Math.hypot(end.x, end.z)).toBeCloseTo(.095, 8);
      expect(end.y === .60 || Math.abs(end.y - .87) < 1e-8).toBe(true);
      const angle = Math.atan2(end.x, end.z) / (Math.PI / 3);
      expect(Math.abs(angle - Math.round(angle))).toBeLessThan(1e-8);
    }
  }
  expect(recipe.parts.some(part => !("kind" in part) && part.shape === "cylinder" &&
    part.position[0] === 0 && part.position[2] === 0 &&
    part.position[1] - part.size[1] / 2 < 1.01 && part.position[1] + part.size[1] / 2 > 1.06)).toBe(true);
});
