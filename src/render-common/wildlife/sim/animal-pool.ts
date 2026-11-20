import { POSE_CHANNELS } from "../model/animal-rig";
import { MAX_PATH_POINTS } from "../nav/nav-path";

/** Animals drawn at once at most (the awake ones near the view). */
export const MAX_VISIBLE_ANIMALS = 64;

/** What a scheduled reaction turns into once its delay has passed. */
export const REACTION = { none: 0, alert: 1, flee: 2 } as const;

/**
 * Every animal as a struct of arrays (fixed capacity, nothing allocated while running). The
 * hunter facing API reads position (x, z), velocity, species, state, health, alertLevel and the
 * threat; the navigation agent is the path, target and home of a slot.
 */
export interface AnimalPool {
  active: Uint8Array;
  /** Reserved living population, awaiting its staggered appearance (no AI or collision yet). */
  pending: Uint8Array;
  arrivalTime: Float32Array;
  /** Ordinary removal visual only; no living population, hunting or collision. */
  departing: Uint8Array;
  /** Normalised age: 0 newborn .. 1 fully grown (life stage, size, speed, coat, antlers). */
  age: Float32Array;
  /** 0 calm .. 1 panicking (decays while no new threat arrives). */
  alertLevel: Float32Array;
  /** 0 .. 1 visual opacity during appearance and ordinary departure. */
  appear: Float32Array;
  /** Seconds until the next AI decision (distance based rate). */
  aiTimer: Float32Array;
  /** Seconds the last moves were blocked (stuck detection). */
  blocked: Float32Array;
  /** Body scale: individual size times the size of its age (collision capsule, render). */
  bodyScale: Float32Array;
  /**
   * 1 while a killed animal's body is still there (falling, lying, fading); it is no longer
   * `active`: no AI, no collider, no herd mate.
   */
  carcass: Uint8Array;
  /** Coat of the individual (rabbits): archetype, patch pattern, patch seed, ear darkness. */
  coat: Float32Array;
  /** Adult deer with faint dapples (coat variety). */
  dappled: Uint8Array;
  /** Body type (rabbits: 0 lean, 1 compact). */
  form: Uint8Array;
  /** Seconds since the kill (carcass timing). */
  deathTime: Float32Array;
  /** Group leader slot (herd / family), the slot itself for leaders and loners. */
  group: Int16Array;
  heading: Float32Array;
  desiredHeading: Float32Array;
  health: Float32Array;
  /** 0 ordinary wildlife, 1 wounded escape, 2 waiting, 3 startled neighbour escape. */
  huntState: Uint8Array;
  /** Home: the forest centre and how far around it the animal roams. */
  homeRange: Float32Array;
  homeX: Float32Array;
  homeZ: Float32Array;
  /** Simulation time (seconds) of the last threat stimulus, -1 never. */
  lastThreatTime: Float32Array;
  /** Waypoints (x, z) of the current route, MAX_PATH_POINTS per slot. */
  path: Float32Array;
  pathCount: Uint8Array;
  pathIndex: Uint8Array;
  /** Pending reaction (REACTION) and its delay in seconds. */
  reaction: Uint8Array;
  reactionDelay: Float32Array;
  /** Herd mates told by another animal do not pass the alarm on again. */
  secondHand: Uint8Array;
  /** 0 female, 1 male (antlers on males from adolescence). */
  sex: Uint8Array;
  /** Personality factors (see Personality): threat reach, wander, rest and idle lengths. */
  shyness: Float32Array;
  wanderScale: Float32Array;
  restBias: Float32Array;
  idleBias: Float32Array;
  shade: Float32Array;
  size: Float32Array;
  /** Individual coat tone: -1 greyer / older .. 1 warmer / redder. */
  tone: Float32Array;
  species: Uint8Array;
  speed: Float32Array;
  speedFactor: Float32Array;
  state: Uint8Array;
  stateLength: Float32Array;
  stateTime: Float32Array;
  targetX: Float32Array;
  targetZ: Float32Array;
  /** Seconds since the threat was last perceived. */
  threatAge: Float32Array;
  threatIntensity: Float32Array;
  threatX: Float32Array;
  threatZ: Float32Array;
  velocityX: Float32Array;
  velocityZ: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** Visual motion of each slot (smoothed animation parameters, see AnimalMotion). */
export interface AnimalMotionPool {
  alert: Float32Array;
  breath: Float32Array;
  chew: Float32Array;
  earLeft: Float32Array;
  /** The individual's resting ear angles (asymmetric, one ear a little lower). */
  earLeftBase: Float32Array;
  earRight: Float32Array;
  earRightBase: Float32Array;
  earTimer: Float32Array;
  flee: Float32Array;
  gaitPhase: Float32Array;
  graze: Float32Array;
  headYaw: Float32Array;
  headYawTarget: Float32Array;
  /** Body lean into a turn (radians), visual only. */
  lean: Float32Array;
  lookTimer: Float32Array;
  pitch: Float32Array;
  /** 0 standing .. 1 bedded, and the head low while bedded (0 .. 1). */
  rest: Float32Array;
  /** Which resting pose (rabbits: sit, loaf, crouch, groom). */
  restKind: Uint8Array;
  restHead: Float32Array;
  roll: Float32Array;
}

/** Positions of the previous fixed step: rendering interpolates between the two. */
export interface AnimalHistory {
  heading: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

const floats = (capacity: number) => new Float32Array(capacity);

export const createAnimalPool = (capacity: number): AnimalPool => ({
  active: new Uint8Array(capacity),
  pending: new Uint8Array(capacity),
  arrivalTime: floats(capacity),
  departing: new Uint8Array(capacity),
  age: floats(capacity),
  aiTimer: floats(capacity),
  alertLevel: floats(capacity),
  appear: floats(capacity),
  blocked: floats(capacity),
  bodyScale: floats(capacity),
  carcass: new Uint8Array(capacity),
  coat: new Float32Array(capacity * 4),
  dappled: new Uint8Array(capacity),
  deathTime: floats(capacity),
  form: new Uint8Array(capacity),
  desiredHeading: floats(capacity),
  group: new Int16Array(capacity),
  heading: floats(capacity),
  health: floats(capacity),
  huntState: new Uint8Array(capacity),
  homeRange: floats(capacity),
  homeX: floats(capacity),
  homeZ: floats(capacity),
  lastThreatTime: floats(capacity),
  path: new Float32Array(capacity * MAX_PATH_POINTS * 2),
  pathCount: new Uint8Array(capacity),
  pathIndex: new Uint8Array(capacity),
  reaction: new Uint8Array(capacity),
  reactionDelay: floats(capacity),
  secondHand: new Uint8Array(capacity),
  sex: new Uint8Array(capacity),
  shyness: floats(capacity),
  wanderScale: floats(capacity),
  restBias: floats(capacity),
  idleBias: floats(capacity),
  shade: floats(capacity),
  size: floats(capacity),
  species: new Uint8Array(capacity),
  tone: floats(capacity),
  speed: floats(capacity),
  speedFactor: floats(capacity),
  state: new Uint8Array(capacity),
  stateLength: floats(capacity),
  stateTime: floats(capacity),
  targetX: floats(capacity),
  targetZ: floats(capacity),
  threatAge: floats(capacity),
  threatIntensity: floats(capacity),
  threatX: floats(capacity),
  threatZ: floats(capacity),
  velocityX: floats(capacity),
  velocityZ: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createMotionPool = (capacity: number): AnimalMotionPool => ({
  alert: floats(capacity),
  breath: floats(capacity),
  chew: floats(capacity),
  earLeft: floats(capacity),
  earLeftBase: floats(capacity),
  earRight: floats(capacity),
  earRightBase: floats(capacity),
  earTimer: floats(capacity),
  flee: floats(capacity),
  gaitPhase: floats(capacity),
  graze: floats(capacity),
  headYaw: floats(capacity),
  headYawTarget: floats(capacity),
  lean: floats(capacity),
  lookTimer: floats(capacity),
  pitch: floats(capacity),
  rest: floats(capacity),
  restHead: floats(capacity),
  restKind: new Uint8Array(capacity),
  roll: floats(capacity)
});

/**
 * The motion channels the simulation owns (saved and hashed): rest gates locomotion, the slope
 * tilt follows the steps and the ear base is the animal's look. The others are visual only.
 */
export const pickSimulationMotion = (motion: AnimalMotionPool) => {
  const { earLeftBase, earRightBase, pitch, rest, restKind, roll } = motion;
  return { earLeftBase, earRightBase, pitch, rest, restKind, roll };
};

/** Zeroes one slot of every array of a struct-of-arrays pool (each array's own stride). */
const clearSlotOf = (arrays: object, slot: number, capacity: number) => {
  for (const array of Object.values(arrays)) {
    if (!ArrayBuffer.isView(array)) continue;
    const values = array as Float32Array;
    const stride = values.length / capacity;
    values.fill(0, slot * stride, slot * stride + stride);
  }
};

/**
 * A slot starts a new life (birth, placement) or wakes from its routine with nothing left of its
 * previous occupant: every pool, motion and history value zero. A save then never depends on
 * what an earlier animal, a dormant drawing or a reload left in the slot.
 */
export const clearAnimalSlot = (
  pool: AnimalPool, motion: AnimalMotionPool, history: AnimalHistory, slot: number
) => {
  const capacity = pool.active.length;
  clearSlotOf(pool, slot, capacity);
  clearSlotOf(motion, slot, capacity);
  clearSlotOf(history, slot, capacity);
};

export const createAnimalHistory = (capacity: number): AnimalHistory => ({
  heading: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

/**
 * What the renderer reads each frame: the visible animals packed into the first `count` slots,
 * world placement, smoothed body orientation and the joint angles (POSE_CHANNELS per slot).
 */
export interface AnimalFrame {
  antlers: Float32Array;
  /** Fade in (0..1) times the fog of war visibility gate. */
  appear: Float32Array;
  /** Coat of each animal (vec4 per slot, see AnimalPool.coat). */
  coat: Float32Array;
  count: number;
  /** Ground height under the body (before the pose lift and the foot placement drop). */
  ground: Float32Array;
  /** Facing direction: world (cos, sin) in x, z. */
  heading: Float32Array;
  /** Body pitch (nose up +) and roll on the slope, radians. */
  pitch: Float32Array;
  pose: Float32Array;
  roll: Float32Array;
  scale: Float32Array;
  shade: Float32Array;
  species: Uint8Array;
  /** Life stage of the animal (and its coat / antler stage): the mesh variant. */
  stage: Uint8Array;
  tone: Float32Array;
  /** Mesh variant (life stage, or the dappled adult deer). */
  variant: Uint8Array;
  /** Fog of war visibility 0..1 at the animal. */
  visibility: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export const createAnimalFrame = (capacity: number): AnimalFrame => ({
  antlers: floats(capacity),
  appear: floats(capacity),
  coat: new Float32Array(capacity * 4),
  count: 0,
  ground: floats(capacity),
  heading: floats(capacity),
  pitch: floats(capacity),
  pose: new Float32Array(capacity * POSE_CHANNELS),
  roll: floats(capacity),
  scale: floats(capacity),
  shade: floats(capacity),
  species: new Uint8Array(capacity),
  stage: new Uint8Array(capacity),
  tone: floats(capacity),
  variant: new Uint8Array(capacity),
  visibility: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});
