import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

export const ROMAN_ROOF_MATERIAL_IDS = [18, 19, 20, 22, 24, 29, 33, 34, 35, 37] as const;

/** The gable triangles and gable eave boards of a pitched main roof have no place under a hip. */
const isMainGableEnd = (part: BuildingPart, mainX: number) => {
  if (Math.abs(part.position[0] - mainX) >= .01) return false;
  if (part.shape === "gable") return true;
  return part.surface === "stone" && part.stage === 4 && part.size[1] === .045 && part.size[2] === .055;
};

/** Only the main roof is hipped; keep the original open stock shelter and all work anchors. */
const hipMainRoof = (id: number, recipe: BuildingRecipe) => {
  const mainX = id === 29 ? -.32 : -.22;
  const main = recipe.parts.filter(part => part.surface === "roof" && part.stage === 4 && part.shape !== "tile" &&
    part.position[0] < .5);
  if (!main.length) return;
  const bounds = main.map(part => getRomanPartBounds(part));
  const x0 = Math.min(...bounds.map(b => b.min[0])), x1 = Math.max(...bounds.map(b => b.max[0]));
  const z0 = Math.min(...bounds.map(b => b.min[2])), z1 = Math.max(...bounds.map(b => b.max[2]));
  const eave = Math.min(...bounds.map(b => b.min[1]));
  const peak = Math.max(...bounds.map(b => b.max[1]));
  recipe.parts = recipe.parts.filter(part => !(part.surface === "roof" && part.stage === 4 &&
    (id === 34 || part.position[1] > 1.6)) && !isMainGableEnd(part, mainX));
  recipe.parts.push({ surface: "roof", shape: "occupation-roof", occupationRoof: "hip",
    position: [mainX, (eave + peak) / 2, (z0 + z1) / 2],
    size: [x1 - x0, (peak - eave) / .87, z1 - z0], stage: 4 });
};

const shingleWellCanopy = (recipe: BuildingRecipe) => {
  const cover = recipe.parts.filter(part => part.stage === 4 && part.surface === "bark");
  if (!cover.length) return;
  const bounds = cover.map(part => getRomanPartBounds(part));
  const x0 = Math.min(...bounds.map(b => b.min[0])), x1 = Math.max(...bounds.map(b => b.max[0]));
  const z0 = Math.min(...bounds.map(b => b.min[2])), z1 = Math.max(...bounds.map(b => b.max[2]));
  const eave = Math.min(...bounds.map(b => b.min[1]));
  recipe.parts = recipe.parts.filter(part => !cover.includes(part) &&
    !(part.stage === 4 && part.surface === "endgrain"));
  recipe.parts.push({ surface: "roof-shingles", shape: "occupation-roof", occupationRoof: "pyramid",
    position: [(x0 + x1) / 2, eave + .22, (z0 + z1) / 2],
    size: [x1 - x0, .44 / .87, z1 - z0], stage: 4 });
};

export const prepareRomanRoofSilhouette = (id: number, recipe: BuildingRecipe) => {
  if (id === 29 || id === 34) hipMainRoof(id, recipe);
  if (id === 35) shingleWellCanopy(recipe);
};

/**
 * The roof covering of each concept roof. Owner decision 2026-10-12: every Roman roof is terracotta,
 * so the rural concepts keep their flat clay tile courses (shingle and slate layouts) in the shared
 * roof colour; the Farm's former thatch, the ochre smelter and the buff Mint are terracotta too.
 */
export const romanRoofMaterial = (id: number, part: BuildingPart): BuildingPart["surface"] => {
  if ([18, 20, 22, 33, 37].includes(id)) return "roof-shingles";
  if (id === 19) return "roof-slate";
  if (id === 24 && (part.position[0] < .3 ||
    (part.position[0] < .6 && (part.rotation?.[2] ?? 0) < 0))) return "roof-slate";
  return part.surface;
};
