import { Vector3 } from "three";

/** A 0..1 random source (Math.random in play: bolts are presentation only). */
export type BoltRandom = () => number;

export interface BoltPoint {
  x: number;
  z: number;
}

/** Ground strike (CIN6): segments from the ground up to the cloud base and the cloud base's least lift above it. */
const GROUND_BOLT_STEPS = 28;
const GROUND_BOLT_MIN_LIFT = 22;
/** Sideways wander per segment (world units) of the main channel; it converges onto the struck point. */
const GROUND_BOLT_WANDER = 1.5;
/** Forks of the ground bolt: [segment index from the ground, length in segments]; they end in the air. */
const GROUND_BOLT_FORKS = [[9, 6], [14, 5], [19, 5], [23, 4]] as const;
const FORK_END_LIFT = 3;

/** Weather bolt: hangs between these heights above the ground and never reaches it (the original look). */
const AIR_BOLT_STEPS = 18;
const AIR_BOLT_BOTTOM = 9;
const AIR_BOLT_TOP = 38;
const AIR_BOLT_FORKS = [[6, 5], [10, 4], [13, 3]] as const;
const AIR_FORK_END_LIFT = 5;

/** A fork from `root`, outward and downward like a root, never lower than `floor`. */
const fork = (root: Vector3, count: number, floor: number, random: BoltRandom) => {
  const angle = random() * Math.PI * 2;
  let branch = root.clone();
  const points = [branch];
  for (let step = 1; step <= count; step++) {
    branch = new Vector3(branch.x + Math.cos(angle) * (.55 + random() * .5),
      Math.max(floor, branch.y - .9 - random() * .6),
      branch.z + Math.sin(angle) * (.55 + random() * .5));
    points.push(branch);
  }
  return points;
};

/** The weather bolt: a jagged arc suspended in the air above `ground`, with forks (bottom first). */
export const airBoltPaths = (point: BoltPoint, ground: number, random: BoltRandom): Vector3[][] => {
  const bottom = ground + AIR_BOLT_BOTTOM, top = ground + AIR_BOLT_TOP;
  const main: Vector3[] = [];
  for (let index = 0; index <= AIR_BOLT_STEPS; index++) {
    const t = index / AIR_BOLT_STEPS;
    const jitter = (random() - .5) * (1.25 - t * .75);
    main.push(new Vector3(point.x + jitter, bottom + t * (top - bottom), point.z + jitter * .45));
  }
  return [main, ...AIR_BOLT_FORKS.map(([at, count]) => fork(main[at]!, count, ground + AIR_FORK_END_LIFT, random))];
};

/**
 * The cinematic ground strike: one channel from the cloud base (`cloudHeight`, at least 22 above the surface) down
 * to exactly `point` on `surface`, wandering sideways on the way and converging onto the point, with forks that end
 * in the air. Points run from the ground up (the ribbon is widest at the ground).
 */
export const groundBoltPaths = (point: BoltPoint, surface: number, cloudHeight: number, random: BoltRandom):
  Vector3[][] => {
  const top = Math.max(cloudHeight, surface + GROUND_BOLT_MIN_LIFT);
  let offsetX = 0, offsetZ = 0;
  const fromTop: Vector3[] = [];
  for (let index = 0; index <= GROUND_BOLT_STEPS; index++) {
    const t = index / GROUND_BOLT_STEPS;
    // The wander fades out over the last stretch so the channel lands on the struck point.
    const settle = 1 - t ** 4;
    fromTop.push(new Vector3(point.x + offsetX * settle, top + (surface - top) * t, point.z + offsetZ * settle));
    offsetX += (random() - .5) * GROUND_BOLT_WANDER;
    offsetZ += (random() - .5) * GROUND_BOLT_WANDER;
  }
  const main = fromTop.reverse();
  return [main, ...GROUND_BOLT_FORKS.map(([at, count]) => fork(main[at]!, count, surface + FORK_END_LIFT, random))];
};
