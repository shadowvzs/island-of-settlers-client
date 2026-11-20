import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";

export const JAPANESE_OPEN_WORKSHOPS = [17, 19, 20, 41, 42, 43, 45, 46, 47, 49, 50, 51, 53, 54, 55];

/** Cut the wall and its dressing around each real aperture, keeping the surrounding timber frame.
 * This is deliberately limited to the owner's open workshops and the HQ hall, not paper shoji.
 */
export const clearJapaneseWorkshopWindows = (recipe: BuildingRecipe,
  members: readonly BuildingPart[] = recipe.parts): BuildingRecipe => {
  const panes = recipe.parts.filter(part => part.windowShadow && !part.doorwayShadow && !part.windowShadowDecorative);
  const parts = members.flatMap(part => {
    if (part.stock || part.rotation || part.occupationSign || part.windowShadow || part.stage > 3 ||
      !["box", "bevel-box"].includes(part.shape) ||
      !["plaster", "stone", "cut-stone", "wood", "planks", "paint"].includes(part.surface)) return [part];
    let pieces = [part];
    for (const pane of panes) {
      const at = pane.windowOpeningPosition ?? pane.position, aperture = pane.windowOpeningSize ?? pane.size;
      const across = aperture[0] < aperture[2] ? 0 : 2, along = across === 0 ? 2 : 0;
      if (part.size[across] > .31) continue;
      pieces = pieces.flatMap(piece => {
        if (Math.abs(piece.position[across] - at[across]) > piece.size[across] / 2 + .10) return [piece];
        const left = piece.position[along] - piece.size[along] / 2, right = left + piece.size[along];
        const low = piece.position[1] - piece.size[1] / 2, high = low + piece.size[1];
        const holeLeft = at[along] - aperture[along] / 2, holeRight = at[along] + aperture[along] / 2;
        const holeLow = at[1] - aperture[1] / 2, holeHigh = at[1] + aperture[1] / 2;
        if (right <= holeLeft || left >= holeRight || high <= holeLow || low >= holeHigh) return [piece];
        const sections = [[left, Math.min(right, holeLeft), low, high],
          [Math.max(left, holeRight), right, low, high],
          [Math.max(left, holeLeft), Math.min(right, holeRight), low, Math.min(high, holeLow)],
          [Math.max(left, holeLeft), Math.min(right, holeRight), Math.max(low, holeHigh), high]];
        return sections.filter(([a, b, c, d]) => b! - a! > .001 && d! - c! > .001).map(([a, b, c, d]) => {
          const position: Point3 = [...piece.position], size: Point3 = [...piece.size];
          position[along] = (a! + b!) / 2; position[1] = (c! + d!) / 2;
          size[along] = b! - a!; size[1] = d! - c!;
          return { ...piece, position, size };
        });
      });
    }
    return pieces;
  });
  return { ...recipe, parts };
};
