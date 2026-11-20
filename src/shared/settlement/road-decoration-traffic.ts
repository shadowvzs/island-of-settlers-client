import { TWO_LANE_CART_HALF_WIDTH } from "../../render-common/logistics/handcart-rules";
import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import { segmentRectDistance } from "./road-reserved-strip";
import type { RoadPoint, RoadSegment } from "./road-types";

/** Existing roads are protected traffic volumes, never an item's support or custody identity. */
export const decorationClearsRoadTraffic = (volumes: readonly RoadDecorationBounds[], roads: readonly RoadSegment[],
  heightAt: (x: number, z: number) => number, minimumHalfWidth = 0) => {
  const half = Math.max(minimumHalfWidth, TWO_LANE_CART_HALF_WIDTH);
  const nodes = new Map<string, RoadPoint & { axes: number }>();
  for (const road of roads) {
    if (road.preview) continue;
    if (!road.doorway) for (const point of [road.start, road.end]) {
      const key = `${point.x}:${point.z}`, node = nodes.get(key) ?? { ...point, axes: 0 };
      node.axes |= road.start.x === road.end.x ? 1 : 2; nodes.set(key, node);
    }
    for (const box of volumes) {
      const rect = { left: box.min[0], right: box.max[0], top: box.min[2], bottom: box.max[2] };
      if (segmentRectDistance(road, rect) >= half - 1e-6) continue;
      const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = dx * dx + dz * dz;
      const cx = (rect.left + rect.right) / 2, cz = (rect.top + rect.bottom) / 2;
      const t = length ? Math.max(0, Math.min(1, ((cx - road.start.x) * dx + (cz - road.start.z) * dz) / length)) : 0;
      const ground = heightAt(road.start.x + dx * t, road.start.z + dz * t);
      if (!Number.isFinite(ground) || (box.min[1] < ground + 2.1 - 1e-6 && box.max[1] > ground + .005)) return false;
    }
  }
  // Turning/yield pockets are real traffic clearance, independent of decoration attachment.
  for (const node of nodes.values()) if (node.axes === 3) {
    const ground = heightAt(node.x, node.z);
    for (const box of volumes) {
      if (box.min[1] >= ground + 2.1 - 1e-6 || box.max[1] <= ground + .005) continue;
      const dx = Math.max(box.min[0] - node.x, 0, node.x - box.max[0]);
      const dz = Math.max(box.min[2] - node.z, 0, node.z - box.max[2]);
      if (Math.hypot(dx, dz) < 1.4) return false;
    }
  }
  return true;
};

/** A nearby road supplies optional angle assistance; free placement works without any road. */
export const nearbyDecorationRoadYaw = (point: RoadPoint,
  roads: readonly (Pick<RoadSegment, "start" | "end"> & Partial<Pick<RoadSegment, "preview" | "doorway">>)[], maximum = 1.5) => {
  let distance = maximum, yaw: number | undefined;
  for (const road of roads) {
    if (road.preview || road.doorway) continue;
    const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = dx * dx + dz * dz;
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((point.x - road.start.x) * dx + (point.z - road.start.z) * dz) / length));
    const gap = Math.hypot(point.x - road.start.x - t * dx, point.z - road.start.z - t * dz);
    if (gap >= distance) continue;
    distance = gap; yaw = Math.atan2(dx, dz);
  }
  return yaw;
};
