import {
  type BuildingCollisionBox, entrancesIntersectBox, getPlacedBuildingEntranceBounds, placedEntrancesObstructModels
} from "../../render-common/buildings/building-model-clearance";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import type { WorldData } from "../world/world-data";
import { type RoadQueryBox, someRoadInBox } from "./road-proximity-index";
import { ROAD_RESERVED_HALF_WIDTH, type RoadPoint } from "./road-types";
import { getPlacedTreeClearanceBox, someTreeNearPlot } from "./settlement-rotor-clearance";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Road samples along a centreline are this far apart (world cells). */
const ROAD_SAMPLE_STEP = .1;
/** Widens the ground box so rounding in a sample's position never drops a road that reaches an entrance. */
const ROAD_QUERY_MARGIN = 1e-6;

/** Ground box of the entrances, widened by the road's reserved half width: a road outside it cannot reach them. */
const entranceRoadBox = (entrances: readonly BuildingCollisionBox[]): RoadQueryBox => {
  const reach = ROAD_RESERVED_HALF_WIDTH + ROAD_QUERY_MARGIN;
  const box = { maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity };
  for (const { max, min } of entrances) {
    box.minX = Math.min(box.minX, min[0] - reach); box.maxX = Math.max(box.maxX, max[0] + reach);
    box.minZ = Math.min(box.minZ, min[2] - reach); box.maxZ = Math.max(box.maxZ, max[2] + reach);
  }
  return box;
};

/** Whether a road's sampled reserved strip (every `ROAD_SAMPLE_STEP`) overlaps an entrance box. */
const roadSweepsEntrances = (world: WorldData, entrances: readonly BuildingCollisionBox[], box: RoadQueryBox,
  road: { end: RoadPoint; start: RoadPoint }) => {
  const radius = ROAD_RESERVED_HALF_WIDTH;
  const samples = Math.max(1, Math.ceil(DMath.hypot(road.end.x - road.start.x, road.end.z - road.start.z) /
    ROAD_SAMPLE_STEP));
  for (let step = 0; step <= samples; step++) {
    const x = road.start.x + (road.end.x - road.start.x) * step / samples;
    const z = road.start.z + (road.end.z - road.start.z) * step / samples;
    // A sample outside the entrances' ground box cannot overlap them, whatever its height.
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    const height = sampleSmooth(world, world.heights, x, z);
    if (entrancesIntersectBox(entrances, { min: [x - radius, height - .02, z - radius],
      max: [x + radius, height + .06, z + radius] })) return true;
  }
  return false;
};

/** Small external door sweeps stay reserved independently from the compact masonry plot. */
export const entranceClearancePlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  const entrances = getPlacedBuildingEntranceBounds(building);
  for (const existing of context.buildings)
    if (placedEntrancesObstructModels(building, entrances, existing))
      return "Door swing would overlap another building";
  if (!entrances.length) return null;
  const { world } = context.options;
  if (someTreeNearPlot(world, building,
    (index) => entrancesIntersectBox(entrances, getPlacedTreeClearanceBox(world, index))))
    return "Door swing would overlap a tree outside its plot";
  const box = entranceRoadBox(entrances);
  if (someRoadInBox(context.options.roads, box, road => roadSweepsEntrances(world, entrances, box, road)))
    return "Door swing would overlap an existing road";
  return null;
};
