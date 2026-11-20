import type { BuildingPart, BuildingRecipe } from "./building-recipe";

const pitchedPanel = (part: BuildingPart) => !part.stock && part.surface === "roof" &&
  part.shape === "box" && Math.abs(part.rotation?.[2] ?? 0) > .1;

/** A partially raised annex is one roof, not two buildings. Its outer half retains the original eave height. */
export const normalizeMirroredRoofPlan = (recipe: BuildingRecipe): BuildingRecipe => {
  const panels = recipe.parts.filter(pitchedPanel), replacements = new Map<BuildingPart, BuildingPart>();
  for (const panel of panels) {
    if (replacements.has(panel)) continue;
    const partner = panels.find(other => other !== panel && !replacements.has(other) &&
      Math.abs((panel.rotation?.[2] ?? 0) + (other.rotation?.[2] ?? 0)) < .002 &&
      Math.abs((panel.rotation?.[1] ?? 0) - (other.rotation?.[1] ?? 0)) < .002 &&
      Math.abs(panel.position[2] - other.position[2]) < .002 &&
      Math.abs(panel.size[0] - other.size[0]) < .002 && Math.abs(panel.size[2] - other.size[2]) < .002 &&
      Math.abs(panel.position[1] - other.position[1]) > .002 &&
      Math.abs(panel.position[1] - other.position[1]) <= .221 &&
      Math.hypot(panel.position[0] - other.position[0], panel.position[2] - other.position[2]) < panel.size[0] * 1.1);
    if (!partner) continue;
    const y = Math.min(panel.position[1], partner.position[1]);
    for (const part of [panel, partner]) replacements.set(part, { ...part, position: [part.position[0], y, part.position[2]] });
  }
  if (!replacements.size) return recipe;
  return { ...recipe, parts: recipe.parts.map(part => replacements.get(part) ?? part) };
};
