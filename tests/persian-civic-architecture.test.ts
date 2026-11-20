import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { createPersianBuildingRecipe } from "../src/render-common/buildings/persian-building-recipe";
import { createPersianStuccoRelief } from "../src/render-common/props/persian-stucco-relief";
import { createPersianArchSpandrel } from "../src/renderers/three/buildings/persian-arch-spandrel";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { unsupportedParts } from "./helpers/recipe-supports";

it("keeps carved plaster static with bounded High/Minimal geometry", () => {
  const high = createPersianStuccoRelief(true), minimal = createPersianStuccoRelief(false);
  expect(high.indices.length / 3).toBeLessThanOrEqual(650);
  expect(minimal.indices.length).toBeLessThan(high.indices.length * .5);
  for (const mesh of [high, minimal]) {
    expect([...mesh.positions, ...mesh.normals].every(Number.isFinite)).toBe(true);
    expect(Array.from(mesh.wind).every(value => value === 0)).toBe(true);
  }
});

it.each([true, false])("has a real pointed opening, closed reveal faces and bounded geometry (High=%s)", detailed => {
  const geometry = createPersianArchSpandrel(.8, .8, detailed), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const ray = (x: number, y: number) => new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1))
    .intersectObject(mesh).length;
  expect(ray(0, -.3)).toBe(0);
  expect(ray(0, .15)).toBe(0);
  expect(ray(.46, -.3)).toBeGreaterThan(0);
  expect(ray(0, .47)).toBeGreaterThan(0);
  expect(geometry.boundingBox!.min.toArray()).toEqual([-.5, -.5, -.5]);
  expect(geometry.boundingBox!.max.toArray()).toEqual([.5, .5, .5]);
  geometry.dispose(); material.dispose();
});

it("retains the authored physical opening when the facade rectangle is stretched", () => {
  const geometry = createPersianArchSpandrel(.8, .8, true, 2), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); mesh.scale.set(2, 1, .2); mesh.position.y = .5; mesh.updateMatrixWorld(true);
  const height = Math.sqrt(.8 ** 2 - .6 ** 2);
  const hits = (y: number) => new Raycaster(new Vector3(.6, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh);
  expect(hits(height - .025)).toHaveLength(0);
  expect(hits(height + .025).length).toBeGreaterThan(0);
  geometry.dispose(); material.dispose();
});

it("has actual open long-side Monument windows rather than panels on an unbroken wall", () => {
  const definition = getBuildingDefinition(7), materials = createPlainBuildingMaterials();
  const recipe = createPersianBuildingRecipe(createRomanBuildingRecipe(definition, false, false), definition, false);
  const model = createRomanBuilding(definition, materials, false, recipe, "persian");
  model.root.updateMatrixWorld(true);
  for (const side of [-1, 1]) for (const bay of [-1.125, 1.175]) {
    let through = 0;
    for (const offset of [-.30, -.22, -.14, -.06, .06, .14, .22, .30]) {
      const hits = new Raycaster(new Vector3(side * 5, 1.05, bay + offset), new Vector3(-side, 0, 0))
        .intersectObject(model.root, true);
      if (!hits.length || hits[0]!.distance > 2.5) through++;
    }
    expect(through).toBeGreaterThanOrEqual(4);
    const pier = new Raycaster(new Vector3(side * 5, 1.05, bay + .9), new Vector3(-side, 0, 0))
      .intersectObject(model.root, true);
    expect(pier[0]!.distance).toBeLessThan(1.6);
  }
  model.dispose(); Object.values(materials).forEach(material => material.dispose());
});

it.each([true, false])("retains civic anchors, load-bearing contacts and actual mesh budgets (High=%s)", detailed => {
  for (const id of [0, 7]) {
    const definition = getBuildingDefinition(id), original = createRomanBuildingRecipe(definition, detailed, false);
    const recipe = createPersianBuildingRecipe(original, definition, detailed);
    const { parts: _before, ...anchors } = original, { parts: _after, ...builtAnchors } = recipe;
    expect(builtAnchors).toEqual(anchors);
    expect(recipe.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
    expect(unsupportedParts(recipe)).toEqual([]);
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ).toBeLessThanOrEqual(before.extentZ + .001);
    const materials = createPlainBuildingMaterials(), model = createRomanBuilding(definition, materials, detailed, recipe, "persian");
    const triangles = model.triangles(false);
    model.dispose(); Object.values(materials).forEach(material => material.dispose());
    console.info(`Persian civic ${id}/${detailed ? "High" : "Minimal"}: ${triangles} triangles`);
    expect(triangles).toBeLessThanOrEqual(nationTriangleBudget("persian", id)[detailed ? 0 : 1]);
  }
});
