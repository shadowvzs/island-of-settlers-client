/** Per bird state as a struct of arrays (fixed capacity, no allocation while running). */
export interface BirdPool {
  capacity: number;
  /** Visual size 0 (hidden: waiting in a crown, settled) .. 1 (flying). */
  appear: Float32Array;
  bank: Float32Array;
  /** Seconds until a waiting bird emerges (staggered takeoff). */
  delay: Float32Array;
  /** Seconds left of a split from the flock, and the side it drifts to. */
  detach: Float32Array;
  detachSide: Float32Array;
  /** Flap amount 0 glide .. 1 full beats, and the beat boost (bursts, takeoff). */
  flap: Float32Array;
  flapBoost: Float32Array;
  /** Owning flock, -1 when the slot is free. */
  flock: Int16Array;
  /** Seconds left of the current glide or flap stretch, and which one it is (1 glide). */
  glideTimer: Float32Array;
  gliding: Uint8Array;
  heading: Float32Array;
  /** Loose position in the flock: forward / lateral / height offsets (world units). */
  offsetForward: Float32Array;
  offsetHeight: Float32Array;
  offsetSide: Float32Array;
  phase: Float32Array;
  pitch: Float32Array;
  /** Per bird variety: flap rate factor, speed factor, colour shade, drift seed. */
  rateFactor: Float32Array;
  seed: Float32Array;
  /** Landing: -1 flying, 0..1 progress of sinking into the crown or grass. */
  settle: Float32Array;
  shade: Float32Array;
  speed: Float32Array;
  speedFactor: Float32Array;
  species: Uint8Array;
  verticalSpeed: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** Values of the previous step, for smooth rendering between the fixed simulation steps. */
export interface BirdHistory {
  appear: Float32Array;
  bank: Float32Array;
  flap: Float32Array;
  heading: Float32Array;
  phase: Float32Array;
  pitch: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** What renderers read each frame: the visible birds packed into the first `count` slots. */
export interface BirdFrame {
  bank: Float32Array;
  count: number;
  flapAmount: Float32Array;
  /** Flap phase in radians (wing angle = sin(phase) times the amount). */
  flapPhase: Float32Array;
  /** Ground or water height below the bird (shadows). */
  ground: Float32Array;
  /** Flight direction: world (cos, sin) in x, z. */
  heading: Float32Array;
  pitch: Float32Array;
  /** World size multiplier: species wingspan times the appear / settle size. */
  scale: Float32Array;
  /** Brightness variation of the bird's colours (about 0.85..1.15). */
  shade: Float32Array;
  species: Uint8Array;
  /** Wing tuck 0..1 (tight turns, landing): folds the wings in. */
  tuck: Float32Array;
  /** Fog of war visibility 0..1 (renderers hide birds over unexplored land). */
  visibility: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

const floats = (capacity: number) => new Float32Array(capacity);

export const createBirdPool = (capacity: number): BirdPool => ({
  appear: floats(capacity),
  bank: floats(capacity),
  capacity,
  delay: floats(capacity),
  detach: floats(capacity),
  detachSide: floats(capacity),
  flap: floats(capacity),
  flapBoost: floats(capacity),
  flock: new Int16Array(capacity).fill(-1),
  glideTimer: floats(capacity),
  gliding: new Uint8Array(capacity),
  heading: floats(capacity),
  offsetForward: floats(capacity),
  offsetHeight: floats(capacity),
  offsetSide: floats(capacity),
  phase: floats(capacity),
  pitch: floats(capacity),
  rateFactor: floats(capacity),
  seed: floats(capacity),
  settle: floats(capacity).fill(-1),
  shade: floats(capacity),
  speed: floats(capacity),
  speedFactor: floats(capacity),
  species: new Uint8Array(capacity),
  verticalSpeed: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createBirdHistory = (capacity: number): BirdHistory => ({
  appear: floats(capacity),
  bank: floats(capacity),
  flap: floats(capacity),
  heading: floats(capacity),
  phase: floats(capacity),
  pitch: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createBirdFrame = (capacity: number): BirdFrame => ({
  bank: floats(capacity),
  count: 0,
  flapAmount: floats(capacity),
  flapPhase: floats(capacity),
  ground: floats(capacity),
  heading: floats(capacity),
  pitch: floats(capacity),
  scale: floats(capacity),
  shade: floats(capacity),
  species: new Uint8Array(capacity),
  tuck: floats(capacity),
  visibility: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

/** Copies the current state of a bird into the history before a step. */
export const rememberBird = (pool: BirdPool, history: BirdHistory, bird: number) => {
  history.appear[bird] = pool.appear[bird]!;
  history.bank[bird] = pool.bank[bird]!;
  history.flap[bird] = pool.flap[bird]!;
  history.heading[bird] = pool.heading[bird]!;
  history.phase[bird] = pool.phase[bird]!;
  history.pitch[bird] = pool.pitch[bird]!;
  history.x[bird] = pool.x[bird]!;
  history.y[bird] = pool.y[bird]!;
  history.z[bird] = pool.z[bird]!;
};

/** Finds `count` free slots; returns false (and takes none) when the pool is too full. */
export const claimBirds = (pool: BirdPool, count: number, flock: number, slots: Int16Array) => {
  let found = 0;
  for (let bird = 0; bird < pool.capacity && found < count; bird += 1) {
    if (pool.flock[bird] === -1) {
      slots[found] = bird;
      found += 1;
    }
  }
  if (found < count) return false;
  for (let index = 0; index < count; index += 1) pool.flock[slots[index]!] = flock;
  return true;
};
