import { writeFileSync } from "node:fs";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../../src/render-common/buildings/building-world-sizing";
import { createNationBuildingRecipe } from "../../src/render-common/buildings/nation-building-recipe";
import { getRomanWareStockInventoryParts } from "../../src/render-common/buildings/roman-ware-stock";
import { NATION_DRINK_CHAINS } from "../../src/shared/settlement/nation-drinks";

const reports = [];
for (const nation of ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"] as const) {
  const definition = getBuildingDefinition(6), recipe = createNationBuildingRecipe(definition, nation);
  const scale = getRomanBuildingWorldSizing(definition).scale, chain = NATION_DRINK_CHAINS[nation];
  const parts = getRomanWareStockInventoryParts(recipe, scale, { water: 2, [chain.raw]: 2 }, { [chain.drink]: 6 });
  const groups = new Map<string, typeof parts>();
  for (const part of parts) {
    if (!part.stock) continue;
    const key = `${part.stock.kind ?? "output"}:${part.stock.ware}:${part.stock.slot}`;
    const group = groups.get(key) ?? []; group.push(part); groups.set(key, group);
  }
  const bays = [...groups].map(([id, pieces]) => {
    const bounds = pieces.map(piece => getRomanPartBounds(piece));
    return { id, min: [0, 1, 2].map(axis => Math.min(...bounds.map(b => b.min[axis]!))),
      max: [0, 1, 2].map(axis => Math.max(...bounds.map(b => b.max[axis]!))) };
  });
  const overlaps = [];
  for (let a = 0; a < bays.length; a++) for (let b = a + 1; b < bays.length; b++) {
    const first = bays[a]!, second = bays[b]!;
    const overlap = [0, 1, 2].map(axis => Math.min(first.max[axis]!, second.max[axis]!) -
      Math.max(first.min[axis]!, second.min[axis]!));
    if (overlap.every(value => value > .001)) overlaps.push({ first: first.id, second: second.id, overlap });
  }
  reports.push({ nation, scale, bays, overlaps });
}
writeFileSync("/tmp/drink-stock-overlap.json", JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports.map(({ bays, nation, overlaps }) => ({ nation, bays: bays.length, overlaps }))));
