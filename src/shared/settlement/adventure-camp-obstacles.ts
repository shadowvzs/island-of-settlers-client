import type { AdventureCampFrame, CampDecoration } from "../../render-common/adventure/adventure-camp";
import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

export interface CampObstacle {
  x: number; z: number; cosine: number; sine: number; halfX: number; halfZ: number;
  campId: number; kind: "tent" | "palisade";
}
export const CAMP_FOOT_CLEARANCE = .22;
export const CAMP_MOUNTED_CLEARANCE = 1.05;
export const campDecorationObstacle = (camp: AdventureCampFrame, decoration: CampDecoration): CampObstacle | null => {
  if (decoration.kind !== "tent" && decoration.kind !== "palisade") return null;
  const command = decoration.variant === "command", swamp = camp.theme === "swamp";
  let halfX = 1.25, halfZ = .62;
  if (decoration.kind === "tent") {
    halfX = command ? 1.48 : 1.18;
    halfZ = command ? 1.48 : 1.22;
    if (swamp) halfZ = command ? 1.72 : 1.45;
  }
  return { campId: camp.id, kind: decoration.kind, x: camp.x + decoration.x, z: camp.z + decoration.z,
    cosine: DMath.cos(decoration.yaw), sine: DMath.sin(decoration.yaw), halfX, halfZ };
};
/** Signed rectangle distance: negative inside, zero on shell, positive outside. */
export const campObstacleDistance = (obstacle: CampObstacle, point: SettlementPoint) => {
  const dx = point.x - obstacle.x, dz = point.z - obstacle.z;
  const x = Math.abs(dx * obstacle.cosine - dz * obstacle.sine) - obstacle.halfX;
  const z = Math.abs(dx * obstacle.sine + dz * obstacle.cosine) - obstacle.halfZ;
  return DMath.hypot(Math.max(x, 0), Math.max(z, 0)) + Math.min(Math.max(x, z), 0);
};
export interface CampObstacleIndex { obstacles: readonly CampObstacle[]; buckets: ReadonlyMap<number, readonly CampObstacle[]>; width: number }
export const createCampObstacleIndex = (width: number, obstacles: readonly CampObstacle[]): CampObstacleIndex => {
  const buckets = new Map<number, CampObstacle[]>();
  for (const obstacle of obstacles) {
    const reach = DMath.hypot(obstacle.halfX, obstacle.halfZ) + CAMP_MOUNTED_CLEARANCE;
    for (let z = Math.floor(obstacle.z - reach); z <= Math.floor(obstacle.z + reach); z++)
      for (let x = Math.floor(obstacle.x - reach); x <= Math.floor(obstacle.x + reach); x++) {
        if (x < 0 || x >= width || z < 0) continue;
        const key = z * width + x, bucket = buckets.get(key) ?? [];
        bucket.push(obstacle); buckets.set(key, bucket);
      }
  }
  return { width, obstacles, buckets };
};
export const campPointIsClear = (index: CampObstacleIndex, point: SettlementPoint, radius = CAMP_FOOT_CLEARANCE) =>
  !(index.buckets.get(Math.floor(point.z) * index.width + Math.floor(point.x)) ?? [])
    .some(obstacle => campObstacleDistance(obstacle, point) < radius);

/** Legacy saves may contain a unit inside newly solid dressing; permit only outward movement. */
export const campEscape = (index: CampObstacleIndex, from: SettlementPoint, to: SettlementPoint) => {
  let escaping = false;
  for (const obstacle of index.buckets.get(Math.floor(to.z) * index.width + Math.floor(to.x)) ?? []) {
    const end = campObstacleDistance(obstacle, to);
    if (end >= CAMP_FOOT_CLEARANCE) continue;
    const start = campObstacleDistance(obstacle, from);
    if (start >= CAMP_FOOT_CLEARANCE || end <= start + 1e-7) return { allowed: false, escaping: false };
    escaping = true;
  }
  return { allowed: true, escaping };
};

/** Conservative capsule/OBB segment test: the padded shell cannot be jumped by a long step. */
export const campSegmentTouchesObstacle = (obstacle: CampObstacle, from: SettlementPoint, to: SettlementPoint, radius: number) => {
  const local = (point: SettlementPoint) => {
    const dx = point.x - obstacle.x, dz = point.z - obstacle.z;
    return { x: dx * obstacle.cosine - dz * obstacle.sine, z: dx * obstacle.sine + dz * obstacle.cosine };
  };
  const start = local(from), end = local(to);
  let near = 0, far = 1;
  for (const axis of ["x", "z"] as const) {
    const bound = (axis === "x" ? obstacle.halfX : obstacle.halfZ) + radius;
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-9) { if (Math.abs(start[axis]) >= bound) return false; continue; }
    const first = (-bound - start[axis]) / delta, last = (bound - start[axis]) / delta;
    near = Math.max(near, Math.min(first, last)); far = Math.min(far, Math.max(first, last));
    if (near >= far) return false;
  }
  return far > 0 && near < 1;
};
