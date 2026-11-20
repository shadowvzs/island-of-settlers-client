import type { BuildingPart, BuildingRecipe } from "../buildings/building-recipe";
import { getRomanPartBounds } from "../buildings/building-recipe-fit";
import { coverRidgeOf, coverSurfaceTop } from "./bird-roof-covers";

/** A free stretch of the highest ridge, in recipe units; `axis` is the ridge's plan axis (0 x, 2 z). */
export interface RoofRidgeSpan {
  axis: 0 | 2;
  centre: [number, number, number];
  length: number;
}

type Bounds = ReturnType<typeof getRomanPartBounds>;
interface Ridge {
  axis: 0 | 2;
  /** Ridge extent along `axis`. */
  end: number;
  /** Coordinate across the ridge: the ridge line itself. */
  line: number;
  part: BuildingPart;
  /** Ridge extent along `axis`. */
  start: number;
  /** Height of the ridge surface. */
  top: number;
}

const RIDGE_SHAPES: ReadonlySet<BuildingPart["shape"]> = new Set(["bevel-box", "box", "cylinder"]);
const MIN_RIDGE = 0.6;
/** A ridge beam is long and slim: thicker pieces are slopes, gables or towers. */
const MAX_RIDGE_SECTION = 0.35;
/** The landing strip either side of the ridge line that must stay clear above the ridge top. */
const STRIP_HALF_WIDTH = 0.14;
/** Clearance kept from a finial, crown piece or chimney standing on the ridge. */
const OBSTACLE_PADDING = 0.06;
/** Taller pieces beside the ridge (towers, spires) put the whole roof off limits. */
const MAX_ORNAMENT_RISE = 0.45;
const TOP_TOLERANCE = 0.01;
/** A piece rising more than this blocks a wider stretch of the ridge. */
const TALL_OBSTACLE_PADDING = 0.16;
/** Pieces at least this share of the longest one compete for the main ridge. */
const MAIN_RIDGE_SHARE = 0.75;
/** Minimal may model the ridge as plain slopes meeting this much lower. */
const MAX_DETAIL_DROP = 0.15;

/** A slim authored ridge beam, in its own rotation. */
const beamRidgeOf = (part: BuildingPart): Ridge | null => {
  if (part.surface !== "roof" || !RIDGE_SHAPES.has(part.shape)) return null;
  const bounds = getRomanPartBounds(part);
  const extentX = bounds.max[0] - bounds.min[0],
    extentZ = bounds.max[2] - bounds.min[2];
  const axis = extentX >= extentZ ? 0 : 2, across = axis === 0 ? 2 : 0;
  const along = Math.max(extentX, extentZ),
    section = Math.min(extentX, extentZ);
  const slim = section <= MAX_RIDGE_SECTION && bounds.max[1] - bounds.min[1] <= MAX_RIDGE_SECTION;
  if (along < MIN_RIDGE || !slim) return null;
  return {
    axis,
    end: bounds.max[axis]!,
    line: (bounds.min[across]! + bounds.max[across]!) / 2,
    part,
    start: bounds.min[axis]!,
    top: bounds.max[1]
  };
};

/** A complete weather cover (occupation, national or indigenous roof) or a slim ridge beam. */
const ridgeOf = (part: BuildingPart): Ridge | null => {
  const cover = coverRidgeOf(part);
  if (cover) return { ...cover, part };
  return beamRidgeOf(part);
};

const alongLength = (ridge: Ridge) => ridge.end - ridge.start;

/** The main ridge: among the longest beams or covers (not crown boxes on them), the highest. */
const mainRidge = (recipe: BuildingRecipe) => {
  const ridges = recipe.parts.flatMap((part) => ridgeOf(part) ?? []);
  const longest = Math.max(0, ...ridges.map(alongLength));
  let best: Ridge | null = null;
  for (const ridge of ridges)
    if (alongLength(ridge) >= longest * MAIN_RIDGE_SHARE && (!best || ridge.top > best.top))
      best = ridge;
  return best;
};

const crossesStrip = (bounds: Bounds, ridge: Ridge) => {
  const across = ridge.axis === 0 ? 2 : 0;
  return bounds.min[across]! < ridge.line + STRIP_HALF_WIDTH &&
    bounds.max[across]! > ridge.line - STRIP_HALF_WIDTH &&
    bounds.min[ridge.axis]! < ridge.end && bounds.max[ridge.axis]! > ridge.start;
};

/** Authored box top, or the rendered crown for a shaped roof cover (never its empty box headroom). */
const partTop = (part: BuildingPart) => coverSurfaceTop(part) ?? getRomanPartBounds(part).max[1];

const isRoofSurface = (part: BuildingPart) =>
  part.surface === "roof" || coverSurfaceTop(part) !== null;

/** Every recipe (Minimal may drop the ridge beam) has its roof right under the ridge line. */
const roofedAlongRidge = (recipe: BuildingRecipe, ridge: Ridge) =>
  recipe.parts.some((part) => {
    if (!isRoofSurface(part)) return false;
    return partTop(part) >= ridge.top - MAX_DETAIL_DROP &&
      crossesStrip(getRomanPartBounds(part), ridge);
  });

/**
 * Intervals along the ridge blocked by pieces rising above it; null when something tall stands
 * beside the ridge (a tower or spire the birds would fly through).
 */
const blockedIntervals = (recipes: readonly BuildingRecipe[], ridge: Ridge) => {
  const blocked: Array<[number, number]> = [];
  for (const recipe of recipes) for (const part of recipe.parts) {
    if (part === ridge.part) continue;
    const rise = partTop(part) - ridge.top;
    if (rise <= TOP_TOLERANCE) continue;
    const tall = rise > MAX_ORNAMENT_RISE, bounds = getRomanPartBounds(part);
    if (!crossesStrip(bounds, ridge)) {
      if (tall) return null;
      continue;
    }
    const padding = tall ? TALL_OBSTACLE_PADDING : OBSTACLE_PADDING;
    blocked.push([bounds.min[ridge.axis]! - padding, bounds.max[ridge.axis]! + padding]);
  }
  return blocked.sort((a, b) => a[0] - b[0]);
};

/** Longest stretch of [from, to] outside the sorted blocked intervals. */
const longestFree = (from: number, to: number, blocked: readonly [number, number][]) => {
  let best: [number, number] = [from, from], cursor = from;
  const keep = (end: number) => {
    if (end - cursor > best[1] - best[0]) best = [cursor, end];
  };
  for (const [start, end] of blocked) {
    keep(Math.min(start, to));
    cursor = Math.max(cursor, end);
  }
  keep(to);
  return best;
};

/**
 * The perch on the main ridge of the High recipe, where every recipe has its roof: the longest
 * stretch clear of anything rising above the ridge (crowns, finials, chimneys, dragon heads, poles).
 */
export const findRoofRidgeSpan = (recipes: readonly BuildingRecipe[]): RoofRidgeSpan | null => {
  const ridge = mainRidge(recipes[0]!);
  if (!ridge) return null;
  if (!recipes.every((recipe) => roofedAlongRidge(recipe, ridge))) return null;
  const blocked = blockedIntervals(recipes, ridge);
  if (!blocked) return null;
  const [start, end] = longestFree(ridge.start, ridge.end, blocked);
  if (end - start < MIN_RIDGE) return null;
  const across = ridge.axis === 0 ? 2 : 0;
  const centre: [number, number, number] = [0, ridge.top, 0];
  centre[ridge.axis] = (start + end) / 2;
  centre[across] = ridge.line;
  return { axis: ridge.axis, centre, length: end - start };
};
