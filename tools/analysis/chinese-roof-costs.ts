import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../../src/render-common/buildings/building-recipe";
import { createChineseBuildingRecipe } from "../../src/render-common/buildings/chinese-building-recipe";
import { createChinesePanCoverRoof } from "../../src/renderers/three/buildings/chinese-pan-cover-roof";

for (const id of [0, 2, 23, 39, 59, 7]) for (const detailed of [true, false]) {
  const definition = BUILDING_CATALOG.find(building => building.id === id)!;
  const recipe = createChineseBuildingRecipe(createRomanBuildingRecipe(definition, detailed, false), definition, detailed);
  const roofs = recipe.parts.filter(part => part.roofTiles === "pan-cover").map(part => {
    const geometry = createChinesePanCoverRoof(part, detailed), triangles = geometry.index!.count / 3;
    geometry.dispose();
    return { position: part.position, profile: part.occupationRoof, size: part.size, triangles };
  });
  console.log(JSON.stringify({ id, name: definition.name, detailed, roofTriangles: roofs.reduce((n, roof) => n + roof.triangles, 0), roofs }));
}
