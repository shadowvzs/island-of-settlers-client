import type { BuildingPart, BuildingRecipe, BuildingSurface } from "./building-recipe";

export type IndigenousTextileSurface = "hide-hunt" | "hide-mountains" | "hide-reeds" | "hide-sun"
  | "cloth-patched" | "cloth-hide-trim" | "cloth-reeds";

const PATCHED_CANVAS = [6, 10, 11, 12, 13, 17, 19, 24, 28, 32, 39, 58];
const LEATHER_BOUND_CANVAS = [1, 5, 8, 18, 20, 25, 26, 36, 37, 59, 62];

const coverMaterial = (id: number): BuildingSurface => {
  if (PATCHED_CANVAS.includes(id)) return "cloth-patched";
  if (LEATHER_BOUND_CANVAS.includes(id)) return "cloth-hide-trim";
  return "hide";
};

const TEXTILE_GROUPS: ReadonlyArray<readonly [BuildingSurface, readonly number[]]> = [
  ["hide-hunt", [3, 22]],
  ["hide-mountains", [4, 9, 14, 25, 40]],
  ["hide-reeds", [17, 18, 19, 24, 28, 32, 39, 58]],
  ["hide-sun", [0, 5, 20, 26, 36, 37, 59, 62]]
];

/** Most pelts are unpainted; selected occupations carry a single faded nature motif. */
export const indigenousTextileSurface = (id: number): BuildingSurface =>
  TEXTILE_GROUPS.find(([, ids]) => ids.includes(id))?.[0] ?? "hide";

/** Occupation-specific covers; stored textiles and the water-lodge fabric keep their identity. */
export const withIndigenousTextileStyle = (recipe: BuildingRecipe, id: number): BuildingRecipe => {
  if (id === 0) return recipe;
  const material = coverMaterial(id);
  const surface = material === "hide" ? indigenousTextileSurface(id) : material;
  const eligible = (part: BuildingPart) => !part.stock
    && (part.surface === "cloth" || part.surface === "cloth-council");
  const cover = recipe.parts.filter(part => eligible(part)
    && part.shape === "indigenous-roof").reduce<BuildingPart | undefined>((largest, part) => {
      const area = (item: BuildingPart) => (item.size[0] + item.size[2]) * item.size[1];
      return !largest || area(part) > area(largest) ? part : largest;
    }, undefined);
  const parts: BuildingPart[] = recipe.parts.map(part =>
    eligible(part) ? { ...part, surface: part === cover ? surface : material } : part);
  return { ...recipe, parts };
};
