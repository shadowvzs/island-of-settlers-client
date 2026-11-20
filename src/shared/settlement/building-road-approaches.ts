import { ROAD_SPEED } from "@shared/catalog/balance";
import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { usesStorageDoubleDoor } from "../../render-common/buildings/storage-door-profile";
import { DMath } from "../math/deterministic-math";
import { ROAD_TIER_WIDTH, ROAD_WIDTH, type RoadPoint, roadRibbonWidth, type RoadSegment } from "./road-types";
import { distanceAtSegmentFraction, segmentFraction } from "./settlement-geometry";
import { STORAGE_DOOR_APPROACH_WIDTH } from "./settlement-storage-door-lanes";
import type { SettlementBuilding } from "./settlement-types";

type BuildingApproach = Pick<SettlementBuilding,
  "access" | "workerApproach" | "doorThreshold" | "hasDoor"> &
  Partial<Pick<SettlementBuilding, "bandit" | "construction" | "typeId">>;

const pointKey = (point: RoadPoint) => `${point.x}:${point.z}`;

const endpointTiers = (roads: readonly RoadSegment[]) => {
  const endpoints = new Map<string, { tier: RoadSegment["tier"]; preview?: boolean }>();
  for (const segment of roads) {
    for (const point of [segment.start, segment.end]) {
      const previous = endpoints.get(pointKey(point));
      if (previous && ROAD_SPEED[previous.tier] > ROAD_SPEED[segment.tier]) continue;
      endpoints.set(pointKey(point), { tier: segment.tier,
        ...(segment.preview || (previous?.tier === segment.tier && previous.preview) ? { preview: true } : {}) });
    }
  }
  return endpoints;
};

/** Length over which a stone junction narrows into the dirt-width entrance lane. */
export const ENTRANCE_FLARE_LENGTH = 0.45;

/**
 * Entrance lanes keep the dirt width in every tier (they cross the reserved forecourt). Behind a
 * wider stone junction the first piece flares from the junction width down to the lane width.
 */
const entranceLane = (start: RoadPoint, end: RoadPoint, tier: RoadSegment["tier"], doorway: boolean,
  first: boolean, doorwayWidth?: number, laneWidth = ROAD_WIDTH): RoadSegment[] => {
  const junction = ROAD_TIER_WIDTH[tier];
  if (!first || junction <= laneWidth) return [{ start: { ...start }, end: { ...end }, tier, doorway,
    ...(laneWidth > ROAD_WIDTH ? { startWidth: laneWidth, endWidth: laneWidth } : {}),
    ...(doorway ? { doorwayWidth } : {}) }];
  if (doorway) return [{ start: { ...start }, end: { ...end }, tier, doorway, doorwayWidth, startWidth: junction }];
  const length = DMath.hypot(end.x - start.x, end.z - start.z);
  if (length <= ENTRANCE_FLARE_LENGTH)
    return [{ start: { ...start }, end: { ...end }, tier, doorway, endWidth: laneWidth, startWidth: junction }];
  const fraction = ENTRANCE_FLARE_LENGTH / length;
  const middle = { x: start.x + (end.x - start.x) * fraction, z: start.z + (end.z - start.z) * fraction };
  return [
    { start: { ...start }, end: middle, tier, doorway, endWidth: laneWidth, startWidth: junction },
    { start: { ...middle }, end: { ...end }, tier, doorway, endWidth: laneWidth, startWidth: laneWidth }
  ];
};

/** Every placed building shows its own entrance stub; public roads remain player-built. */
export const createBuildingRoadApproaches = (
  roads: readonly RoadSegment[],
  buildings: readonly BuildingApproach[]
): RoadSegment[] => {
  const result = roads.slice();
  const endpoints = endpointTiers(roads);
  for (const building of buildings) {
    if (isOpenArcherTower(building)) continue;
    const connectedRoad = endpoints.get(pointKey(building.access));
    const tier = connectedRoad?.tier ?? "dirt";
    // All nation models retain this canonical clear opening and uniform world scale.
    const geometry = building.hasDoor && building.typeId !== undefined
      ? requireBuildingGeometry(building.typeId) : undefined;
    const doorwayWidth = geometry ? geometry.door.width * geometry.plot.scale : undefined;
    const laneWidth = building.typeId !== undefined && usesStorageDoubleDoor(building.typeId)
      ? STORAGE_DOOR_APPROACH_WIDTH : ROAD_WIDTH;
    const points = [building.access, building.workerApproach, building.doorThreshold];
    let first = true;
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]!, end = points[index]!;
      if (DMath.hypot(end.x - start.x, end.z - start.z) < 0.001) continue;
      const lanes = entranceLane(start, end, tier, building.hasDoor && index === points.length - 1,
        first, doorwayWidth, laneWidth);
      result.push(...(connectedRoad?.preview ? lanes.map(segment => ({ ...segment, preview: true })) : lanes));
      first = false;
    }
  }
  return result;
};

const distanceToRoad = (point: RoadPoint, segment: RoadSegment) => {
  const { start } = segment;
  const dx = segment.end.x - start.x, dz = segment.end.z - start.z;
  const fraction = segmentFraction(point.x, point.z, start.x, start.z, dx, dz);
  return { fraction, distance: distanceAtSegmentFraction(point.x, point.z, start.x, start.z, dx, dz, fraction) };
};

/** Only the physical entrance ribbon inherits the connected junction's stone speed bonus. */
export const buildingRoadApproachSpeedAt = (point: RoadPoint, approaches: readonly RoadSegment[]) => {
  let speed: number = ROAD_SPEED.dirt;
  for (const segment of approaches) {
    if (ROAD_SPEED[segment.tier] <= speed) continue;
    const nearest = distanceToRoad(point, segment);
    if (nearest.distance <= roadRibbonWidth(segment, nearest.fraction) / 2 + 0.01)
      speed = ROAD_SPEED[segment.tier];
  }
  return speed;
};
