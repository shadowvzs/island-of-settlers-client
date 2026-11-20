/**
 * Per critter state as a struct of arrays (fixed capacity, no allocation while running), the
 * previous step for smooth rendering, and the packed frame the renderers read.
 */
export interface CritterPool {
  active: Uint8Array;
  /** Pose parameter of the current clip: a cycle's running phase or a pose's amount 0..1. */
  pose: Float32Array;
  /** Visual size 0 (hidden) .. 1; `leaving` fades it out, then the slot is freed. */
  appear: Float32Array;
  behaviour: Uint8Array;
  capacity: number;
  /** 1 while a killed food critter's body is there (falling, lying, fading: helpers.ts). */
  carcass: Uint8Array;
  clip: Uint8Array;
  /** Seconds since the kill (carcass timing). */
  deathTime: Float32Array;
  heading: Float32Array;
  /** Under water (leaping fish between leaps): simulated but not drawn. */
  hidden: Uint8Array;
  /**
   * Seconds since a map edit took its home (0 while it has one): it leaves once out of view
   * (or fades out after a while in view).
   */
  homeless: Float32Array;
  /** Slot of the member it follows (-1: leads itself). */
  leader: Int16Array;
  leaving: Uint8Array;
  /** Height above the ground or water (birds flying off, fish in the air). */
  lift: Float32Array;
  /** Index of the member within its site (followers line up by it). */
  member: Uint8Array;
  mode: Uint8Array;
  outOfView: Float32Array;
  /** Mode scratch: the leap's start and the pose the current action aims at. */
  originX: Float32Array;
  originZ: Float32Array;
  /** Rendered size (species size jitter). */
  scale: Float32Array;
  seed: Float32Array;
  shade: Float32Array;
  site: Int32Array;
  species: Uint8Array;
  speed: Float32Array;
  targetX: Float32Array;
  targetZ: Float32Array;
  /** Mode timer (seconds left) and a second clock (wake ripples, leap progress). */
  timer: Float32Array;
  clock: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** Values of the previous step (interpolated with the current one when drawing). */
export interface CritterHistory {
  appear: Float32Array;
  /** The clip of the previous step: its pose is only blended while the clip stays. */
  clip: Uint8Array;
  heading: Float32Array;
  pose: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** Expanding rings on the water: wakes, dabbling, a fish leaving and hitting the water. */
export interface RippleFrame {
  /** 0 born .. 1 gone. */
  age: Float32Array;
  count: number;
  /** Largest radius (world units). */
  size: Float32Array;
  visibility: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** What the renderers read each frame: the visible critters packed into the first `count`. */
export interface CritterFrame {
  clip: Uint8Array;
  count: number;
  /** Ground or water surface below (shadows). */
  ground: Float32Array;
  /** Facing: world (cos, sin) in x, z. */
  heading: Float32Array;
  pose: Float32Array;
  ripples: RippleFrame;
  /** World scale (size jitter times the appear fade). */
  scale: Float32Array;
  /** Brightness variation (about 0.92 .. 1.08). */
  shade: Float32Array;
  species: Uint8Array;
  /** Fog of war visibility 0..1. */
  visibility: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

const floats = (capacity: number) => new Float32Array(capacity);

export const createCritterPool = (capacity: number): CritterPool => ({
  active: new Uint8Array(capacity),
  appear: floats(capacity),
  behaviour: new Uint8Array(capacity),
  capacity,
  carcass: new Uint8Array(capacity),
  clip: new Uint8Array(capacity),
  clock: floats(capacity),
  deathTime: floats(capacity),
  heading: floats(capacity),
  hidden: new Uint8Array(capacity),
  homeless: floats(capacity),
  leader: new Int16Array(capacity).fill(-1),
  leaving: new Uint8Array(capacity),
  lift: floats(capacity),
  member: new Uint8Array(capacity),
  mode: new Uint8Array(capacity),
  originX: floats(capacity),
  originZ: floats(capacity),
  outOfView: floats(capacity),
  pose: floats(capacity),
  scale: floats(capacity),
  seed: floats(capacity),
  shade: floats(capacity),
  site: new Int32Array(capacity).fill(-1),
  species: new Uint8Array(capacity),
  speed: floats(capacity),
  targetX: floats(capacity),
  targetZ: floats(capacity),
  timer: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createCritterHistory = (capacity: number): CritterHistory => ({
  appear: floats(capacity),
  clip: new Uint8Array(capacity),
  heading: floats(capacity),
  pose: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createRippleFrame = (capacity: number): RippleFrame => ({
  age: floats(capacity),
  count: 0,
  size: floats(capacity),
  visibility: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createCritterFrame = (capacity: number, ripples: number): CritterFrame => ({
  clip: new Uint8Array(capacity),
  count: 0,
  ground: floats(capacity),
  heading: floats(capacity),
  pose: floats(capacity),
  ripples: createRippleFrame(ripples),
  scale: floats(capacity),
  shade: floats(capacity),
  species: new Uint8Array(capacity),
  visibility: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const rememberCritter = (pool: CritterPool, history: CritterHistory, index: number) => {
  history.appear[index] = pool.appear[index]!;
  history.clip[index] = pool.clip[index]!;
  history.heading[index] = pool.heading[index]!;
  history.pose[index] = pool.pose[index]!;
  history.x[index] = pool.x[index]!;
  history.y[index] = pool.y[index]!;
  history.z[index] = pool.z[index]!;
};

export const findFreeCritter = (pool: CritterPool) => {
  for (let index = 0; index < pool.capacity; index += 1) if (pool.active[index] === 0) return index;
  return -1;
};
