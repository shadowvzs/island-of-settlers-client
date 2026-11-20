import type { BuildingRecipe } from "./building-recipe";

/** The whole receiving bench clears the tipi skirt, including its inner rear leg, within the old yard. */
export const withIndigenousTanneryBench=(recipe:BuildingRecipe):BuildingRecipe=>({
  ...recipe,parts:recipe.parts.map(part=>part.workyardAssembly==="tannery-table"?
    {...part,position:[part.position[0],part.position[1],part.position[2]+.33]}:part)
});
