import type { Vec3 } from "./mesh-builder";

/**
 * Resting pose of props that lie on the ground (shore shells): tilted to the terrain normal and
 * lifted until their lowest mesh point touches the rendered surface. Pure, worker safe.
 */

/**
 * Rotation taking the up axis to the unit ground normal (nx, ny, nz) (Rodrigues; ny follows from
 * nx and nz). The instance matrix (three-props writeMatrix) applies the same rotation.
 */
export const applyGroundTilt = (nx: number, nz: number, [x, y, z]: Vec3): Vec3 => {
  const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
  const b = 1 / (1 + ny);
  return [
    (1 - nx * nx * b) * x + nx * y - nx * nz * b * z,
    -nx * x + ny * y - nz * z,
    -nx * nz * b * x + nz * y + (1 - nz * nz * b) * z
  ];
};

/** Mesh point in the world frame around the instance origin: scale, yaw (as writeMatrix), tilt. */
export const placeContactPoint = (point: Vec3, pose: RestPose): Vec3 => {
  const cos = Math.cos(pose.rotation) * pose.scale;
  const sin = Math.sin(pose.rotation) * pose.scale;
  const turned: Vec3 = [cos * point[0] + sin * point[2], point[1] * pose.scale, -sin * point[0] + cos * point[2]];
  return applyGroundTilt(pose.tilt[0], pose.tilt[1], turned);
};

export interface RestPose {
  rotation: number;
  scale: number;
  /** Ground normal x and z. */
  tilt: readonly [number, number];
}

/** Gap kept between the lowest mesh point and the sand (cells). */
export const REST_LIFT = 0.003;

/**
 * Origin height that puts the lowest of the contact points exactly REST_LIFT above the surface
 * (`heightAt`, the rendered terrain height) under each point.
 */
export const getRestHeight = (
  points: readonly Vec3[],
  pose: RestPose,
  at: { x: number; z: number },
  heightAt: (x: number, z: number) => number
) => {
  let origin = -Infinity;
  for (const point of points) {
    const [dx, dy, dz] = placeContactPoint(point, pose);
    origin = Math.max(origin, heightAt(at.x + dx, at.z + dz) - dy);
  }
  return origin + REST_LIFT;
};

/** Vertices of a mesh up to `share` of its height: the candidates for ground contact. */
export const getContactPoints = (positions: Float32Array, height: number, share = 1) => {
  const points: Vec3[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    if (positions[index + 1]! <= height * share) {
      points.push([positions[index]!, positions[index + 1]!, positions[index + 2]!]);
    }
  }
  return points;
};
