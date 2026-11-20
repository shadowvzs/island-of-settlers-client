export const BUTTERFLY_MODE = { approach: 1, fly: 0, sit: 2 } as const;

/** Per butterfly state as a struct of arrays (fixed capacity, no allocation while running). */
export interface ButterflyPool {
  active: Uint8Array;
  /** Visual size 0 (hidden) .. 1; `leaving` fades it out, then the slot is freed. */
  appear: Float32Array;
  capacity: number;
  /** Height above the ground it cruises at. */
  cruise: Float32Array;
  /** Flap amount 0 glide .. 1 beating, and seconds left of the current glide / beat stretch. */
  flap: Float32Array;
  /** Flower prop it approaches or sits on (-1 none), and the last one it left. */
  flower: Int32Array;
  glideTimer: Float32Array;
  /** 1 while holding the wings flat in a glide. */
  gliding: Uint8Array;
  heading: Float32Array;
  /** Where it was spawned: it wanders around there. */
  homeX: Float32Array;
  homeZ: Float32Array;
  lastFlower: Int32Array;
  leaving: Uint8Array;
  mode: Uint8Array;
  /** Seconds the butterfly has been out of the view. */
  outOfView: Float32Array;
  phase: Float32Array;
  seed: Float32Array;
  shade: Float32Array;
  /** 0 flying .. 1 settled on a flower (wing pose blend). */
  sit: Float32Array;
  species: Uint8Array;
  speed: Float32Array;
  targetX: Float32Array;
  targetZ: Float32Array;
  /** Mode timer: seconds until the next landing try (fly), left to sit, or to give up. */
  timer: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** Values of the previous step, for smooth rendering between the fixed simulation steps. */
export interface ButterflyHistory {
  appear: Float32Array;
  flap: Float32Array;
  heading: Float32Array;
  phase: Float32Array;
  sit: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

/** What renderers read each frame: the visible butterflies packed into the first `count`. */
export interface ButterflyFrame {
  /** Wing bend of the beat (radians: the tips trail the stroke; Three only). */
  bend: Float32Array;
  count: number;
  /** Ground or water height below the butterfly (shadows). */
  ground: Float32Array;
  /** Flight direction: world (cos, sin) in x, z. */
  heading: Float32Array;
  /** World size: species wingspan times the appear fade. */
  scale: Float32Array;
  /** Brightness variation of the colours (about 0.9..1.1). */
  shade: Float32Array;
  species: Uint8Array;
  /** Fog of war visibility 0..1. */
  visibility: Float32Array;
  /** Wing pattern variant (atlas cell). */
  variant: Uint8Array;
  /** Wing angle about the body axis (radians, 0 flat open, positive up). */
  wing: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

const floats = (capacity: number) => new Float32Array(capacity);

export const createButterflyPool = (capacity: number): ButterflyPool => ({
  active: new Uint8Array(capacity),
  appear: floats(capacity),
  capacity,
  cruise: floats(capacity),
  flap: floats(capacity),
  flower: new Int32Array(capacity).fill(-1),
  glideTimer: floats(capacity),
  gliding: new Uint8Array(capacity),
  heading: floats(capacity),
  homeX: floats(capacity),
  homeZ: floats(capacity),
  lastFlower: new Int32Array(capacity).fill(-1),
  leaving: new Uint8Array(capacity),
  mode: new Uint8Array(capacity),
  outOfView: floats(capacity),
  phase: floats(capacity),
  seed: floats(capacity),
  shade: floats(capacity),
  sit: floats(capacity),
  species: new Uint8Array(capacity),
  speed: floats(capacity),
  targetX: floats(capacity),
  targetZ: floats(capacity),
  timer: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createButterflyHistory = (capacity: number): ButterflyHistory => ({
  appear: floats(capacity),
  flap: floats(capacity),
  heading: floats(capacity),
  phase: floats(capacity),
  sit: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

export const createButterflyFrame = (capacity: number): ButterflyFrame => ({
  bend: floats(capacity),
  count: 0,
  ground: floats(capacity),
  heading: floats(capacity),
  scale: floats(capacity),
  shade: floats(capacity),
  species: new Uint8Array(capacity),
  variant: new Uint8Array(capacity),
  visibility: floats(capacity),
  wing: floats(capacity),
  x: floats(capacity),
  y: floats(capacity),
  z: floats(capacity)
});

/** Copies the current state of a butterfly into the history before a step. */
export const rememberButterfly = (
  pool: ButterflyPool,
  history: ButterflyHistory,
  index: number
) => {
  history.appear[index] = pool.appear[index]!;
  history.flap[index] = pool.flap[index]!;
  history.heading[index] = pool.heading[index]!;
  history.phase[index] = pool.phase[index]!;
  history.sit[index] = pool.sit[index]!;
  history.x[index] = pool.x[index]!;
  history.y[index] = pool.y[index]!;
  history.z[index] = pool.z[index]!;
};

export const findFreeButterfly = (pool: ButterflyPool) => {
  for (let index = 0; index < pool.capacity; index += 1) if (pool.active[index] === 0) return index;
  return -1;
};
