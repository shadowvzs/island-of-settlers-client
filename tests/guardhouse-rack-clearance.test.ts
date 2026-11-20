import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";

it.each([true,false])("keeps Maya barracks decorative arms outside actual structural walls (%s)", detailed => {
  const recipe = createNationBuildingRecipe(getBuildingDefinition(1), "maya", detailed);
  const rack = recipe.parts.filter(part => part.decorativeRack !== undefined);
  if (detailed) expect(rack.length).toBeGreaterThan(0);
  else expect(rack).toEqual([]);
  const walls = recipe.parts.filter(part => part.stage === 1 && !part.stock &&
    ["plaster", "stone", "cut-stone"].includes(part.surface) && part.size[1] > .2);
  const overlaps = rack.flatMap(part => {
    const a = getRomanPartBounds(part);
    return walls.filter(wall => {
      const b = getRomanPartBounds(wall);
      return [0,1,2].every(axis => a.min[axis]! < b.max[axis]! - .003 && a.max[axis]! > b.min[axis]! + .003);
    }).map(wall => ({rack:part.position,wall:wall.position,wallSize:wall.size}));
  });
  expect(overlaps).toEqual([]);
});
