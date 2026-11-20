import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../../src/render-common/buildings/levels/leveled-building-recipe";

const rows = BUILDING_CATALOG.map(definition => {
  const recipe = leveledBuildingRecipe(definition, "indigenous", false, 1);
  return { id: definition.id, name: definition.name,
    hides: recipe.parts.filter(part => part.shape === "indigenous-floor-hide")
      .map(part => ({ position: part.position, size: part.size, bearing: part.position[1] - part.size[1] / 2 })) };
});
console.log(JSON.stringify({ coveredBuildings: rows.filter(row => row.hides.length).length,
  totalHides: rows.reduce((sum, row) => sum + row.hides.length, 0), rows }, null, 2));
