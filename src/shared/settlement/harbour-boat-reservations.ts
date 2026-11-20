import { BOAT_JETTY_DECK_WIDTH } from "../../render-common/ships/lighter-dimensions";
import { sampleSmooth } from "../world/grid-geometry";
import type { BoatJetty } from "./harbour-boat-jetty";
import { distanceToSegmentXZ } from "./settlement-geometry";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { DMath } from "../math/deterministic-math";

/** Derived from finished harbours on restore; never a second saved owner of ground or cargo. */
const providers = new WeakMap<SettlementContext, () => readonly BoatJetty[]>();
export const registerBoatJettyReservations = (context: SettlementContext, sites: () => readonly BoatJetty[]) =>
  providers.set(context, sites);
const distance = (point: SettlementPoint, from: SettlementPoint, to: SettlementPoint) =>
  distanceToSegmentXZ(point.x, point.z, from.x, from.z, to.x, to.z);
/** The finished harbours' boat jetties (none before the naval system registers its provider). */
export const boatJettySites = (context: SettlementContext) => providers.get(context)?.() ?? [];
/** Whether `point` (widened by `radius`) reaches one of the given jetties or their dry approaches. */
const jettyReservedIn = (sites: readonly BoatJetty[], point: SettlementPoint, radius: number) =>
  sites.some(site => {
    if (distance(point, site.foot, site.point) < BOAT_JETTY_DECK_WIDTH / 2 + radius + .12) return true;
    // Retain the validated dry approach, but allow its existing harbour entrance to keep working.
    return site.shoreRoute.some((end, index) => index > 0 &&
      distance(point, site.shoreRoute[index - 1]!, end) < .28 + radius);
  });
export const boatJettyReservedAt = (context: SettlementContext, point: SettlementPoint, radius = 0) =>
  jettyReservedIn(boatJettySites(context), point, radius);
/** The jetties are asked for once per plot: none change while one plot is checked. */
export const boatJettyPlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  if (!providers.has(context)) return null;
  const sites = boatJettySites(context);
  const left = building.x - building.width / 2, top = building.z - building.depth / 2;
  for (let z = top; z < top + building.depth; z++) for (let x = left; x < left + building.width; x++)
    if (jettyReservedIn(sites, { x: x + .5, z: z + .5 }, .71))
      return "Keep the harbour boat jetty and its porter approach clear";
  return jettyReservedIn(sites, building.access, .35) ?
    "Keep the harbour boat jetty and its porter approach clear" : null;
};
/** Dry porter approaches may share normal roads; a road may never consume the actual over-water deck. */
export const boatJettyRoadClear = (context: SettlementContext, points: readonly SettlementPoint[]) => {
  if (!providers.has(context)) return true;
  return points.every((end, index) => {
    if (!index) return true;
    const start = points[index - 1]!, length = DMath.hypot(end.x - start.x, end.z - start.z);
    for (let d = 0; d <= length; d += .2) {
      const share = length ? d / length : 0;
      const point = { x: start.x + (end.x - start.x) * share, z: start.z + (end.z - start.z) * share };
      const world = context.options.world;
      if (sampleSmooth(world, world.heights, point.x, point.z) < world.seaLevel - .02 &&
        boatJettyReservedAt(context, point, .35)) return false;
    }
    return true;
  });
};
