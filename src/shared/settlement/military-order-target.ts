import { DMath } from "../math/deterministic-math";
import { distanceBetween } from "./settlement-geometry";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** Tiles searched around a clicked target that stands on rock, water or a building. */
const ORDER_TARGET_RADIUS = 8;
/** Clear places tried in turn when the nearest one is cut off from the troops. */
const ORDER_TARGET_ATTEMPTS = 4;


/**
 * Where an order aimed at `point` can end: the point itself when it is open ground, then the
 * nearest open cell centres around it (nearest first), at most `limit` places. A target on a
 * rock, a mine face or a building plot so becomes the nearest walkable place next to it.
 */
export const orderTargetCandidates = (
  context: SettlementContext, point: SettlementPoint, limit = ORDER_TARGET_ATTEMPTS, radius = ORDER_TARGET_RADIUS
): SettlementPoint[] => {
  const clear = isNavigationClear(context, point) ? [{ x: point.x, z: point.z }] : [];
  const cellX = Math.floor(point.x), cellZ = Math.floor(point.z);
  const around: SettlementPoint[] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const cell = { x: cellX + dx + .5, z: cellZ + dz + .5 };
    if (distanceBetween(cell, point) > radius || !isNavigationClear(context, cell)) continue;
    around.push(cell);
  }
  around.sort((a, b) => distanceBetween(a, point) - distanceBetween(b, point));
  return [...clear, ...around].slice(0, limit);
};

/** The nearest place within `radius` tiles where a rider can mount, or null. */
export const nearestMountingPoint = (context: SettlementContext, from: SettlementPoint, radius = 4) => {
  for (let ring = 0; ring <= radius * 2; ring++) for (let step = 0; step < Math.max(1, ring * 6); step++) {
    const angle = step / Math.max(1, ring * 6) * Math.PI * 2, distance = ring * .5;
    const point = { x: from.x + DMath.cos(angle) * distance, z: from.z + DMath.sin(angle) * distance };
    if (isNavigationClear(context, point) && isMountedNavigationClear(context, point)) return point;
  }
  return null;
};
