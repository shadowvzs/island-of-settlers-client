import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { rotateByEuler } from "./recipe-rotation";
import { prepareRomanRoofSilhouette, ROMAN_ROOF_MATERIAL_IDS,romanRoofMaterial } from "./roman-roof-materials";

/** Retain the original roof envelope; replace pottery with layered rural roofing. */
export const applyRomanAlternativeRoof = (id: number, recipe: BuildingRecipe, detailed: boolean) => {
  if (!(ROMAN_ROOF_MATERIAL_IDS as readonly number[]).includes(id)) return;
  prepareRomanRoofSilhouette(id, recipe);
  recipe.parts = recipe.parts.filter(part => !(part.surface === "roof" && part.shape === "tile" &&
    ["roof-shingles", "roof-slate"].includes(romanRoofMaterial(id, part))));
  const planes = recipe.parts.filter(part => part.surface === "roof" && part.shape === "box"
    && part.stage === 4 && part.size[1] < .1);
  for (const part of recipe.parts.filter(part => part.surface === "roof" && part.stage === 4)) {
    part.surface = romanRoofMaterial(id, part);
    if (part.surface === "roof-shingles" && part.shape === "cylinder") part.shape = "box";
  }
  for (const plane of planes) {
    const surface = plane.surface;
    if (!detailed || (surface !== "roof-shingles" && surface !== "roof-slate")) continue;
    const rows = Math.ceil(plane.size[0] / .20);
    const columns = Math.ceil(plane.size[2] / .18);
    const usableWidth = Math.max(.03, plane.size[0] - .045);
    const stepX = usableWidth / rows, stepZ = plane.size[2] / columns;
    const rotation = plane.rotation ?? [0, 0, 0];
    for (let row = 0; row < rows; row++) for (let column = 0; column <= columns; column++) {
      const stagger = row % 2 ? .5 : 0;
      const rawLeft = -plane.size[2] / 2 + (column - stagger) * stepZ;
      const left = Math.max(-plane.size[2] / 2, rawLeft);
      const right = Math.min(plane.size[2] / 2, rawLeft + stepZ);
      if (right - left < .015) continue;
      const seed = ((row * 17 + column * 31) % 23) / 23;
      const offset = rotateByEuler([-usableWidth / 2 + (row + .5) * stepX,
        plane.size[1] / 2 + .006, (left + right) / 2], rotation);
      const tile: BuildingPart = {
        position: plane.position.map((value, axis) => value + offset[axis]!) as Point3,
        rotation, shape: "box", size: [stepX, .014 + seed * .006, right - left - .002],
        stage: 4, surface, tint: [.87 + seed * .18, .89 + seed * .16, .91 + seed * .14],
        topScale: detailed ? [.96 + seed * .035, 1, .95 + seed * .045] : undefined
      };
      recipe.parts.push(tile);
    }
  }
};
