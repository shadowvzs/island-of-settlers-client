import { smoothstep } from "../../../shared/world/noise";
import { SPECIES } from "../wildlife-species";
import type { AnimalMotion } from "./animal-pose";
import { POSE } from "./animal-rig";
import { HIP_SPAN, type Leg, LEG_SEGMENTS, LEGS, type Segment } from "./leg-geometry";

/**
 * A bedded (or rabbit resting) posture. Leg angles are world angles (radians from hanging
 * straight down; hips + forward, front knees fold back -, hocks / heels fold forward +): the
 * body pitch that the drops cause is taken out of the hips, so the folded legs lie on the ground
 * whatever the body does. The front and hind drops (model units) lower each end of the body;
 * their difference pitches it.
 */
export interface RestShape {
  ears: number;
  frontDrop: number;
  frontHip: number;
  frontKnee: number;
  /** Head and neck pitch with the head upright (0) and lowered (1). */
  head: readonly [number, number];
  hindDrop: number;
  hindHip: number;
  hindKnee: number;
  neck: readonly [number, number];
  /** Back arch (+ curls the rump under: a round loaf, sitting on the haunches). */
  spine: number;
}

/**
 * Deer and elk bed in sternal recumbency: the chest rests on the forelegs folded at the knees
 * (cannons tucked back under the chest), the haunches sit on the ground with the hocks out
 * behind and the hind cannons forward along the belly; the rig swings the folded hind legs to
 * one side (hock tuck). The neck stays upright (REST_01) or the head lowers (REST_02).
 */
const CERVID_REST: Record<number, RestShape> = {
  [SPECIES.deer]: {
    ears: 0,
    frontDrop: 0.255,
    frontHip: 0.68,
    frontKnee: -2.42,
    head: [-0.3, -0.25],
    hindDrop: 0.285,
    hindHip: -0.72,
    hindKnee: 1.88,
    neck: [0.2, -0.75],
    spine: 0
  },
  [SPECIES.elk]: {
    ears: 0,
    frontDrop: 0.33,
    frontHip: 0.68,
    frontKnee: -2.44,
    head: [-0.3, -0.2],
    hindDrop: 0.385,
    hindHip: -0.56,
    hindKnee: 1.9,
    neck: [0.18, -0.62],
    spine: 0
  }
};

/** Rabbit resting poses: alert sit, loaf (legs tucked), low crouch, grooming. */
export const REST_KIND = { sit: 0, loaf: 1, crouch: 2, groom: 3 } as const;

/**
 * Rabbit rests, made distinct on the tall hare bind pose: sit upright on the haunches with
 * straight forelegs; loaf low and round with every paw tucked under; crouch flat and long with
 * the forepaws forward, chin low and ears laid back; groom sitting up with the forepaws at the
 * face.
 */
const RABBIT_RESTS: readonly RestShape[] = [
  {
    ears: -0.25,
    frontDrop: 0,
    frontHip: 0.05,
    frontKnee: 0,
    head: [-0.3, -0.4],
    hindDrop: 0.038,
    hindHip: -0.46,
    hindKnee: 1.26,
    neck: [-0.05, -0.15],
    spine: 0.6
  },
  {
    ears: 0.55,
    frontDrop: 0.06,
    frontHip: -1.2,
    frontKnee: 2,
    head: [0.25, 0.15],
    hindDrop: 0.038,
    hindHip: -0.56,
    hindKnee: 1.38,
    neck: [0, -0.1],
    spine: 0.7
  },
  {
    ears: 1.4,
    frontDrop: 0.045,
    frontHip: 1.6,
    frontKnee: -0.1,
    head: [0.3, 0.3],
    hindDrop: 0.05,
    hindHip: -0.46,
    hindKnee: 1.28,
    neck: [-0.55, -0.6],
    spine: -0.15
  },
  {
    ears: 0.2,
    frontDrop: -0.06,
    frontHip: 2.3,
    frontKnee: -2.2,
    head: [-0.8, -0.9],
    hindDrop: 0.038,
    hindHip: -0.34,
    hindKnee: 1.14,
    neck: [-0.3, -0.35],
    spine: 0.6
  }
];

/** The resting shape of a species (rabbits: by rest kind). */
const getRestShape = (species: number, restKind: number) => {
  if (species !== SPECIES.rabbit) return CERVID_REST[species]!;
  return RABBIT_RESTS[restKind] ?? RABBIT_RESTS[REST_KIND.loaf]!;
};

/** Extra lift mid fold (share of the leg length) for the hoof or paw tipping over. */
const HOOF_TIP = 0.06;

/** Share of a nose down body pitch (kneeling on the forelegs) the neck takes back. */
const HEAD_LEVELLING = 0.8;

/** Joint timing within a leg fold (0 .. 1 of the fold -> 0 .. 1 of each joint's angle). */
interface FoldTiming {
  hip: (t: number) => number;
  knee: (t: number) => number;
}

/**
 * The hips swing late, so the feet stay under the body instead of sweeping out behind (no
 * gallop-like mid frames). The front knees bend first (the deer kneels), the hocks evenly, so
 * the front and hind cannons never meet under the belly.
 */
const FRONT_FOLD: FoldTiming = { hip: (t) => t * t, knee: (t) => 1 - (1 - t) * (1 - t) };
const HIND_FOLD: FoldTiming = { hip: (t) => t * t, knee: (t) => t };

/** Height of a segment end once turned by `angle` (+ swings it forward). */
const getTurnedHeight = ([x, y]: Segment, angle: number) => x * Math.sin(angle) + y * Math.cos(angle);

/** How far below the hip the lower of the knee and the foot reaches, folded to world angles. */
const getLegDepth = ([upper, lower]: Leg, hip: number, knee: number) => {
  const kneeHeight = getTurnedHeight(upper, hip);
  return -Math.min(kneeHeight, kneeHeight + getTurnedHeight(lower, hip + knee));
};

/**
 * How far one end of the body is lowered at fold `t` (0 .. 1): the legs keep their ground
 * contact all the way (no limb through the ground while lying down or rising), reaching `drop`
 * when folded; the small mismatch of the stick legs fades out towards standing, and the end
 * stays a little higher mid fold, where the hooves (paws) tip over.
 */
const getEndDrop = (
  [leg, timing]: readonly [Leg, FoldTiming],
  drop: number,
  hip: number,
  knee: number,
  t: number
) => {
  const standing = getLegDepth(leg, 0, 0);
  const folded = drop + getLegDepth(leg, hip, knee);
  const offset = folded - standing;
  const tipping = HOOF_TIP * standing * Math.sin(Math.PI * t);
  const depth = getLegDepth(leg, hip * timing.hip(t), knee * timing.knee(t));
  return folded - depth - (1 - t) * offset - tipping;
};

const add = (out: Float32Array, index: number, value: number) => {
  out[index] = out[index]! + value;
};

const lerpPair = (pair: readonly [number, number], t: number) => pair[0] + (pair[1] - pair[0]) * t;

/** Paw strokes of the grooming pose (the paws rub down the face and rise again). */
const addGrooming = (phase: number, weight: number, out: Float32Array, offset: number) => {
  const stroke = Math.sin(phase) * weight;
  add(out, offset + POSE.frontLeftHip, -0.22 * stroke);
  add(out, offset + POSE.frontRightHip, -0.18 * stroke);
  add(out, offset + POSE.headPitch, -0.1 * stroke);
};

/** Folds one pair of legs to the shape's world angles (body pitch removed). */
const addLegPair = (front: boolean, hip: number, knee: number, out: Float32Array, offset: number) => {
  for (const info of LEGS) {
    if (info.front !== front) continue;
    add(out, offset + info.hip, hip);
    add(out, offset + info.knee, knee);
  }
};

/** Steepest nose-down body pitch while lying down or rising (radians, about 17°). */
export const MAX_REST_NOSE_DOWN = 0.3;
/** Bisection steps that find how far the hindquarters must follow the forelegs. */
const FOLLOW_STEPS = 10;

/**
 * Fold timing: the forelegs lead and the hind end starts early (keyframes), then the
 * hindquarters follow the forelegs closely enough that the body never pitches nose-down past
 * MAX_REST_NOSE_DOWN (the smallest hind fold that keeps the pitch, found by bisection).
 */
const getFolds = (species: number, shape: RestShape, rest: number) => {
  const legs = LEG_SEGMENTS[species]!;
  const front = smoothstep(0, 0.7, rest);
  const frontLeg = [legs.front, FRONT_FOLD] as const;
  const frontLow = getEndDrop(frontLeg, shape.frontDrop, shape.frontHip, shape.frontKnee, front);
  const getHindLow = (t: number) =>
    getEndDrop([legs.hind, HIND_FOLD], shape.hindDrop, shape.hindHip, shape.hindKnee, t);
  const needed = frontLow - HIP_SPAN[species]! * Math.sin(MAX_REST_NOSE_DOWN);
  let hind = smoothstep(0.1, 0.95, rest);
  if (getHindLow(hind) < needed) {
    let low = hind;
    let high = 1;
    for (let step = 0; step < FOLLOW_STEPS; step += 1) {
      const middle = (low + high) / 2;
      if (getHindLow(middle) >= needed) high = middle;
      else low = middle;
    }
    hind = high;
  }
  return { front, frontLow, hind, hindLow: getHindLow(hind) };
};

/**
 * Folds the legs to `shape` at `fold` (0 standing .. 1 folded) with real leg folding: the
 * forelegs fold first and the hindquarters follow closely, then the body settles; rising runs
 * the same path backwards (hind up first, the weight shifting forward onto the forelegs, then
 * up). `headLow` blends the head from upright (0) to lowered (1). Returns the body drop
 * (negative lift, model units).
 */
const addFoldedShape = (
  species: number,
  shape: RestShape,
  fold: number,
  headLow: number,
  out: Float32Array,
  offset: number
) => {
  const { front, frontLow, hind, hindLow } = getFolds(species, shape, fold);
  const pitch = Math.asin(Math.max(-1, Math.min(1, (hindLow - frontLow) / HIP_SPAN[species]!)));
  const spine = shape.spine * hind;
  add(out, offset + POSE.bodyPitch, pitch);
  add(out, offset + POSE.spine, spine);
  const frontHip = shape.frontHip * FRONT_FOLD.hip(front) - pitch;
  addLegPair(true, frontHip, shape.frontKnee * FRONT_FOLD.knee(front), out, offset);
  const hindHip = shape.hindHip * HIND_FOLD.hip(hind) - pitch - spine;
  addLegPair(false, hindHip, shape.hindKnee * HIND_FOLD.knee(hind), out, offset);
  const settled = fold * fold;
  const lowered = headLow * hind * hind;
  const headUp = -Math.min(0, pitch) * HEAD_LEVELLING;
  add(out, offset + POSE.neckPitch, lerpPair(shape.neck, lowered) * settled + headUp);
  add(out, offset + POSE.headPitch, lerpPair(shape.head, lowered) * settled);
  add(out, offset + POSE.earLeft, shape.ears * settled);
  add(out, offset + POSE.earRight, shape.ears * settled * 0.9);
  return -(frontLow + hindLow) * 0.5;
};

/**
 * Adds the resting posture `rest` (0 standing .. 1 bedded) of the animal's rest kind, the head
 * upright or lowered by `restHead`. Returns the body drop (negative lift, model units).
 */
export const addRestPose = (
  species: number,
  motion: AnimalMotion,
  out: Float32Array,
  offset: number
) => {
  const { rest, restHead } = motion;
  if (rest <= 0) return 0;
  const shape = getRestShape(species, motion.restKind);
  const drop = addFoldedShape(species, shape, rest, restHead, out, offset);
  if (species === SPECIES.rabbit && motion.restKind === REST_KIND.groom) {
    addGrooming(motion.chew * 1.3, rest * rest, out, offset);
  }
  return drop;
};

/**
 * A rabbit standing still (foraging, watching) never stands on straight hind legs: the long hind
 * feet lie flat under the haunches (heel at the back of the rump, toes forward), the forelegs
 * stay straight under the chest and the back rounds slightly.
 */
const RABBIT_STANCE: RestShape = {
  ears: 0,
  frontDrop: 0,
  frontHip: 0.05,
  frontKnee: 0,
  head: [0, 0],
  hindDrop: 0.015,
  hindHip: 0.15,
  hindKnee: 1,
  neck: [0, 0],
  spine: 0.1
};
/**
 * Alert: the wild rabbit freezes on the same crouch, neck stretched, head and ears up (it
 * watches before it bolts; it does not rear up).
 */
const RABBIT_ALERT: RestShape = {
  ...RABBIT_STANCE,
  ears: -0.2,
  head: [-0.25, -0.25],
  neck: [0.4, 0.4]
};
/** The stance gives way to a bedded rest over this much of the rest fold. */
const STANCE_REST_FADE = 0.25;
/** Scratch stance between the forage crouch and the alert freeze (no allocation). */
const stance = { ...RABBIT_STANCE, head: [0, 0] as [number, number], neck: [0, 0] as [number, number] };

const STANCE_KEYS = [
  "ears",
  "frontDrop",
  "frontHip",
  "frontKnee",
  "hindDrop",
  "hindHip",
  "hindKnee",
  "spine"
] as const;

const mixNumber = (a: number, b: number, t: number) => a + (b - a) * t;

/** Writes the stance between crouching (0) and the alert freeze (1) into the scratch. */
const blendStance = (alert: number) => {
  for (const key of STANCE_KEYS) {
    stance[key] = mixNumber(RABBIT_STANCE[key], RABBIT_ALERT[key], alert);
  }
  for (let index = 0; index < 2; index += 1) {
    stance.head[index] = mixNumber(RABBIT_STANCE.head[index]!, RABBIT_ALERT.head[index]!, alert);
    stance.neck[index] = mixNumber(RABBIT_STANCE.neck[index]!, RABBIT_ALERT.neck[index]!, alert);
  }
  return stance;
};

/** Adds a rabbit's standing posture while it stands still; returns the body drop. */
export const addRabbitStance = (motion: AnimalMotion, out: Float32Array, offset: number) => {
  const weight = (1 - motion.move) * (1 - smoothstep(0, STANCE_REST_FADE, motion.rest));
  if (weight <= 0) return 0;
  return addFoldedShape(SPECIES.rabbit, blendStance(motion.alert), weight, 0, out, offset);
};
