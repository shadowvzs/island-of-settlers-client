import type { WorldData } from "../world/world-data";
import { ROAD_TIER_WIDTH, type RoadSegment } from "./road-types";
import { distanceToSegmentXZ } from "./settlement-geometry";
import type { SettlementBuilding } from "./settlement-types";

/** How far from its centre line a road clears ground (its tier width plus a verge). */
export const roadClearanceRadius = (road: { tier?: RoadSegment["tier"] }) => ROAD_TIER_WIDTH[road.tier ?? "dirt"] / 2 + .72;

/** Derived settlement ground shared with loading/edit workers; never stored as authored map data. */
export const updateSettlementGroundClearance = (
  world: WorldData, roads: readonly RoadSegment[], buildings: readonly SettlementBuilding[]
) => {
  const cells = world.clearedStoneGround?.slice() ?? new Uint8Array(world.cellsX * world.cellsZ);
  const fill = (minX: number, minZ: number, maxX: number, maxZ: number,
    includes: (x: number, z: number) => boolean = () => true) => {
    for (let z = Math.max(0, Math.floor(minZ)); z < Math.min(world.cellsZ, Math.ceil(maxZ)); z++)
      for (let x = Math.max(0, Math.floor(minX)); x < Math.min(world.cellsX, Math.ceil(maxX)); x++)
        if (includes(x + .5, z + .5)) cells[z * world.cellsX + x] = 1;
  };
  for (const building of buildings)
    fill(building.x - building.width / 2, building.z - building.depth / 2,
      building.x + building.width / 2, building.z + building.depth / 2);
  for (const road of roads) {
    if (road.preview) continue;
    const radius = roadClearanceRadius(road);
    fill(Math.min(road.start.x, road.end.x) - radius, Math.min(road.start.z, road.end.z) - radius,
      Math.max(road.start.x, road.end.x) + radius, Math.max(road.start.z, road.end.z) + radius,
      (x, z) => distanceToSegmentXZ(x, z, road.start.x, road.start.z, road.end.x, road.end.z) <= radius);
  }
  world.clearedStoneGround = cells;
  world.settlementGroundClearance = cells;
};

/** Conservative footprint overlap: a rock's full body stays clear, including its tilted axes. */
export const overlapsSettlementGround = (
  world: WorldData, minX: number, minZ: number, maxX: number, maxZ: number
) => {
  const cells = world.settlementGroundClearance ?? world.clearedStoneGround;
  if (!cells) return false;
  for (let z = Math.max(0, Math.floor(minZ)); z < Math.min(world.cellsZ, Math.ceil(maxZ)); z++)
    for (let x = Math.max(0, Math.floor(minX)); x < Math.min(world.cellsX, Math.ceil(maxX)); x++)
      if (cells[z * world.cellsX + x]) return true;
  return false;
};
