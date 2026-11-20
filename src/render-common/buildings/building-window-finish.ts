import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";

interface WindowSite { across: 0 | 2; position: Point3; width: number; height: number }

const FRAME_TONE: Record<WorkerNation, Point3> = {
  roman: [.84, .76, .63], japanese: [.92, .83, .71], chinese: [1.06, .95, .84],
  persian: [.85, .76, .61], maya: [.85, .78, .65], nubian: [.85, .72, .56],
  indigenous: [.92, .83, .68], viking: [.90, .79, .64]
};
const multiply = (a: Point3 | undefined, b: Point3): Point3 =>
  b.map((value, axis) => value * (a?.[axis] ?? 1)) as Point3;

const windowSites = (parts: readonly BuildingPart[]): WindowSite[] => {
  const sites: WindowSite[] = [];
  for (const part of parts) {
    if (part.stock || part.catapultPart) continue;
    if (part.surface === "dark" && part.size[1] > .15 && Math.min(...part.size) < .06) {
      const across = part.size[0] < part.size[2] ? 0 : 2;
      sites.push({ across, position: part.position, width: part.size[across === 0 ? 2 : 0], height: part.size[1] });
    }
    for (const opening of part.persianWindows ?? []) {
      const x = Math.sin(opening.angle), z = Math.cos(opening.angle), across = Math.abs(x) > Math.abs(z) ? 0 : 2;
      const position: Point3 = [part.position[0] + x * part.size[0] / 2,
        part.position[1] + (opening.bottom + opening.spring + opening.rise) * part.size[1] / 2,
        part.position[2] + z * part.size[2] / 2];
      sites.push({ across, position, width: Math.sin(opening.halfAngle) * part.size[across === 0 ? 2 : 0],
        height: (opening.spring + opening.rise - opening.bottom) * part.size[1] });
    }
  }
  return sites;
};

const isWindowFrame = (part: BuildingPart, sites: readonly WindowSite[]) => {
  if (part.stock || part.catapultPart || (part.stage ?? 2) !== 2 || part.surface === "dark" || part.occupationRoof ||
    !["wood", "planks", "bamboo", "plaster", "stone", "cut-stone", "paint"].includes(part.surface) ||
    !["box", "bevel-box", "cylinder"].includes(part.shape)) return false;
  return sites.some(site => {
    const along = site.across === 0 ? 2 : 0;
    if (part.size[site.across] > .19 || Math.abs(part.position[site.across] - site.position[site.across]) > .15) return false;
    if (Math.abs(part.position[along] - site.position[along]) > site.width / 2 + .10 ||
      Math.abs(part.position[1] - site.position[1]) > site.height / 2 + .10) return false;
    return (part.size[along] <= .10 && part.size[1] <= site.height + .22) ||
      (part.size[1] <= .10 && part.size[along] <= site.width + .22);
  });
};

/** A finish-only pass: no panes added, no opening filled, no geometry/anchor/garrison change. */
export const withBuildingWindowFinish = (recipe: BuildingRecipe, nation: WorkerNation): BuildingRecipe => {
  const sites = windowSites(recipe.parts);
  return { ...recipe, parts: recipe.parts.map(part => {
    if (part.stock || part.catapultPart) return part;
    let result = part;
    if (isWindowFrame(part, sites)) result = { ...result, tint: multiply(result.tint, FRAME_TONE[nation]) };
    const masonry = ["stone", "cut-stone", "plaster", "planks", "wood", "paint"].includes(part.surface);
    const wall = (part.stage === 1 && Math.min(part.size[0], part.size[2]) <= .30 && part.size[1] > .25) ||
      part.persianWindows?.length || part.shape === "persian-room";
    if (masonry && wall && !part.occupationRoof) result = { ...result, interiorShade: [.72, .74, .77] };
    return result;
  }) };
};
