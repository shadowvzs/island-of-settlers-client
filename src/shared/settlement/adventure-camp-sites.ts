import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

/**
 * Prefer a shared inland area beyond the island centre, towards the shore opposite the landing.
 * Ranking rather than a hard region allows irregular coasts and mountains to use other reachable ground.
 */
export const rankAdventureCampSites = (
  candidates: readonly SettlementPoint[], beach: SettlementPoint, centre: SettlementPoint
) => {
  const target = { x: centre.x + (centre.x - beach.x) * .45,
    z: centre.z + (centre.z - beach.z) * .45 };
  const distance = (point: SettlementPoint) => DMath.hypot(point.x - target.x, point.z - target.z);
  return candidates.map(point => ({ point, distance: distance(point) }))
    .sort((a, b) => a.distance - b.distance || a.point.z - b.point.z || a.point.x - b.point.x)
    .map(entry => entry.point);
};
