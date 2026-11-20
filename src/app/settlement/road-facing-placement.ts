import { getPlacedBuildingLogistics } from "../../render-common/buildings/building-grid-metrics";
import type { RoadSegment } from "../../shared/settlement/road-types";
import { distanceToSegment } from "../../shared/settlement/settlement-geometry";
import { snapBuildingPlot } from "./building-plot";
import type { PlacementCheck } from "./placement-check";

type Point = { x: number; z: number };
type PublicRoad = Pick<RoadSegment, "start" | "end"> & Partial<Pick<RoadSegment, "doorway" | "preview">>;
const NEAR_ROAD = 2;
const SWITCH_MARGIN = .25;
/** Valid rotations compete only when a real short road connection exists; ties retain the current facing. */
export const roadFacingRotation = (type: number, point: Point, current: number, roads: readonly PublicRoad[],
  check: (rotation: number) => PlacementCheck) => {
  let best = current, bestCost = Infinity, currentCost = Infinity;
  for (const rotation of [current, ...[0, 1, 2, 3].filter(turn => turn !== current)]) {
    const plot = snapBuildingPlot(type, point, rotation);
    const entrance = getPlacedBuildingLogistics(type, plot.x, plot.z, rotation).road;
    if (!roads.some(road => !road.doorway && !road.preview && distanceToSegment(entrance, road.start, road.end) <= NEAR_ROAD)) continue;
    const candidate = check(rotation), path = candidate.ghost.road;
    if (candidate.reason || path == null) continue;
    let cost = 0;
    for (let index = 1; index < path.length; index++)
      cost += Math.hypot(path[index]!.x - path[index - 1]!.x, path[index]!.z - path[index - 1]!.z);
    if (cost > NEAR_ROAD + .5) continue;
    if (rotation === current) currentCost = cost;
    if (cost < bestCost) { bestCost = cost; best = rotation; }
  }
  return bestCost + SWITCH_MARGIN < currentCost ? best : current;
};
