import { DMath } from "../../shared/math/deterministic-math";
import { ROAD_RESERVED_HALF_WIDTH } from "../../shared/settlement/road-types";
import { getBuildingDefinition } from "./building-catalog";
import { getPlacedBuildingLogistics, getRomanBuildingGridMetrics } from "./building-grid-metrics";

/** Outside the two-lane road, slightly behind its connection end towards the door. */
export const BUILDING_SIGNPOST_SIDE_OFFSET = ROAD_RESERVED_HALF_WIDTH + 0.06;
export const BUILDING_SIGNPOST_END_SETBACK = 0.5;

/** Shared by rendering and road picking: clicking the post connects its adjacent endpoint. */
export const getPlacedBuildingSignpost = (typeId: number, x: number, z: number, quarterTurns: number) => {
  const definition = getBuildingDefinition(typeId);
  const { logistics } = getRomanBuildingGridMetrics(definition);
  const carrierSide = Math.sign(logistics.carrierApproach[0] - logistics.doorThreshold[0]) || -1;
  const side = -carrierSide;
  const rotation = (((quarterTurns % 4) + 4) % 4) * Math.PI / 2;
  const cosine = Math.round(DMath.cos(rotation)), sine = Math.round(DMath.sin(rotation));
  const { road } = getPlacedBuildingLogistics(typeId, x, z, quarterTurns);
  const lateral = side * BUILDING_SIGNPOST_SIDE_OFFSET;
  const forward = -BUILDING_SIGNPOST_END_SETBACK;
  return {
    road,
    post: { x: road.x + lateral * cosine + forward * sine,
      z: road.z - lateral * sine + forward * cosine },
    rotation,
    side
  };
};
