import { clamp, smoothstep } from "../../shared/world/noise";

const TAU = Math.PI * 2;

/** Angle in -PI..PI. */
export const wrapAngle = (angle: number) => angle - TAU * Math.floor((angle + Math.PI) / TAU);

/** Shortest interpolation between two angles. */
export const lerpAngle = (from: number, to: number, amount: number) =>
  from + wrapAngle(to - from) * amount;

/** Moves `value` towards `target` by at most `maxStep`. */
export const approach = (value: number, target: number, maxStep: number) =>
  value + clamp(target - value, -maxStep, maxStep);

/** Exponential smoothing factor for a rate (1/s) over a step: frame rate independent. */
export const smoothingFactor = (rate: number, step: number) => 1 - Math.exp(-rate * step);

/**
 * Turns a heading towards a desired one with a limited turn rate: the path stays a smooth
 * curve, never a sharp corner. Returns the new heading.
 */
export const steerHeading = (heading: number, desired: number, turnRate: number, step: number) =>
  wrapAngle(heading + clamp(wrapAngle(desired - heading), -turnRate * step, turnRate * step));

/**
 * Desired heading of a wandering flock: a wide, slow swing and a small faster weave around its
 * course (noises -1..1). The course itself drifts slowly, so the path meanders but never loops.
 */
export const getMeanderHeading = (course: number, slowNoise: number, fastNoise: number) =>
  wrapAngle(course + slowNoise * 0.8 + fastNoise * 0.2);

/** Turn rate that bends the heading towards the desired one along a smooth curve. */
export const getSteerTurn = (heading: number, desired: number, turnRate: number) =>
  clamp(wrapAngle(desired - heading) * 1.2, -turnRate, turnRate);

/** Roll into a turn (radians): the turn's lateral acceleration, capped at about 50 degrees. */
export const getBankAngle = (turnRate: number, speed: number) =>
  clamp(Math.atan(turnRate * speed * 0.35), -0.85, 0.85);

/** Nose up when climbing, down when descending (radians). */
export const getPitchAngle = (verticalSpeed: number, speed: number) =>
  clamp(Math.atan2(verticalSpeed, Math.max(0.3, speed)), -0.45, 0.45);

/**
 * Takeoff profile 0..1 over its duration: speed ramps up from a third, flapping is strongest at
 * the start and the climb is gradual.
 */
export const getTakeoffProfile = (progress: number) => {
  const t = clamp(progress, 0, 1);
  const ease = t * t * (3 - 2 * t);
  return { climb: 1 - t * 0.6, flapBoost: 1.45 - ease * 0.45, speed: 0.35 + ease * 0.65 };
};

/**
 * Landing approach from the remaining horizontal distance: slower, gliding, a shallow descent
 * that reaches the perch height at the end (`height` 1 = cruise, 0 = perch).
 */
export const getLandingProfile = (distance: number, approachLength: number) => {
  const t = clamp(distance / approachLength, 0, 1);
  return { glide: t < 0.65, height: t * t * (3 - 2 * t), speed: 0.55 + t * 0.45 };
};

/** Wing pose of a flap: angle above the glide pose and how far the wing folds (0..1). */
export interface WingPose {
  angle: number;
  fold: number;
}

/** What a wing pose needs of a species (BirdSpecies). */
export interface WingPoseSpecies {
  flapAmplitude: number;
  glideDihedral: number;
  glideFold: number;
}

/** Held wings still flex a little in the air while gliding (radians). */
const GLIDE_FLEX = 0.035;
/** A full tuck folds the wings this far (0..1) and damps the beat by this share. */
const TUCK_FOLD = 0.75;
const TUCK_DAMP = 0.5;

/**
 * Wing angle and fold at a flap phase: down stroke spread, up stroke partly folded (as real
 * birds do), mixed towards the species' glide pose (dihedral, a slight flex) as `amount` drops
 * (0 = gliding); `tuck` (0..1: tight turns, landing) folds the wings in and flattens the V.
 */
export const getWingPose = (
  phase: number,
  amount: number,
  tuck: number,
  species: WingPoseSpecies,
  target: WingPose
) => {
  const flapping = clamp(amount, 0, 1);
  const amplitude = species.flapAmplitude * (1 - TUCK_DAMP * tuck);
  const flex = Math.sin(phase) * GLIDE_FLEX * (1 - flapping);
  target.angle = species.glideDihedral * (1 - tuck) + Math.sin(phase) * amplitude * flapping + flex;
  const upStroke = Math.max(0, Math.cos(phase)) * 0.35 * flapping;
  const fold = upStroke + species.glideFold * (1 - flapping);
  target.fold = fold + (1 - fold) * TUCK_FOLD * tuck;
  return target;
};

/**
 * How far the wings tuck (0..1): tight turns (a steep bank) fold them partly, a landing bird
 * (settle 0..1, -1 flying) folds them as it drops into the crown or grass.
 */
export const getWingTuck = (bank: number, settle: number) => {
  const turn = smoothstep(0.35, 0.8, Math.abs(bank)) * 0.6;
  return settle < 0 ? turn : Math.max(turn, smoothstep(0, 0.6, settle));
};

/**
 * Next flap amount target: climbing and takeoff flap hard, descents glide, and a species'
 * glide share decides how often level flight coasts.
 */
export const getFlapTarget = (verticalSpeed: number, gliding: boolean, boost: number) => {
  if (boost > 1.05 || verticalSpeed > 0.35) return 1;
  if (verticalSpeed < -0.3 || gliding) return 0;
  return 0.85;
};
