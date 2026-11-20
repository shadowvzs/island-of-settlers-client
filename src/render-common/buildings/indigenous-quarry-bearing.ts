import type { BuildingRecipe, Point3 } from "./building-recipe";
import type { RomanWareStockSlot } from "./roman-ware-stock";

export const isIndigenousGraniteQuarry = (recipe: BuildingRecipe) => recipe.parts.some(part =>
  part.architecture && part.surface === "indigenous-rubble") && recipe.parts.some(part =>
  part.stock?.ware === "granite" && part.workyardAssembly === "resource-19");

/** The wider carried granite needs a complete bench bearing, within the existing stock envelope. */
export const withIndigenousGraniteBearing = (recipe: BuildingRecipe): BuildingRecipe => {
  if (!isIndigenousGraniteQuarry(recipe)) return recipe;
  const parts = recipe.parts.map(part => {
    if (part.stock?.ware === "granite" && part.stock.slot >= 3)
      return { ...part, position: [part.position[0], part.position[1] + .10, part.position[2]] as Point3 };
    if (part.stock || part.workyardAssembly !== "resource-19" || part.size[0] < 1) return part;
    return { ...part, position: [part.position[0], part.position[1], .90] as Point3,
      size: [1.10, part.size[1], .40] as Point3 };
  });
  parts.push({ architecture: true, compactGeometry: true, position: [-.53, .535, .90],
    shape: "box", size: [1.10, .03, .40], stage: 3, surface: "wood",
    workyardAssembly: "resource-19" });
  for (const x of [-1.01, -.05]) parts.push({ architecture: true, compactGeometry: true,
    position: [x, .405, .73], shape: "box", size: [.05, .23, .05],
    stage: 2, surface: "wood", workyardAssembly: "resource-19" });
  return { ...recipe, parts };
};

/** Space only this quarry's three granite columns; inventory IDs and canonical carry scale stay fixed. */
export const spaceIndigenousGraniteColumns = (recipe: BuildingRecipe, slots: RomanWareStockSlot[],
  sizes: ReadonlyMap<RomanWareStockSlot, Point3>) => {
  if (!isIndigenousGraniteQuarry(recipe)) return;
  const granite = slots.filter(slot => slot.stock.ware === "granite" &&
    slot.parts.some(part => part.workyardAssembly === "resource-19"));
  const columns = [...new Set(granite.map(slot => slot.center[0]))].sort((a, b) => a - b);
  if (columns.length !== 3) return;
  const middle = (columns[0]! + columns[2]!) / 2;
  const spacing = Math.max(...granite.map(slot => sizes.get(slot)![0])) + .012;
  for (const slot of granite) slot.center[0] = middle + (columns.indexOf(slot.center[0]) - 1) * spacing;
};
