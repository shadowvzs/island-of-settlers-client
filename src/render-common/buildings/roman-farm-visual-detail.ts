import type { BuildingPart, BuildingRecipe } from "./building-recipe";

/** Visual attachments only: applied after all baseline sizing and interaction anchors. */
export const addRomanFarmVisualDetail = (recipe: BuildingRecipe, detailed: boolean) => {
  const add = (part: BuildingPart) => recipe.parts.push(part);
  // Knee braces meet both existing grounded posts and the harvest-bay header.
  for (const [x, side] of [[.24, 1], [1.2, -1]] as const) {
    add({ surface: "wood", shape: "box", stage: 2,
      position: [x + side * .085, .875, .68], size: [.045, .24, .045],
      rotation: [0, 0, -side * Math.PI / 4] });
    if (!detailed) continue;
    for (const [dx, y] of [[0, .79], [side * .17, .96]] as const) {
      add({ surface: "iron", shape: "cylinder", stage: 3,
        position: [x + dx, y, .708], size: [.018, .013, .018],
        rotation: [Math.PI / 2, 0, 0] });
    }
  }
  if (!detailed) return;
  // Timber pegs attach the existing harvest scythe to its stone corner rather than
  // inventing another tool or an extra permanently full grain stock.
  for (const y of [.36, .77]) {
    add({ surface: "wood", shape: "box", stage: 3,
      position: [-1.17, y, .655], size: [.15, .04, .06] });
    add({ surface: "rope", shape: "cord", stage: 3,
      position: [-1.145, y, .704], size: [.095, .018, .018] });
  }
};
