import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../../src/render-common/buildings/building-recipe";
import { createPersianBuildingRecipe } from "../../src/render-common/buildings/persian-building-recipe";

const buildings = BUILDING_CATALOG.flatMap(definition => {
  const recipe = createPersianBuildingRecipe(createRomanBuildingRecipe(definition, true, false), definition, true);
  const roofs = recipe.parts.filter(part => part.persianRoofPlan).map(part => ({
    position: part.position, size: part.size, rotation: part.rotation, plan: part.persianRoofPlan,
  }));
  return roofs.length ? [{ id: definition.id, name: definition.name, roofs }] : [];
});
const directory = resolve("../resources/project-reviews/nation-expansion-current/persian/roof-join-sheets");
mkdirSync(directory, { recursive: true });
const receipt = { affectedBuildings: buildings.length,
  closedRoofs: buildings.reduce((sum, building) => sum + building.roofs.length, 0),
  preservedApprovedBuildings: [4, 9], strategy: "Existing tiled barrel clipped to actual closed oval wall plan, with opaque cut rim; open supported iwans unchanged.", buildings };
writeFileSync(resolve(directory, "affected-inventory.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
