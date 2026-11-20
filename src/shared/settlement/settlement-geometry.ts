import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

/** Planar distance between two settlement points. */
export const distanceBetween = (a: SettlementPoint, b: SettlementPoint) => DMath.hypot(a.x - b.x, a.z - b.z);

/**
 * Clamped fraction of the point (x, z) projected on the segment start + t * (dx, dz); a
 * zero-length segment gives 0 (its start).
 */
export const segmentFraction = (
  x: number, z: number, startX: number, startZ: number, dx: number, dz: number
) => {
  const lengthSquared = dx * dx + dz * dz;
  return lengthSquared
    ? Math.max(0, Math.min(1, ((x - startX) * dx + (z - startZ) * dz) / lengthSquared))
    : 0;
};

/** Planar distance from (x, z) to the point at `fraction` of the segment start + t * (dx, dz). */
export const distanceAtSegmentFraction = (
  x: number, z: number, startX: number, startZ: number, dx: number, dz: number, fraction: number
) => DMath.hypot(x - startX - dx * fraction, z - startZ - dz * fraction);

/** Planar distance from (x, z) to the segment start..end (a zero-length segment is its start). */
export const distanceToSegmentXZ = (
  x: number, z: number, startX: number, startZ: number, endX: number, endZ: number
) => {
  const dx = endX - startX, dz = endZ - startZ;
  return distanceAtSegmentFraction(x, z, startX, startZ, dx, dz, segmentFraction(x, z, startX, startZ, dx, dz));
};

/** Planar distance from a point to the segment start..end (a zero-length segment is its start). */
export const distanceToSegment = (
  point: SettlementPoint,
  start: SettlementPoint,
  end: SettlementPoint
) => distanceToSegmentXZ(point.x, point.z, start.x, start.z, end.x, end.z);

/** `yaw` turned towards `heading` by at most `limit` radians; the result is not wrapped. */
export const turnYawToward = (yaw: number, heading: number, limit: number) =>
  yaw + Math.max(-limit, Math.min(limit, DMath.atan2(DMath.sin(heading - yaw), DMath.cos(heading - yaw))));
