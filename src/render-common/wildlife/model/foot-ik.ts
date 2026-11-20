import type { Leg, Segment } from "./leg-geometry";

/** Bends smaller than this (radians) count as a straight leg: the fold direction decides. */
const STRAIGHT_BEND = 1e-3;
/** The solved leg never stretches past straight. */
const MAX_REACH = 0.99999;

const getAngle = ([x, y]: Segment) => Math.atan2(y, x);
const getLength = ([x, y]: Segment) => Math.hypot(x, y);

/** Scratch result of solveTwoBone (no allocation): hip and knee channel angles. */
const ikResult = { hip: 0, knee: 0 };

/**
 * Two-bone IK in the side plane: the hip and knee channel angles that put the foot at
 * (`targetX`, `targetY`) relative to the leg top. The knee keeps its current bend direction
 * (continuous: no snapping to the mirrored solution); only an exactly straight leg folds the
 * `foldSign` way. Unreachable targets are clamped to the leg's reach.
 */
export const solveTwoBone = (
  leg: Leg,
  knee: number,
  foldSign: number,
  targetX: number,
  targetY: number
) => {
  const [upper, lower] = leg;
  const upperLength = getLength(upper);
  const lowerLength = getLength(lower);
  const restBend = getAngle(lower) - getAngle(upper);
  const bend = restBend + knee;
  const shortest = Math.abs(upperLength - lowerLength) + 1e-4;
  const distance = Math.min(
    (upperLength + lowerLength) * MAX_REACH,
    Math.max(shortest, Math.hypot(targetX, targetY))
  );
  const cosine =
    (distance * distance - upperLength * upperLength - lowerLength * lowerLength) /
    (2 * upperLength * lowerLength);
  const sign = Math.abs(bend) > STRAIGHT_BEND ? Math.sign(bend) : foldSign;
  const solvedBend = sign * Math.acos(Math.max(-1, Math.min(1, cosine)));
  ikResult.knee = solvedBend - restBend;
  const cos = Math.cos(ikResult.knee);
  const sin = Math.sin(ikResult.knee);
  const footX = upper[0] + lower[0] * cos - lower[1] * sin;
  const footY = upper[1] + lower[0] * sin + lower[1] * cos;
  ikResult.hip = Math.atan2(targetY, targetX) - Math.atan2(footY, footX);
  return ikResult;
};
