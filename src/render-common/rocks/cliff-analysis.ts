import { normalize, type Vec3 } from "../props/mesh-builder";
import { getGradient, type RockTerrain } from "./rock-terrain";

/** Slope (rise per run) above which the ground is a rock face. */
export const CLIFF_SLOPE = 0.95;
/** Below this slope the ground counts as the plateau above or the floor below a face. */
const FLAT_SLOPE = 0.45;
const MARCH_STEP = 0.2;
const MARCH_LIMIT = 60;

/** One point on a steep face and the face it belongs to. */
export interface FacePoint {
  /** Foot of the face (where the slope flattens out below). */
  base: Vec3;
  /** Face height from foot to lip. */
  height: number;
  /** Horizontal unit vector pointing out of the face (downhill). */
  outward: Vec3;
  position: Vec3;
  slope: number;
  /** Lip of the face (where it flattens out above). */
  top: Vec3;
}

const getSlope = (terrain: RockTerrain, x: number, z: number) =>
  Math.hypot(...getGradient(terrain, x, z));

/** Walks along a horizontal direction until the ground flattens (or the walk gives up). */
const march = (terrain: RockTerrain, start: Vec3, direction: [number, number]): Vec3 => {
  let x = start[0];
  let z = start[2];
  for (let step = 0; step < MARCH_LIMIT; step += 1) {
    if (getSlope(terrain, x, z) < FLAT_SLOPE) break;
    x += direction[0] * MARCH_STEP;
    z += direction[1] * MARCH_STEP;
  }
  return [x, terrain.height(x, z), z];
};

/** Face facts at a point, or null where the ground is not steep enough to be rock. */
export const analyseFacePoint = (
  terrain: RockTerrain,
  x: number,
  z: number,
  minSlope = CLIFF_SLOPE
): FacePoint | null => {
  const [gx, gz] = getGradient(terrain, x, z);
  const slope = Math.hypot(gx, gz);
  if (slope < minSlope) return null;
  const outward = normalize([-gx, 0, -gz]);
  const position: Vec3 = [x, terrain.height(x, z), z];
  const top = march(terrain, position, [-outward[0], -outward[2]]);
  const base = march(terrain, position, [outward[0], outward[2]]);
  return { base, height: Math.max(0.2, top[1] - base[1]), outward, position, slope, top };
};
