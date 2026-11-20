import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { withChineseBuriedWallFaces } from "./chinese-buried-wall-faces";

/** Chinese lattice belongs to the opening; wall battens and later tier beams do not. */
export const isChineseWindowLattice = (part: BuildingPart, along: 0 | 2, width: number, height: number) =>
  part.stage === 2 && part.surface === "paint" && part.size[along] <= width + .08 &&
  part.size[1] <= height + .08 && Math.min(part.size[along], part.size[1]) <= .035;

/** Open the plaster wall behind the lattice and omit whole redundant crossing wall members.
 * Keeping an entire batten out avoids unsupported little beam ends beside the window.
 * Real door leaves, stocks, roofs, round openings and working equipment retain their geometry.
 */
export const clearChineseWindowMembers = (recipe: BuildingRecipe,
  members: readonly BuildingPart[] = recipe.parts): BuildingRecipe => {
  const panes = recipe.parts.filter(part => part.windowShadow && !part.doorwayShadow &&
    !part.windowShadowDecorative && !part.rotation && part.windowOpeningSize &&
    (part.windowOpeningPosition ?? part.position)[1] > .4 && part.windowOpeningSize[1] > .15 && part.windowOpeningSize[1] <= .7 &&
    Math.min(part.windowOpeningSize[0], part.windowOpeningSize[2]) < .06);
  const blockedSign = recipe.parts.some(part => part.occupationSign && panes.some(pane => {
    const at = pane.windowOpeningPosition!, size = pane.windowOpeningSize!;
    const across = size[0] < size[2] ? 0 : 2, along = across === 0 ? 2 : 0;
    const bounds = getRomanPartBounds(part);
    return Math.abs(part.position[across] - at[across]) < .14 &&
      bounds.max[along] > at[along] - size[along] / 2 && bounds.min[along] < at[along] + size[along] / 2 &&
      bounds.max[1] > at[1] - size[1] / 2 && bounds.min[1] < at[1] + size[1] / 2;
  }));
  const parts = members.flatMap(member => {
    if (member.occupationSign && blockedSign) return [];
    const cardinal = member.rotation?.every(turn => Math.abs(turn / (Math.PI / 2) - Math.round(turn / (Math.PI / 2))) < 1e-8);
    let part = member;
    if (cardinal && ["box", "bevel-box"].includes(member.shape)) {
      const bounds = getRomanPartBounds(member);
      part = { ...member, rotation: undefined,
        position: bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as Point3,
        size: bounds.min.map((value, axis) => bounds.max[axis]! - value) as Point3 };
    }
    if (part.stock || part.catapultPart || part.rotation || part.occupationSign || part.windowShadow ||
      part.occupationRoof || part.stage > 3 || !["box", "bevel-box", "cylinder"].includes(part.shape) ||
      !["plaster", "stone", "cut-stone", "wood", "planks", "paint"].includes(part.surface)) return [member];
    let pieces = [part];
    for (const pane of panes) {
      const at = pane.windowOpeningPosition!, aperture = pane.windowOpeningSize!;
      const across = aperture[0] < aperture[2] ? 0 : 2, along = across === 0 ? 2 : 0;
      if (part.size[across] > .31 || isChineseWindowLattice(part, along, aperture[along], aperture[1])) continue;
      pieces = pieces.flatMap(piece => {
        if (Math.abs(piece.position[across] - at[across]) > piece.size[across] / 2 + .09) return [piece];
        const left = piece.position[along] - piece.size[along] / 2, right = left + piece.size[along];
        const low = piece.position[1] - piece.size[1] / 2, high = low + piece.size[1];
        const holeLeft = at[along] - aperture[along] / 2, holeRight = at[along] + aperture[along] / 2;
        const holeLow = at[1] - aperture[1] / 2, holeHigh = at[1] + aperture[1] / 2;
        if (right <= holeLeft + .001 || left >= holeRight - .001 ||
          high <= holeLow + .001 || low >= holeHigh - .001) return [piece];
        // These are secondary dressing, not the continuous eave/sill frame or corner bearings.
        if (["wood", "planks", "paint"].includes(piece.surface) &&
          (piece.stage > 1 || piece.size[along] < .15 || piece.size[1] < .15)) return [];
        if (piece.shape === "cylinder") return [piece];
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
    return pieces.length === 1 && pieces[0] === part ? [member] : pieces;
  });
  return { ...recipe, parts: withChineseBuriedWallFaces(parts) };
};
