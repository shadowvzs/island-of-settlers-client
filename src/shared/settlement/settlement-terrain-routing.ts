import { corridorPoints, isSingleLeg, MILITARY_LEG_LENGTH } from "./military-long-routes";
import { withBuildingNavigationSearch, withinBuildingNavigationSearch } from "./settlement-building-navigation";
import {
  findGroundPath, isGroundSegmentClear, isMountedGroundSegmentClear, isMountedNavigationClear, isNavigationClear
} from "./settlement-navigation";
import { groundPath } from "./settlement-paths";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

export { isSingleLeg as isPublicTerrainSingleLeg } from "./military-long-routes";

/** Open ground is crossed in a straight line: grid routes zig-zag, and side by side they collide. */
export const isPublicTerrainLineClear = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted: boolean) => {
  if (!isNavigationClear(context, to)) return false;
  if (!mounted) return isGroundSegmentClear(context, from, to);
  // One search scope for the whole line: the horse clearance fast path gathers its surroundings once.
  return withinBuildingNavigationSearch(context, () =>
    isMountedNavigationClear(context, to) && isMountedGroundSegmentClear(context, from, to));
};

/** One leg of a march: a straight line when open, otherwise the fine search, then the corridor. */
export const publicTerrainLegPath = (
  context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted = false,
  fineSearch: (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => SettlementPoint[] | null =
    (searchContext, start, goal) => groundPath(searchContext, start, goal)
) => {
  if (isPublicTerrainLineClear(context, from, to, mounted)) return [{ x: to.x, z: to.z }];
  const fine = mounted
    ? findGroundPath(context, from, to, point => !isMountedNavigationClear(context, point))
    : fineSearch(context, from, to);
  if (fine) return fine;
  if (!isNavigationClear(context, to) || (mounted && !isMountedNavigationClear(context, to))) return null;
  const points = corridorPoints(context, from, to, mounted);
  return points && followPublicTerrainCorridor(context, from, points, mounted);
};

/** Corridor points lie about a tile apart: a way round a trunk between two is found nearby or not at all. */
const LOCAL_DETOUR_VISITS = 1024;
export const publicTerrainLocalDetour = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted: boolean) =>
  findGroundPath(context, from, to, mounted ? point => !isMountedNavigationClear(context, point) : undefined,
    undefined, .5, LOCAL_DETOUR_VISITS);

/** Corridor points skipped between sight checks (each check samples the whole line). */
const SIGHT_STRIDE = 4;

/**
 * About the furthest of the next leg's worth of corridor points in a clear straight line (−1: none).
 * Searched from the far end, every few points, then the nearest two: a soldier already past a point
 * never turns back for it, and a blocked view costs a handful of line checks, not one per point.
 */
const furthestInSight = (context: SettlementContext, anchor: SettlementPoint,
  via: readonly SettlementPoint[], first: number, mounted: boolean) => {
  const last = Math.min(via.length, first + MILITARY_LEG_LENGTH) - 1;
  for (let index = last; index > first + 1; index -= SIGHT_STRIDE)
    if (isPublicTerrainLineClear(context, anchor, via[index]!, mounted)) return index;
  for (let index = Math.min(first + 1, last); index >= first; index--)
    if (isPublicTerrainLineClear(context, anchor, via[index]!, mounted)) return index;
  return -1;
};

/**
 * A path along corridor points, pulled straight across open ground. Only where even the next point
 * is hidden (a trunk, a corner) does the fine search run, and then over a single tile; a point no
 * way reaches is passed over. Null when the last point cannot be reached.
 */
export const followPublicTerrainCorridor = (context: SettlementContext, from: SettlementPoint,
  via: readonly SettlementPoint[], mounted = false) => {
  const path: SettlementPoint[] = [];
  let anchor = from;
  for (let index = 0; index < via.length;) {
    const next = furthestInSight(context, anchor, via, index, mounted);
    if (next >= 0) { path.push({ ...via[next]! }); anchor = via[next]!; index = next + 1; continue; }
    const detour = publicTerrainLocalDetour(context, anchor, via[index]!, mounted);
    if (detour) { path.push(...detour); anchor = via[index]!; }
    else if (index === via.length - 1) return null;
    index++;
  }
  return path;
};

/**
 * A whole field route. Short ones are a single leg; long ones (across the island) follow the coarse
 * corridor, so the fine search never runs out of budget on a 130+ tile route.
 */
export const publicTerrainPath = (
  context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted = false
): SettlementPoint[] | null => {
  if (isSingleLeg(from, to)) return publicTerrainLegPath(context, from, to, mounted);
  const points = corridorPoints(context, from, to, mounted);
  return points && followPublicTerrainCorridor(context, from, points, mounted);
};

/**
 * A walker's way to a public point: a single leg keeps the fine search; a longer one follows the
 * coarse corridor first, as outdoor work legs do. Across a built-up settlement the fine search runs
 * out of budget, and a stranded walker would retry that failing search for ever.
 */
export const publicWalkPath = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  if (context.options.findWorkerPath || isSingleLeg(from, to)) return groundPath(context, from, to);
  return withBuildingNavigationSearch(context, () =>
    publicTerrainPath(context, from, to) ?? groundPath(context, from, to));
};

