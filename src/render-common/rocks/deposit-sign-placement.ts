import { createRoadStripIndex, segmentRectDistance, type StripRect } from "../../shared/settlement/road-reserved-strip";
import { ROAD_RESERVED_HALF_WIDTH, type RoadPoint, type RoadSegment } from "../../shared/settlement/road-types";
import { BLOCKING, BUILD, type MineZone, type WorldData } from "../../shared/world/world-data";
import { type BuildingFrame,getBuildingDefinition } from "../buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../buildings/building-grid-metrics";

/** Includes the board and its ore sample, rather than just the stake. */
const DEPOSIT_SIGN_RADIUS = .3;
const rectAt = ({ x, z }: RoadPoint): StripRect => ({
  bottom: z + DEPOSIT_SIGN_RADIUS, left: x - DEPOSIT_SIGN_RADIUS,
  right: x + DEPOSIT_SIGN_RADIUS, top: z - DEPOSIT_SIGN_RADIUS
});

/** Presentation-only placement: never reserves navigation cells or changes the world. */
export const createDepositSignPlacement = (
  world: WorldData, roads: readonly RoadSegment[], buildings: readonly BuildingFrame[]
) => {
  const strips = createRoadStripIndex({ revision: 0, segments: () => roads });
  const plots = buildings.map(building => {
    const [w, d] = getBuildingDefinition(building.type).gridFootprint;
    const turns = Math.round(building.rotation / (Math.PI / 2));
    const [width, depth] = turns % 2 ? [d, w] : [w, d];
    const { doorThreshold, road } = getPlacedBuildingLogistics(building.type, building.x, building.z, turns);
    return { rect: { bottom: building.z + depth / 2, left: building.x - width / 2,
      right: building.x + width / 2, top: building.z - depth / 2 },
    entrance: { end: road, start: doorThreshold } };
  });
  const clear = (point: RoadPoint) => {
    const x = Math.floor(point.x), z = Math.floor(point.z);
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
    if (world.blocking[z * world.cellsX + x] !== BLOCKING.free) return false;
    // A survey sign is presentation-only, but it still belongs on buildable ground: a mine or
    // its roadside flag is valid; rough terrain and the mountain body are not.
    const build = world.buildCap?.[z * world.cellsX + x] ?? world.buildClass?.[z * world.cellsX + x];
    if (build === undefined || build < BUILD.flag) return false;
    const rect = rectAt(point);
    if (strips.findInRect(rect)) return false;
    return plots.every(plot => segmentRectDistance({ end: point, start: point }, plot.rect) >
      DEPOSIT_SIGN_RADIUS && segmentRectDistance(plot.entrance, rect) >= ROAD_RESERVED_HALF_WIDTH);
  };
  return (zone: MineZone, previous?: RoadPoint, occupied: readonly RoadPoint[] = []) => {
    const free = (point: RoadPoint) => clear(point) && occupied.every(other =>
      Math.hypot(other.x - point.x, other.z - point.z) > DEPOSIT_SIGN_RADIUS * 2);
    if (previous && free(previous)) return previous;
    const candidates: RoadPoint[] = [];
    // Bounded search around the deposit; neighbouring clear ground is allowed when its field is built over.
    for (let z = Math.max(0, Math.floor(zone.centreZ) - 8); z <= Math.min(world.cellsZ - 1, zone.centreZ + 8); z++)
      for (let x = Math.max(0, Math.floor(zone.centreX) - 8); x <= Math.min(world.cellsX - 1, zone.centreX + 8); x++)
        candidates.push({ x: x + .5, z: z + .5 });
    candidates.sort((a, b) => Math.hypot(a.x - zone.centreX, a.z - zone.centreZ) -
      Math.hypot(b.x - zone.centreX, b.z - zone.centreZ) || a.z - b.z || a.x - b.x);
    return candidates.find(free) ?? null;
  };
};
