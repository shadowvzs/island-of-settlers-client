import { GARRISON_ARCHER_DEAD_ZONE } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { reachableCells } from "./settlement-colony";
import { buildingFootprint, isUnderWalls } from "./settlement-garrison-archers";
import { distanceBetween, distanceToSegment } from "./settlement-geometry";
import { isNavigationClear } from "./settlement-navigation";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Waiting attackers stand this far apart; three abreast on the line out of the door. */
const QUEUE_SPACING = .8;
const QUEUE_LINE_SLOTS = 9;
/** Free ground searched around the door when the line out of it is blocked (water, cliffs, buildings). */
const QUEUE_SEARCH_RADIUS = 7;
/** Waiting spots keep this clear of the door duel's stance. */
export const QUEUE_DUEL_CLEARANCE = 1.2;
/** Waiting spots keep this clear of the lane between the door and its access point. */
export const QUEUE_LANE_CLEARANCE = .6;
/** Waiting spots under the walls stay this far inside the dead zone, so jostling keeps them sheltered. */
const QUEUE_WALL_MARGIN = .35;
/** Stances of the extra door attackers (tiles out from the door, tiles to the side), best first. */
const DOOR_FLANKS: ReadonlyArray<readonly [number, number]> = [[.45, .6], [.45, -.6], [.85, .55], [.85, -.55]];

export interface SiegeSiteSlots { flanks: SettlementPoint[]; points: SettlementPoint[]; revision: number }

/** Grid points on the queue spacing around the access, covering the walls and the search radius. */
const queueGrid = (site: SettlementBuilding) => {
  const footprint = buildingFootprint(site), reach = GARRISON_ARCHER_DEAD_ZONE;
  const minX = Math.min(footprint.x - footprint.halfWidth - reach, site.access.x - QUEUE_SEARCH_RADIUS);
  const maxX = Math.max(footprint.x + footprint.halfWidth + reach, site.access.x + QUEUE_SEARCH_RADIUS);
  const minZ = Math.min(footprint.z - footprint.halfDepth - reach, site.access.z - QUEUE_SEARCH_RADIUS);
  const maxZ = Math.max(footprint.z + footprint.halfDepth + reach, site.access.z + QUEUE_SEARCH_RADIUS);
  const points: SettlementPoint[] = [];
  const firstX = site.access.x - Math.floor((site.access.x - minX) / QUEUE_SPACING) * QUEUE_SPACING;
  const firstZ = site.access.z - Math.floor((site.access.z - minZ) / QUEUE_SPACING) * QUEUE_SPACING;
  for (let z = firstZ; z <= maxZ; z += QUEUE_SPACING)
    for (let x = firstX; x <= maxX; x += QUEUE_SPACING) points.push({ x, z });
  return points;
};
/** A point `outside` tiles out of the door along its lane and `side` tiles across it. */
export const siegeStance = (site: SettlementBuilding, outside: number, side = 0): SettlementPoint => {
  const dx = site.access.x - site.workerApproach.x, dz = site.access.z - site.workerApproach.z;
  const length = DMath.hypot(dx, dz) || 1;
  return { x: site.workerApproach.x + (dx * outside + dz * side) / length,
    z: site.workerApproach.z + (dz * outside - dx * side) / length };
};
export const queueLineSlot = (site: SettlementBuilding, index: number) =>
  siegeStance(site, 2 + Math.floor(index / 3) * QUEUE_SPACING, ((index % 3) - 1) * QUEUE_SPACING);

/** Waiting slots and flank stances per besieged building, cached until the world's build revision changes. */
export const createSiegeSlots = (context: SettlementContext) => {
  const slotCache = new Map<number, SiegeSiteSlots>();
  /** Reachable free ground that keeps the door duel and the door lane open. */
  const usableSpot = (site: SettlementBuilding, reachable: (point: SettlementPoint) => boolean) => {
    const duel = siegeStance(site, .65);
    return (point: SettlementPoint) => reachable(point) && isNavigationClear(context, point) &&
      distanceBetween(point, duel) >= QUEUE_DUEL_CLEARANCE &&
      distanceToSegment(point, site.workerApproach, site.access) >= QUEUE_LANE_CLEARANCE;
  };
  /**
   * Flank stances of the extra door attackers, and waiting spots: first under the walls (inside the
   * archers' dead zone), nearest the door first so the queue hugs the door side and wraps around the sides;
   * only when those run out the line out of the door and the nearest ground around it, where the
   * building's archers can reach.
   */
  const siteSlots = (site: SettlementBuilding) => {
    const revision = context.options.world.buildRevision ?? 0, cached = slotCache.get(site.uid);
    if (cached?.revision === revision) return cached;
    const reachable = reachableCells(context, site.access);
    const usable = usableSpot(site, reachable), footprint = buildingFootprint(site);
    const sheltered = (point: SettlementPoint) => isUnderWalls(footprint, point.x, point.z, QUEUE_WALL_MARGIN);
    const byDoor = (a: SettlementPoint, b: SettlementPoint) =>
      distanceBetween(a, site.access) - distanceBetween(b, site.access);
    const grid = queueGrid(site).filter(usable);
    const walls = grid.filter(sheltered).sort(byDoor);
    const line = Array.from({ length: QUEUE_LINE_SLOTS }, (_, index) => queueLineSlot(site, index))
      .filter(point => usable(point) && !sheltered(point));
    const around = grid.filter(point => !sheltered(point) &&
      distanceBetween(point, site.access) <= QUEUE_SEARCH_RADIUS &&
      !line.some(slot => distanceBetween(slot, point) < QUEUE_SPACING)).sort(byDoor);
    const flanks = DOOR_FLANKS.map(([outside, side]) => siegeStance(site, outside, side))
      .filter(point => reachable(point) && isNavigationClear(context, point));
    const slots = { flanks, points: [...walls, ...line, ...around], revision };
    slotCache.set(site.uid, slots);
    return slots;
  };
  const forgetSite = (uid: number) => { slotCache.delete(uid); };
  return { forgetSite, siteSlots };
};
