import { mkdirSync, writeFileSync } from "node:fs";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../../src/render-common/buildings/building-world-sizing";
import { createNationBuildingRecipe } from "../../src/render-common/buildings/nation-building-recipe";

const nations = ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"] as const;
const rows = [];
for (const nation of nations) for (const definition of BUILDING_CATALOG) {
  const sizing = getRomanBuildingWorldSizing(definition);
  const recipe = createNationBuildingRecipe(definition, nation, true);
  const candidates = recipe.parts.filter(part => !part.stock &&
    (part.shape === "indigenous-roof" || part.shape === "cylinder" && part.size[1] > .35));
  const forms = candidates.map(part => {
    const bounds = getRomanPartBounds(part);
    return { shape: part.shape, surface: part.surface, position: part.position, size: part.size,
      axisRatio: Math.max(part.size[0], part.size[2]) / Math.min(part.size[0], part.size[2]),
      availableDiameterAtCentre: Math.min(
        sizing.cells[0] / sizing.scale - 2 * Math.abs(part.position[0]),
        sizing.cells[1] / sizing.scale - 2 * Math.abs(part.position[2])),
      bounds };
  }).filter(form => form.axisRatio > 1.15);
  if (!forms.length) continue;
  rows.push({ nation, id: definition.id, name: definition.name,
    reservedCells: sizing.cells, scale: sizing.scale, forms });
}
const destination = "../resources/project-reviews/building-proportions-2026-11-03";
mkdirSync(destination, { recursive: true });
writeFileSync(`${destination}/geometry-audit.json`, JSON.stringify({
  status: "Measured candidates; not a clearance or visual approval",
  note: "Available diameter tests plot boundary only. Stock, door, roof and worker clearance require individual review.",
  inspectedBuildingNationPairs: BUILDING_CATALOG.length * nations.length, rows
}, null, 2));
console.log(JSON.stringify({ inspected: BUILDING_CATALOG.length * nations.length,
  candidateBuildings: rows.length, indigenous: rows.filter(row => row.nation === "indigenous").map(row => ({
    id: row.id, forms: row.forms.map(form => ({ size: form.size, ratio: form.axisRatio,
      diameter: form.availableDiameterAtCentre })) })) }));
