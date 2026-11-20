import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createPersianStripedAwning } from "../src/render-common/props/persian-striped-awning";
import { createPersianStripedAwningGeometry } from "../src/renderers/three/buildings/persian-striped-awning-geometry";
import { unsupportedParts } from "./helpers/recipe-supports";

it.each([true, false])("keeps opaque sewn stripes sagging between supported canvas edges (%s)", detailed => {
  const mesh = createPersianStripedAwning(detailed);
  const colours = new Set(Array.from({ length: mesh.colors.length / 3 }, (_, i) =>
    Array.from(mesh.colors.slice(i * 3, i * 3 + 3)).join(",")));
  expect(colours.size).toBe(3); expect(Array.from(mesh.wind).every(value => value === 0)).toBe(true);
  for (const value of mesh.positions) expect(Math.abs(value)).toBeLessThanOrEqual(.50001);
  const part: BuildingPart = { position: [0, 0, 0], shape: "persian-striped-awning" as const,
    size: [1, 1, 1] as [number, number, number], stage: 3 as const, surface: "cloth" as const };
  const geometry = createPersianStripedAwningGeometry(part, detailed), material = new MeshBasicMaterial();
  const object = new Mesh(geometry, material); object.updateMatrixWorld(true);
  const height = (x: number) => new Raycaster(new Vector3(x, 2, 0), new Vector3(0, -1, 0))
    .intersectObject(object)[0]!.point.y;
  expect(height(.49) - height(0)).toBeGreaterThan(.20);
  geometry.dispose(); material.dispose();
});

it.each([true, false])("places supported side canopies only in free Persian yards inside the original plots (%s)", detailed => {
  const found: number[] = [];
  for (const definition of BUILDING_CATALOG) {
    const recipe = createNationBuildingRecipe(definition, "persian", detailed);
    if (!recipe.parts.some(part => part.shape === "persian-striped-awning")) continue;
    found.push(definition.id);
    const original = createRomanBuildingRecipe(definition, detailed, false);
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ).toBeLessThanOrEqual(before.extentZ + .001);
    expect(recipe.workerExit).toEqual(original.workerExit); expect(recipe.workPoint).toEqual(original.workPoint);
    expect(unsupportedParts(recipe), `${definition.id}/${detailed}`).toEqual([]);
  }
  console.info("Persian canopies", detailed, found);
  expect(found.length).toBeGreaterThanOrEqual(2);
});
