import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingNavigationVolume } from "./building-navigation-types";

/** Signed horizontal clearance; negative points are inside the solid. */
export const buildingVolumeClearance = (volume: BuildingNavigationVolume, x: number, z: number) => {
  const cx = (volume.min[0] + volume.max[0]) / 2, cz = (volume.min[2] + volume.max[2]) / 2;
  const cosine = DMath.cos(volume.yaw ?? 0), sine = DMath.sin(volume.yaw ?? 0);
  const dx = (x - cx) * cosine - (z - cz) * sine;
  const dz = (x - cx) * sine + (z - cz) * cosine;
  const rx = (volume.max[0] - volume.min[0]) / 2, rz = (volume.max[2] - volume.min[2]) / 2;
  return localVolumeClearance(dx, dz, rx, rz, volume.shape === "ellipse");
};

/** Snapshot only invariant volume data; discard the evaluator when its synchronous query finishes. */
export const prepareBuildingVolumeClearance = (volume: BuildingNavigationVolume) => {
  const cx = (volume.min[0] + volume.max[0]) / 2, cz = (volume.min[2] + volume.max[2]) / 2;
  const cosine = DMath.cos(volume.yaw ?? 0), sine = DMath.sin(volume.yaw ?? 0);
  const rx = (volume.max[0] - volume.min[0]) / 2, rz = (volume.max[2] - volume.min[2]) / 2;
  const ellipse = volume.shape === "ellipse";
  return (x: number, z: number) => {
    const dx = (x - cx) * cosine - (z - cz) * sine;
    const dz = (x - cx) * sine + (z - cz) * cosine;
    return localVolumeClearance(dx, dz, rx, rz, ellipse);
  };
};

const localVolumeClearance = (dx: number, dz: number, rx: number, rz: number, ellipse: boolean) => {
  if (!ellipse || rx <= 0 || rz <= 0) {
    const qx = Math.abs(dx) - rx, qz = Math.abs(dz) - rz;
    return DMath.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(0, Math.max(qx, qz));
  }
  // Outside: nearest point on the ellipse via monotone Lagrange multiplier. This avoids
  // claiming the empty corners of curved rooms, while preserving a real circular body margin.
  const ax = Math.abs(dx), az = Math.abs(dz), normalized = DMath.hypot(ax / rx, az / rz);
  if (normalized <= 1) return (normalized - 1) * Math.min(rx, rz);
  let low = 0, high = Math.max(rx, rz) * DMath.hypot(ax, az);
  for (let index = 0; index < 20; index++) {
    const mid = (low + high) / 2;
    const nx = rx * ax / (mid + rx * rx), nz = rz * az / (mid + rz * rz);
    if (nx * nx + nz * nz > 1) low = mid; else high = mid;
  }
  return DMath.hypot(ax - rx * rx * ax / (high + rx * rx), az - rz * rz * az / (high + rz * rz));
};
