import { Mesh, MeshStandardMaterial, Texture } from "three";
import { expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createWindowShadowPane, isLegacyWindowPane, withBuildingWindowShadows } from "../src/render-common/buildings/building-window-shadows";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { windowGarrisonAnchors } from "../src/render-common/buildings/military-window-slots";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { windowShadowMaterial } from "../src/renderers/three/buildings/window-shadow-material";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("uses one recessed plane, exact old opening metadata and an idempotent future-window default", () => {
  const pane: BuildingPart = { shape: "box", surface: "dark", position: [1, .8, 0], size: [.018, .3, .24], stage: 2 };
  const part = createWindowShadowPane(pane), geometry = createRomanPartGeometry(part, false);
  try {
    expect((geometry.index?.count ?? geometry.getAttribute("position").count) / 3).toBe(2);
    expect(part.position[0]).toBeLessThan(pane.position[0]);
    expect(part.windowOpeningPosition).toEqual(pane.position); expect(part.windowOpeningSize).toEqual(pane.size);
    expect(windowGarrisonAnchors([part])).toEqual(windowGarrisonAnchors([pane]));
    expect(createWindowShadowPane(part)).toBe(part);
    const recipe = { parts: [part] } as BuildingRecipe;
    expect(withBuildingWindowShadows(withBuildingWindowShadows(recipe))).toEqual(recipe);
  } finally { geometry.dispose(); }
});

it("shares exact alpha-black material until its pack owner releases it, without disposing borrowed maps", () => {
  const source = new MeshStandardMaterial({ map: new Texture() });
  const borrowedMap = vi.spyOn(source.map!, "dispose"), shadow = windowShadowMaterial(source);
  const release = vi.spyOn(shadow, "dispose");
  expect(windowShadowMaterial(source)).toBe(shadow);
  expect(shadow.color.getHex()).toBe(0); expect(shadow.opacity).toBe(.5); expect(shadow.transparent).toBe(true);
  expect(shadow.depthWrite).toBe(false); expect(shadow.map).toBeNull();
  expect(shadow.forceSinglePass).toBe(true);
  source.dispose(); expect(release).toHaveBeenCalledOnce(); expect(borrowedMap).not.toHaveBeenCalled();
  source.map!.dispose();
});

it("uses the canonical single shadow layer throughout all eight nations and upgraded models", () => {
  for (const nation of ["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"] as const)
    for (const detailed of [true, false]) for (const id of [0, 2, 9, 16, 60]) for (const level of [1, 3, 5] as const) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(id), nation, detailed, level);
      expect(recipe.parts.filter(part => !part.windowShadow && isLegacyWindowPane(part, recipe.parts)), `${nation}/${id}/${level}`).toEqual([]);
      const panes = recipe.parts.filter(part => part.windowShadow);
      const keys = panes.map(part => JSON.stringify(part.windowOpeningPosition));
      expect(new Set(keys).size, `${nation}/${id}/${level}/duplicates`).toBe(keys.length);
    }
});

it("does not turn unrelated opaque hearths, doors or stock into transparent windows", () => {
  const wall: BuildingPart = { shape: "box", surface: "plaster", stage: 1, position: [1, .8, 0], size: [.1, 1.6, 2] };
  const pane: BuildingPart = { shape: "box", surface: "dark", stage: 2, position: [1.06, .8, 0], size: [.018, .3, .24] };
  const hearth: BuildingPart = { ...pane, stage: 3, position: [1.8, .47, .283] };
  const door: BuildingPart = { ...pane, stage: 1, position: [0, .4, 1], size: [.46, .8, .018] };
  const stock: BuildingPart = { ...pane, stock: { ware: "coal", slot: 0 } };
  const parts = [wall, pane, hearth, door, stock], actual = withBuildingWindowShadows({ parts } as BuildingRecipe).parts;
  expect(actual[1]!.windowShadow).toBe(true);
  expect(actual.slice(2)).toEqual([hearth, door, stock]);
});

it("merges panes without shadow rendering and lets model teardown keep another instance's shared material alive", () => {
  const materials = createPlainBuildingMaterials(), definition = getBuildingDefinition(9);
  const recipe = createNationBuildingRecipe(definition, "persian", true);
  const first = createRomanBuilding(definition, materials, true, recipe, "persian");
  const second = createRomanBuilding(definition, materials, false, recipe, "persian");
  const shadow = windowShadowMaterial(materials.dark), release = vi.spyOn(shadow, "dispose");
  let meshes = 0;
  first.root.traverse(object => {
    if (!(object instanceof Mesh) || !object.userData.windowShadow) return;
    meshes++; expect(object.material).toBe(shadow); expect(object.castShadow).toBe(false); expect(object.receiveShadow).toBe(false);
  });
  expect(meshes).toBeGreaterThan(0); expect(meshes).toBeLessThanOrEqual(2);
  first.dispose(); expect(release).not.toHaveBeenCalled(); second.dispose(); expect(release).not.toHaveBeenCalled();
  Object.values(materials).forEach(material => material.dispose()); expect(release).toHaveBeenCalledOnce();
});
