import { type GridSize,sampleBilinear } from "../grid-geometry";
import { smoothstep } from "../noise";
import type { RiverCourse } from "./river-course";
import { LEDGE_DROP } from "./river-falls";
import { getMouthDistance, MOUTH_LENGTH, SAMPLE_SPACING } from "./river-line";

const SURFACE_BELOW_GROUND = 0.15;
/** Samples on each side for the fall of the raw surface (its gradient). */
const GRADIENT_REACH = 4;
/** Surface fall per cell from which a stretch is steep: it steps down in falls, cuts a gorge. */
const STEEP_GRADIENT = 0.2;
const GORGE_GRADIENT = 0.45;
/** Height of one fall inside a steep stretch; the reach behind it is level (a terrace). */
const FALL_HEIGHT = 1.1;
/**
 * Surface fall per cell from which a stretch is a cascade (step-pool channel, > ~10 %, Montgomery
 * & Buffington 1997): it steps down over small ledges every one to four channel widths.
 */
const CASCADE_GRADIENT = 0.1;
/** Height of one ledge inside a cascade; the reach behind it is a small plunge pool. */
const LEDGE_HEIGHT = 0.4;
/** No falls this close (height) above the sea: the lower course stays smooth. */
const FALL_ABOVE_SEA = 0.6;

/** Water level following the ground: never rises downstream, never below the sea. */
const createRawProfile = (
  grid: GridSize,
  heights: Float32Array,
  course: RiverCourse,
  seaLevel: number
) => {
  let level = Infinity;
  return Float32Array.from(course.points, (point) => {
    const ground = sampleBilinear(grid, heights, point.x, point.z);
    level = Math.max(seaLevel, Math.min(level, ground - SURFACE_BELOW_GROUND));
    return level;
  });
};

/** Surface fall per cell around each sample. */
const getGradients = (profile: Float32Array) =>
  Float32Array.from(profile, (_, step) => {
    const from = Math.max(0, step - GRADIENT_REACH);
    const to = Math.min(profile.length - 1, step + GRADIENT_REACH);
    return to > from ? (profile[from]! - profile[to]!) / ((to - from) * SAMPLE_SPACING) : 0;
  });

/** Which samples belong to a stretch, how far each step falls and the least drop of its last step. */
interface StepRule {
  height: number;
  isInStretch: (step: number) => boolean;
  /** A shorter last step of a stretch stays sloped (a riffle) below this drop: no stub ledge. */
  minLastDrop: number;
}

/**
 * Stretches become a staircase: level reaches, each at the lowest level of its stretch,
 * separated by drops of about `rule.height`. The level never rises downstream and never lies above
 * the source level, so the reaches cut into the slope (the gorge behind a retreating fall). The
 * spring keeps its level; a spring on steep ground spills over a fall right below it.
 */
const terraceStretches = (source: Float32Array, rule: StepRule) => {
  const profile = Float32Array.from(source);
  let reachStart = -1;
  const closeReach = (end: number, isFull: boolean) => {
    const above = profile[Math.max(0, reachStart - 1)]!;
    if (isFull || above - source[end]! >= rule.minLastDrop) {
      profile.fill(source[end]!, reachStart, end + 1);
    }
    reachStart = -1;
  };
  for (let step = 1; step < source.length; step += 1) {
    if (!rule.isInStretch(step)) {
      if (reachStart >= 0) closeReach(step - 1, false);
      continue;
    }
    if (reachStart < 0) reachStart = step;
    if (source[reachStart]! - source[step]! >= rule.height) closeReach(step, true);
  }
  if (reachStart >= 0) closeReach(source.length - 1, false);
  return profile;
};

const isCascade = (gradient: number) => gradient > CASCADE_GRADIENT && gradient <= STEEP_GRADIENT;

/**
 * Steep stretches step down in falls of FALL_HEIGHT; cascade stretches (step-pool channels) in
 * small ledges of LEDGE_HEIGHT, each ledge with a short pool behind it.
 */
const terraceProfile = (raw: Float32Array, gradients: Float32Array, seaLevel: number) => {
  const isHigh = (step: number) => raw[step]! > seaLevel + FALL_ABOVE_SEA;
  const terraced = terraceStretches(raw, {
    height: FALL_HEIGHT,
    isInStretch: (step) => gradients[step]! > STEEP_GRADIENT && isHigh(step),
    minLastDrop: 0
  });
  return terraceStretches(terraced, {
    height: LEDGE_HEIGHT,
    isInStretch: (step) => isCascade(gradients[step]!) && isHigh(step),
    minLastDrop: LEDGE_DROP
  });
};

export interface RiverProfile {
  /** Gorge strength 0..1 per sample: steep ground, a narrow channel between steep walls. */
  gorge: Float32Array;
  /** Water level per sample. */
  level: Float32Array;
}

/**
 * Water level along the course: follows the ground, steps down in falls over steep stretches and in
 * small ledges over cascades, and sinks into the sea level over the estuary (no step at the sea).
 */
export const createRiverProfile = (
  grid: GridSize,
  heights: Float32Array,
  course: RiverCourse,
  seaLevel: number
): RiverProfile => {
  const raw = createRawProfile(grid, heights, course, seaLevel);
  const gradients = getGradients(raw);
  const terraced = terraceProfile(raw, gradients, seaLevel);
  const level = terraced.map((value, step) => {
    const merge = smoothstep(0, MOUTH_LENGTH, getMouthDistance(step, course.mouthStep));
    return seaLevel + (value - seaLevel) * merge;
  });
  const gorge = gradients.map((gradient) => smoothstep(STEEP_GRADIENT, GORGE_GRADIENT, gradient));
  return { gorge, level };
};
