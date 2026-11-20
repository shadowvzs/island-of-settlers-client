import { isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { countGoods } from "./production-rules";
import { buildingNation } from "./settlement-nation";
import { findGroundPath, isGroundSegmentClear } from "./settlement-navigation";
import { stockContact } from "./settlement-stock-transfers";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Only occupied buckets obstruct the route; empty LIFO slots remain accessible. */
export const wellOutputObstacles = (context: SettlementContext, building: SettlementBuilding) =>
  Array.from({ length: countGoods(building.output) }, (_, slot) => {
    const contact = stockContact(context, building, "output", "water", slot);
    if (!contact.scale3) return null;
    // The stock vessel's horizontal half-width plus physical body clearance.
    const radius =
      Math.max(0.17 * (contact.scale3?.x ?? 1), 0.14 * (contact.scale3?.z ?? 1)) +
      WORKER_RADIUS +
      0.015;
    return { x: contact.stock.x, z: contact.stock.z, radius };
  }).filter((bucket): bucket is { x: number; z: number; radius: number } => bucket !== null);

/** Shortest safe local carry leg, without a mandatory signpost/access waypoint. */
export const findWellOutputPath = (
  context: SettlementContext,
  building: SettlementBuilding,
  from: SettlementPoint,
  to: SettlementPoint
) => {
  const buckets = wellOutputObstacles(context, building);
  const blocked = (point: SettlementPoint) =>
    buckets.some((bucket) => DMath.hypot(point.x - bucket.x, point.z - bucket.z) < bucket.radius);
  const courtyard = (point: SettlementPoint) =>
    point.x >= building.x - building.width / 2 &&
    point.x <= building.x + building.width / 2 &&
    point.z >= building.z - building.depth / 2 &&
    point.z <= building.z + building.depth / 2 &&
    (isBuildingCourtyardPointWalkable(35, building.x, building.z, building.rotation, point,
      building.output, building.input, stockStyleFor(buildingNation(context, building), building)));
  if (isGroundSegmentClear(context, from, to, blocked, courtyard)) return [to];
  const path = findGroundPath(context, from, to, blocked, courtyard, 0.125, 4096);
  if (!path) return null;
  const smoothed: SettlementPoint[] = [];
  let cursor = from;
  for (let index = 0; index < path.length;) {
    let end = path.length - 1;
    while (end > index && !isGroundSegmentClear(context, cursor, path[end]!, blocked, courtyard))
      end--;
    smoothed.push(path[end]!);
    cursor = path[end]!;
    index = end + 1;
  }
  return smoothed;
};
