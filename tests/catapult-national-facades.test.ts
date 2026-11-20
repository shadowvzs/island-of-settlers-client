import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { CATAPULT_SHAFT_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const NATIONS: WorkerNation[] = ["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"];
const commonMechanism=(recipe:BuildingRecipe)=>recipe.parts.filter(part=>part.catapultPart||part.stock||part.shape==="catapult-deck");

it.each([true, false])("keeps all eight national catapult facades clear of unchanged mechanics and contacts (%s)", detailed => {
  const baseline = createCatapultTowerRecipe("roman", detailed), definition = getBuildingDefinition(16);
  const { parts: _parts, ...anchors } = baseline;
  for (const nation of NATIONS) {
    const recipe = createCatapultTowerRecipe(nation, detailed), { parts: _nationalParts, ...actualAnchors } = recipe;
    expect(actualAnchors).toEqual(anchors);
    expect(commonMechanism(recipe), `${nation}/mechanics`).toEqual(commonMechanism(baseline));
    const bounds = getRomanRecipeBounds(definition, recipe),sizing=getRomanBuildingWorldSizing(definition);
    expect(definition.gridFootprint).toEqual([5,5]);
    expect(bounds.extentX*sizing.scale).toBeLessThanOrEqual(definition.gridFootprint[0]/2);
    expect(bounds.extentZ*sizing.scale).toBeLessThanOrEqual(definition.gridFootprint[1]/2);
    for (const part of recipe.parts.filter(part => part.architecture)) {
      expect(part.position[1] + part.size[1] / 2).toBeLessThanOrEqual(CATAPULT_SHAFT_HEIGHT + .01);
      expect(part.catapultPart).toBeUndefined(); expect(part.stock).toBeUndefined();
    }
  }
});

it.each([true, false])("keeps all national catapult upgrades inside their existing caps (%s)", detailed => {
  const definition = getBuildingDefinition(16), materials = createPlainBuildingMaterials();
  try {
    for (const nation of NATIONS) for (const level of [3, 5] as const) {
      const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
      const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
      try { expect.soft(model.triangles(false), `${nation}/${level}/${detailed}`)
        .toBeLessThanOrEqual(nationTriangleBudget(nation, 16)[detailed ? 0 : 1]); }
      finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});


it.each([true, false])("checks every national catapult against its unchanged configured mesh cap (%s)", detailed => {
  const definition = getBuildingDefinition(16), materials = createPlainBuildingMaterials();
  try {
    for (const nation of NATIONS) {
      const recipe = createCatapultTowerRecipe(nation, detailed);
      const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
      const count = model.triangles(false); model.dispose();
      console.info(nation, detailed, count);
      expect.soft(count, `${nation}/${detailed}`).toBeLessThanOrEqual(nationTriangleBudget(nation, 16)[detailed ? 0 : 1]);
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
