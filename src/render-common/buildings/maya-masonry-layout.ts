import type { BuildingRecipe } from "./building-recipe";

/** Plain walls, modeled individual stones and horizontal coping need different masonry UVs. */
export const withMayaMasonryLayout = (recipe: BuildingRecipe): BuildingRecipe => ({ ...recipe,
  parts: recipe.parts.map(part => {
    if (part.stock || !["plaster", "stone", "cut-stone"].includes(part.surface) ||
      !["box", "bevel-box", "roof-infill"].includes(part.shape)) return part;
    const length = Math.max(part.size[0], part.size[2]);
    const smallStone = (part.stage ?? 2) >= 2 && part.size[1] < .50 && length < .85;
    const coping = part.size[1] <= .16 && length > .40;
    let mayaMasonryUv: "block" | "course" | "wall" = "wall";
    if (smallStone) mayaMasonryUv = "block";
    else if (coping) mayaMasonryUv = "course";
    return { ...part, mayaMasonryUv };
  })
});
