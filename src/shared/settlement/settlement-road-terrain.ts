import { levelRoadGround } from "./road-ground-leveling";
import type { RoadSegment } from "./road-types";
import { updateSettlementGroundClearance } from "./settlement-ground-clearance";
import type { SettlementContext } from "./settlement-types";

interface RoadGradeSnapshot {
  revision: string;
  network: string;
  heights: Map<number, number>;
  edges?: readonly RoadSegment[];
}
const revisions = new WeakMap<SettlementContext, RoadGradeSnapshot>();

/** Grade once after a road, plot or terrain change; never scan the network every frame. */
export const refreshSettlementRoadTerrain = (context: SettlementContext, force = false) => {
  const { roads, world } = context.options;
  if (!roads.segments) return;
  const revision = () => `${roads.revision ?? 0}:${world.terrainRevision ?? 0}:${context.buildings.length}`;
  const previous = revisions.get(context);
  if (!force && previous?.revision === revision()) return;
  const segments: RoadSegment[] = roads.segments().map(segment => ({ ...segment, tier: segment.tier ?? "dirt" as const }));
  const network = `${roads.revision ?? 0}:${context.buildings.length}`;
  const changedNetwork = force || previous?.network !== network;
  if (changedNetwork) updateSettlementGroundClearance(world, segments, context.buildings);
  // A shovel working elsewhere does not require grading an unchanged road again.
  if (!force && previous?.network === network &&
    [...previous.heights].every(([vertex, height]) => world.heights[vertex] === height)) {
    previous.revision = revision();
    return;
  }
  const region = force && world.settlementRoadTerrainPrepared ? null
    : levelRoadGround(world, segments, context.buildings);
  world.settlementRoadTerrainPrepared = undefined;
  const heights = new Map<number, number>();
  for (const road of segments) {
    if (road.preview || road.doorway) continue;
    // Grading and cubic camber sampling read at most two vertices beyond the road.
    for (let z = Math.max(0, Math.floor(Math.min(road.start.z, road.end.z)) - 2);
      z <= Math.min(world.cellsZ, Math.ceil(Math.max(road.start.z, road.end.z)) + 2); z++)
      for (let x = Math.max(0, Math.floor(Math.min(road.start.x, road.end.x)) - 2);
        x <= Math.min(world.cellsX, Math.ceil(Math.max(road.start.x, road.end.x)) + 2); x++) {
        const vertex = z * (world.cellsX + 1) + x;
        heights.set(vertex, world.heights[vertex]!);
      }
  }
  revisions.set(context, { revision: revision(), network, heights, edges: segments });
  if (!context.restoringRoadDecorations && context.roadDecorations?.hasState()) {
    const edgeKey = (road: RoadSegment) => `${road.start.x}:${road.start.z}/${road.end.x}:${road.end.z}/${road.tier}`;
    const before = new Set((previous?.edges ?? []).map(edgeKey)), after = new Set(segments.map(edgeKey));
    const changed = [...(previous?.edges ?? []).filter(edge => !after.has(edgeKey(edge))),
      ...segments.filter(edge => !before.has(edgeKey(edge)))];
    if (changed.length) context.roadDecorations.changedRoads(changed);
    if (region) context.roadDecorations.changedBounds({ min: [region.minX - 2, -1e6, region.minZ - 2],
      max: [region.maxX + 3, 1e6, region.maxZ + 3] });
  }
  if (region) context.options.onRoadGroundLeveled?.(region);
  else if (changedNetwork && context.buildings.length) {
    // A new plot can cover an old rock without changing road elevations.
    const site = context.buildings.at(-1)!;
    context.options.onRoadGroundLeveled?.({
      minX: Math.max(0, Math.floor(site.x - site.width / 2)),
      minZ: Math.max(0, Math.floor(site.z - site.depth / 2)),
      maxX: Math.min(world.cellsX - 1, Math.ceil(site.x + site.width / 2)),
      maxZ: Math.min(world.cellsZ - 1, Math.ceil(site.z + site.depth / 2))
    });
  }
};
