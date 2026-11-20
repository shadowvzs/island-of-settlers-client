import type { Random } from "../../shared/world/rng";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { add, pointAlong, randomPerpendicular, scale, subtract } from "../props/tree-parts";
import type { WoodLimb } from "./tree-model";

export interface LimbShape {
  direction: Vec3;
  length: number;
  start: Vec3;
  steps: number;
  /** Pull per step (up for oaks, down at pine branch tips); scaled by the step. */
  tropism: Vec3;
  /** Random bend per step (0 straight .. 0.3 gnarly). */
  wobble: number;
}

/** Polyline of a naturally curving limb: tropism and a little noise turn it step by step. */
export const growLimbPoints = (shape: LimbShape, random: Random): Vec3[] => {
  const points: Vec3[] = [shape.start];
  const step = shape.length / shape.steps;
  let direction = normalize(shape.direction);
  let position = shape.start;
  for (let index = 0; index < shape.steps; index += 1) {
    const noise = scale(randomPerpendicular(direction, random), shape.wobble);
    direction = normalize(add(add(direction, shape.tropism), noise));
    position = add(position, scale(direction, step));
    points.push(position);
  }
  return points;
};

export interface CrookedLimbShape {
  direction: Vec3;
  /** Sudden turns of the limb (radians), each at its own step. */
  elbows: number[];
  length: number;
  /** Vertical pull per step at t (0 base .. 1 tip): negative sags, positive lifts. */
  lift: (t: number) => number;
  start: Vec3;
  steps: number;
  wobble: number;
}

/** Distinct steps for the elbows, away from both ends of the limb. */
const pickElbowSteps = (count: number, steps: number, random: Random) => {
  const picked: number[] = [];
  for (let attempt = 0; picked.length < count && attempt < count * 6; attempt += 1) {
    const step = 2 + Math.floor(random() * Math.max(1, steps - 3));
    if (!picked.includes(step)) picked.push(step);
  }
  return picked.sort((a, b) => a - b);
};

/**
 * A crooked limb: the pull changes along it (rise, sag under its weight, turn up at the tip)
 * and at a few elbows it changes direction abruptly. elbowFractions tell where (0..1), so side
 * branches can leave there.
 */
export const growCrookedLimbPoints = (shape: CrookedLimbShape, random: Random) => {
  const elbowSteps = pickElbowSteps(shape.elbows.length, shape.steps, random);
  const points: Vec3[] = [shape.start];
  const step = shape.length / shape.steps;
  let direction = normalize(shape.direction);
  let position = shape.start;
  for (let index = 0; index < shape.steps; index += 1) {
    const elbow = elbowSteps.indexOf(index);
    if (elbow >= 0) direction = deviate(direction, shape.elbows[elbow]!, random() * Math.PI * 2);
    const noise = scale(randomPerpendicular(direction, random), shape.wobble);
    const lift: Vec3 = [0, shape.lift(index / shape.steps), 0];
    direction = normalize(add(add(direction, lift), noise));
    position = add(position, scale(direction, step));
    points.push(position);
  }
  return { elbowFractions: elbowSteps.map((elbowStep) => elbowStep / shape.steps), points };
};

/** Radius per point: smooth taper (exponent < 1 keeps limbs thick longer, then thins out). */
export const taperRadii = (count: number, base: number, tip: number, exponent = 0.75) =>
  Array.from({ length: count }, (_, index) => {
    const t = Math.pow(index / Math.max(1, count - 1), exponent);
    return base + (tip - base) * t;
  });

/** Value at a fraction of a per-point array (radius, sway). */
export const valueAt = (values: number[], fraction: number) => {
  const position = Math.min(1, Math.max(0, fraction)) * (values.length - 1);
  const index = Math.min(values.length - 2, Math.floor(position));
  return values[index]! + (values[index + 1]! - values[index]!) * (position - index);
};

/** Tangent of a polyline at a fraction of its length. */
export const tangentAt = (points: Vec3[], fraction: number): Vec3 => {
  const ahead = pointAlong(points, Math.min(1, fraction + 0.02));
  const behind = pointAlong(points, Math.max(0, fraction - 0.02));
  return normalize(subtract(ahead, behind));
};

/**
 * Turns `direction` away by `angle` (radians) towards a side picked by `azimuth` (radians
 * around the direction): how a side branch leaves its parent.
 */
export const deviate = (direction: Vec3, angle: number, azimuth: number): Vec3 => {
  const helper: Vec3 = Math.abs(direction[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const side = normalize([
    direction[1] * helper[2] - direction[2] * helper[1],
    direction[2] * helper[0] - direction[0] * helper[2],
    direction[0] * helper[1] - direction[1] * helper[0]
  ]);
  const other = normalize([
    direction[1] * side[2] - direction[2] * side[1],
    direction[2] * side[0] - direction[0] * side[2],
    direction[0] * side[1] - direction[1] * side[0]
  ]);
  const around = add(scale(side, Math.cos(azimuth)), scale(other, Math.sin(azimuth)));
  return normalize(add(scale(direction, Math.cos(angle)), scale(around, Math.sin(angle))));
};

/** Wood limb from points with a taper and its wind weights. */
export const createLimb = (
  points: Vec3[],
  radii: [number, number],
  depth: number,
  sway: [number, number],
  phase: number
): WoodLimb => ({
  depth,
  phase,
  points,
  radii: taperRadii(points.length, radii[0], radii[1]),
  sway
});
