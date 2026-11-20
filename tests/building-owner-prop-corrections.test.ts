import { Box3, Mesh } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createIndustryMechanism } from "../src/renderers/three/buildings/roman-industry-mechanisms";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("supports the armory anvil's actual foot while preserving its work position (%s)", detailed => {
  const recipe = createNationBuildingRecipe(getBuildingDefinition(24), "roman", detailed);
  const anvil = recipe.parts.find(part => part.shape === "anvil")!;
  const stump = recipe.parts.find(part => part.surface === "bark" && part.shape === "cylinder" &&
    Math.abs(part.position[2] - anvil.position[2]) < .01)!;
  expect(anvil.position[0]).toBe(1.15);
  expect(anvil.position[1]).toBeCloseTo(.57);
  expect(anvil.position[2]).toBe(.54);
  // Full heel-side foot, including the bevel, rather than the normal projecting horn.
  for (const x of [-.465, .165]) for (const z of [-.5, .5]) {
    const dx = anvil.position[0] + x * anvil.size[0] - stump.position[0];
    const dz = anvil.position[2] + z * anvil.size[2] - stump.position[2];
    expect(Math.hypot(dx, dz)).toBeLessThan(stump.size[0] / 2);
  }
  expect(stump.position[1] + stump.size[1] / 2).toBeCloseTo(.45);
});

it.each([true, false])("joins the mint hammer handle to its head and strikes the die without the bench (%s)", detailed => {
  const materials = createPlainBuildingMaterials(), root = createIndustryMechanism(34, materials, detailed)!;
  try {
    root.position.set(.76, 1.14 - .06, .5); root.updateMatrixWorld(true);
    const head = root.getObjectByName("mint_hammer_head")!, handle = root.getObjectByName("mint_hammer_handle")!;
    const headBounds = new Box3().setFromObject(head), handleBounds = new Box3().setFromObject(handle);
    expect(headBounds.min.y).toBeCloseTo(.8, 5);
    expect(headBounds.intersectsBox(handleBounds)).toBe(true);
    expect(handleBounds.min.y).toBeGreaterThanOrEqual(.68 - .005);
    expect(root.children).toHaveLength(2);
  } finally {
    root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    Object.values(materials).forEach(material => material.dispose());
  }
});

it.each([true, false])("extends Japanese white tower plaster down to a low real footing (%s)", detailed => {
  for (const id of [4, 9]) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "japanese", detailed);
    expect(recipe.parts.some(part => part.surface === "plaster" && part.stage === 1 &&
      part.position[1] - part.size[1] / 2 <= .13 && part.size[1] > 1)).toBe(true);
    expect(recipe.parts.filter(part => part.surface === "stone" && part.stage === 1 &&
      part.shape === "box" && part.size[1] > .15)).toEqual([]);
  }
});
