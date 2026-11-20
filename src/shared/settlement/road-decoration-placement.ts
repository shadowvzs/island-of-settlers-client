import type { Point3 } from "../../render-common/buildings/building-recipe";
import { MOUNTED_NAVIGATION_RADIUS } from "../../render-common/mounts/horse-dimensions";
import { placeRoadDecorationBounds, type RoadDecorationBounds,
  roadDecorationClearance } from "../../render-common/road-decoration-clearance";
import { roadDecorationModelReady } from "../../render-common/road-decoration-readiness";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { getRoadDecoration, ROAD_DECORATION_POT_FOOT } from "./road-decoration-catalog";
import { decorationClearsRoadTraffic } from "./road-decoration-traffic";
import type { RoadPoint, RoadSegment } from "./road-types";

export interface RoadDecorationPlacementRequest {
  decoration: string;
  /** Absolute owned-terrain coordinates, independent of roads. Ground Y is derived canonically. */
  position: RoadPoint;
  yaw: number;
}
export interface RoadDecorationPlacementContext {
  nation: WorkerNation;
  roads: readonly RoadSegment[];
  roadsNear?: (bounds: RoadDecorationBounds) => readonly RoadSegment[];
  heightAt: (x: number, z: number) => number;
  isOwned: (point: RoadPoint) => boolean;
  /** Ground-only reservations such as boat/jetty approaches. */
  canPlaceGround?: (point: RoadPoint) => boolean;
  /** Physical buildings, planted foliage, existing props and reservations, including overhead roofs. */
  isFree: (bounds: RoadDecorationBounds) => boolean;
}
export type RoadDecorationPlacementResult = { ok: false; reason: string } | {
  ok: true; position: Point3; yaw: number; volumes: readonly RoadDecorationBounds[];
  supports: readonly RoadDecorationBounds[];
};

/** Read-only terrain/solid/traffic validation. Roads are obstacles with open portal clearance, never supports. */
export const planRoadDecorationPlacement = (request: RoadDecorationPlacementRequest,
  context: RoadDecorationPlacementContext): RoadDecorationPlacementResult => {
  const definition = getRoadDecoration(request.decoration);
  if (!definition || !roadDecorationModelReady(definition)) return { ok: false, reason: "unknown-decoration" };
  const { position: point, yaw } = request;
  if (![point.x, point.z, yaw].every(Number.isFinite) || point.x < 0 || point.z < 0 || Math.abs(yaw) > Math.PI * 2)
    return { ok: false, reason: "invalid-position" };
  if (!context.isOwned(point)) return { ok: false, reason: "not-owned" };
  if (context.canPlaceGround?.(point) === false) return { ok: false, reason: "reserved-ground-space" };
  const contract = roadDecorationClearance(definition);
  const position: Point3 = [point.x, context.heightAt(point.x, point.z), point.z];
  if (!Number.isFinite(position[1])) return { ok: false, reason: "invalid-ground" };
  if (definition.family === "flower-pot") {
    // Four noncollinear cardinal sole contacts and the centre must share the actual bearing plane.
    const radius = ROAD_DECORATION_POT_FOOT.radius;
    for (const [x, z] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [0, 0]]) {
      const height = context.heightAt(position[0] + x! * Math.cos(yaw) + z! * Math.sin(yaw),
        position[2] - x! * Math.sin(yaw) + z! * Math.cos(yaw));
      if (!Number.isFinite(height) || Math.abs(height - position[1]) > .001)
        return { ok: false, reason: "uneven-support-ground" };
    }
  }
  const volumes = contract.volumes.map(bounds => placeRoadDecorationBounds(bounds, position, yaw));
  const supports = contract.supports.map(bounds => placeRoadDecorationBounds(bounds, position, yaw));
  for (const box of supports) for (const x of [box.min[0], box.max[0]]) for (const z of [box.min[2], box.max[2]]) {
    const height = context.heightAt(x, z);
    if (!Number.isFinite(height) || Math.abs(height - position[1]) > (definition.plant?.potted ? .001 : .025))
      return { ok: false, reason: "uneven-support-ground" };
    if (!context.isOwned({ x, z })) return { ok: false, reason: "not-owned" };
    if (context.canPlaceGround?.({ x, z }) === false) return { ok: false, reason: "reserved-ground-space" };
  }
  const envelope: RoadDecorationBounds = {
    min: [0, 1, 2].map(axis => Math.min(...volumes.map(box => box.min[axis]!))) as Point3,
    max: [0, 1, 2].map(axis => Math.max(...volumes.map(box => box.max[axis]!))) as Point3
  };
  const mountedMargin = definition.plant ? MOUNTED_NAVIGATION_RADIUS : 0;
  if (!decorationClearsRoadTraffic(volumes, context.roadsNear?.(envelope) ?? context.roads, context.heightAt, mountedMargin))
    return { ok: false, reason: "road-traffic-obstructed" };
  if (!volumes.every(context.isFree)) return { ok: false, reason: "decoration-obstructed" };
  return { ok: true, position, yaw, volumes, supports };
};
