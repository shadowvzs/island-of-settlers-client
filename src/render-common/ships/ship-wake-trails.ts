/**
 * Ship wake trails (R18a), presentation only: each moving hull drops a stern sample every
 * WAKE_SAMPLE_SPACING units; the samples age out after WAKE_LIFE_SECONDS. Every trail becomes one
 * ribbon: a bow row and a stern row on the live hull, then the samples, newest first. The ribbon
 * widens from the bow with the Kelvin wedge (half angle 19.5 degrees), so its edges are the wake
 * arms. Fixed pools and typed buffers: no allocation per frame. The simulation never reads this.
 */

/** Keel length and beam of a hull, world units. */
export interface WakeHull {
  beam: number;
  length: number;
}

/** Water at a point: surface height and depth over the ground. Written in place by the sampler. */
export interface WakeWater {
  depth: number;
  height: number;
}

export type WakeWaterSampler = (x: number, z: number, out: WakeWater) => void;

/** Vertex streams of the ribbons: position xyz; wake (along, lateral, age, strength); shape. */
export interface WakeBuffers {
  index: Uint16Array;
  position: Float32Array;
  shape: Float32Array;
  wake: Float32Array;
}

export const WAKE_SAMPLES = 18;
/**
 * Vertices across a ribbon row: the swell is evaluated per vertex, so the ribbon must be fine
 * enough across (a few units) to follow the crests of the finer water mesh instead of cutting
 * through them (which hid the foam in dashes and patches).
 */
export const WAKE_ROW_VERTICES = 5;
/** Lateral position of each row vertex, -1 (one edge) .. 1 (the other). */
const ROW_SIDES = Array.from({ length: WAKE_ROW_VERTICES }, (_, column) => 1 - 2 * column / (WAKE_ROW_VERTICES - 1));
/** Rows per ribbon: bow, stern and the samples. */
export const WAKE_ROWS = WAKE_SAMPLES + 2;
export const WAKE_SAMPLE_SPACING = 0.8;
export const WAKE_LIFE_SECONDS = 6;
/** tan(19.5 degrees): the Kelvin wedge of a displacement hull, independent of its speed. */
const KELVIN_SPREAD = 0.354;
/** Widest arm spread, in beams: far behind, the arms have flattened out. */
const MAX_HALF_WIDTH_BEAMS = 2.5;
/** Widest half width on a turn, as a share of its radius (the inner edge stays clear of the centre). */
const TURN_WIDTH_SHARE = 0.7;
/** Speed (hull lengths per second) at which the foam is at full strength. */
const FULL_SPEED_LENGTHS = 0.18;
/** A longer frame gap or a longer jump restarts the trail (a load, a berth placement, a pause). */
const MAX_FRAME_GAP = 0.5;
const MAX_JUMP = 6;
/** Speed smoothing rate (1/s): a frame's jitter does not flicker the foam. */
const SPEED_RESPONSE = 4;
/** Floats per sample: x, z, forward x, forward z, time, strength. */
const STRIDE = 6;

interface WakeTrail {
  count: number;
  forwardX: number;
  forwardZ: number;
  head: number;
  hull: WakeHull;
  key: number;
  samples: Float32Array;
  seen: boolean;
  speed: number;
  time: number;
  x: number;
  z: number;
}

const createTrail = (): WakeTrail => ({
  count: 0, forwardX: 0, forwardZ: 1, head: 0, hull: { beam: 1, length: 1 }, key: -1,
  samples: new Float32Array(WAKE_SAMPLES * STRIDE), seen: false, speed: 0, time: 0, x: 0, z: 0
});

/** Allocated once per renderer: `budget` ribbons of WAKE_ROWS rows, two vertices per row. */
export const createWakeBuffers = (budget: number): WakeBuffers => {
  const vertices = budget * WAKE_ROWS * WAKE_ROW_VERTICES;
  return {
    index: new Uint16Array(budget * (WAKE_ROWS - 1) * (WAKE_ROW_VERTICES - 1) * 6),
    position: new Float32Array(vertices * 3),
    shape: new Float32Array(vertices * 4),
    wake: new Float32Array(vertices * 4)
  };
};

const restart = (trail: WakeTrail, x: number, z: number, time: number) => {
  trail.count = 0;
  trail.speed = 0;
  trail.x = x;
  trail.z = z;
  trail.time = time;
};

const sampleOffset = (trail: WakeTrail, newest: number) =>
  ((trail.head - 1 - newest + WAKE_SAMPLES) % WAKE_SAMPLES) * STRIDE;

const strengthOf = (trail: WakeTrail) =>
  Math.min(1, trail.speed / (trail.hull.length * FULL_SPEED_LENGTHS));

/** Drops a stern sample once the stern has moved a sample spacing from the newest one. */
const dropSample = (trail: WakeTrail, time: number) => {
  const half = trail.hull.length / 2;
  const sternX = trail.x - trail.forwardX * half;
  const sternZ = trail.z - trail.forwardZ * half;
  if (trail.count > 0) {
    const newest = sampleOffset(trail, 0);
    const moved = Math.hypot(sternX - trail.samples[newest]!, sternZ - trail.samples[newest + 1]!);
    if (moved < WAKE_SAMPLE_SPACING) return;
  }
  const offset = trail.head * STRIDE, samples = trail.samples;
  samples[offset] = sternX;
  samples[offset + 1] = sternZ;
  samples[offset + 2] = trail.forwardX;
  samples[offset + 3] = trail.forwardZ;
  samples[offset + 4] = time;
  samples[offset + 5] = strengthOf(trail);
  trail.head = (trail.head + 1) % WAKE_SAMPLES;
  trail.count = Math.min(WAKE_SAMPLES, trail.count + 1);
};

/** Moves a trail's hull to its new pose and updates the smoothed speed. */
const advance = (trail: WakeTrail, x: number, z: number, yaw: number, time: number) => {
  const gap = time - trail.time;
  const jump = Math.hypot(x - trail.x, z - trail.z);
  if (gap > MAX_FRAME_GAP || gap < 0 || jump > MAX_JUMP) restart(trail, x, z, time);
  trail.forwardX = Math.sin(yaw);
  trail.forwardZ = Math.cos(yaw);
  if (gap > 0 && gap <= MAX_FRAME_GAP) {
    const blend = 1 - Math.exp(-gap * SPEED_RESPONSE);
    trail.speed += (jump / gap - trail.speed) * blend;
  }
  trail.x = x;
  trail.z = z;
  trail.time = time;
  if (trail.speed > 0.05) dropSample(trail, time);
};

/** Index of the oldest sample still alive (samples are time ordered, newest first). */
const liveSamples = (trail: WakeTrail, time: number) => {
  let live = 0;
  while (live < trail.count && time - trail.samples[sampleOffset(trail, live) + 4]! < WAKE_LIFE_SECONDS) live++;
  return live;
};

/** The pooled trail of `key`, else a free one (undefined when the budget is used up). */
const findTrail = (pool: readonly WakeTrail[], key: number) => {
  let free: WakeTrail | undefined;
  for (const trail of pool) {
    if (trail.key === key) return trail;
    if (!free && trail.key < 0) free = trail;
  }
  return free;
};

/** One ribbon row; reused for every row of every trail. */
interface WakeRow {
  age: number;
  along: number;
  forwardX: number;
  forwardZ: number;
  strength: number;
  x: number;
  z: number;
}

/** Pooled trails keyed by craft; `track` every visible moving craft, then `finish` the frame. */
export const createWakeTrails = (budget: number) => {
  const pool = Array.from({ length: budget }, createTrail);
  const water: WakeWater = { depth: 0, height: 0 };
  const row: WakeRow = { age: 0, along: 0, forwardX: 0, forwardZ: 1, strength: 0, x: 0, z: 0 };

  const track = (key: number, hull: WakeHull, x: number, z: number, yaw: number, time: number) => {
    const trail = findTrail(pool, key);
    if (!trail) return;
    if (trail.key !== key) {
      trail.key = key;
      restart(trail, x, z, time);
    }
    trail.hull = hull;
    trail.seen = true;
    advance(trail, x, z, yaw, time);
  };

  /** A craft no longer tracked stops making foam; its trail fades out, then frees its slot. */
  const releaseFaded = (trail: WakeTrail, time: number) => {
    const tracked = trail.seen;
    trail.seen = false;
    if (!tracked && liveSamples(trail, time) === 0) trail.key = -1;
  };

  let rowVertex = 0;
  let indexCount = 0;

  const writeVertex = (
    buffers: WakeBuffers, sampler: WakeWaterSampler, hull: WakeHull, halfWidth: number, side: number
  ) => {
    const vertex = rowVertex++;
    const { position, shape, wake } = buffers;
    const x = row.x + row.forwardZ * halfWidth * side, z = row.z - row.forwardX * halfWidth * side;
    sampler(x, z, water);
    position[vertex * 3] = x;
    position[vertex * 3 + 1] = water.height;
    position[vertex * 3 + 2] = z;
    wake[vertex * 4] = row.along;
    wake[vertex * 4 + 1] = halfWidth * side;
    wake[vertex * 4 + 2] = row.age;
    wake[vertex * 4 + 3] = row.strength;
    shape[vertex * 4] = halfWidth;
    shape[vertex * 4 + 1] = hull.beam;
    shape[vertex * 4 + 2] = hull.length;
    shape[vertex * 4 + 3] = water.depth;
  };

  /**
   * The row's vertices across the hull's keel at that row, edge to edge. `turnRadius` caps the
   * spread on a tight turn, so the inner edge never folds back over the ribbon.
   */
  const writeRow = (buffers: WakeBuffers, sampler: WakeWaterSampler, hull: WakeHull, turnRadius = Infinity) => {
    const spread = Math.min(hull.beam * 0.25 + row.along * KELVIN_SPREAD, hull.beam * MAX_HALF_WIDTH_BEAMS);
    const halfWidth = Math.min(spread, Math.max(hull.beam * 0.5, turnRadius * TURN_WIDTH_SHARE));
    for (const side of ROW_SIDES) writeVertex(buffers, sampler, hull, halfWidth, side);
  };

  /** Two triangles per column between the previous row and the row just written, counter-clockwise from above. */
  const linkRow = (buffers: WakeBuffers) => {
    const index = buffers.index, start = rowVertex - WAKE_ROW_VERTICES;
    for (let column = 0; column < WAKE_ROW_VERTICES - 1; column++) {
      const left = start + column, right = left + 1;
      const previousLeft = left - WAKE_ROW_VERTICES, previousRight = right - WAKE_ROW_VERTICES;
      index[indexCount] = previousLeft;
      index[indexCount + 1] = left;
      index[indexCount + 2] = previousRight;
      index[indexCount + 3] = previousRight;
      index[indexCount + 4] = left;
      index[indexCount + 5] = right;
      indexCount += 6;
    }
  };

  const writeTrail = (buffers: WakeBuffers, sampler: WakeWaterSampler, trail: WakeTrail, time: number) => {
    const { length } = trail.hull;
    const strength = strengthOf(trail);
    const live = liveSamples(trail, time);
    if (strength <= 0 && live === 0) return;
    row.age = 0;
    row.along = 0;
    row.forwardX = trail.forwardX;
    row.forwardZ = trail.forwardZ;
    row.strength = strength;
    row.x = trail.x + trail.forwardX * length / 2;
    row.z = trail.z + trail.forwardZ * length / 2;
    writeRow(buffers, sampler, trail.hull);
    row.along = length;
    row.x = trail.x - trail.forwardX * length / 2;
    row.z = trail.z - trail.forwardZ * length / 2;
    writeRow(buffers, sampler, trail.hull);
    linkRow(buffers);
    // The newest dead sample still closes the ribbon (its age is 1: zero foam).
    const rows = Math.min(trail.count, live + 1);
    for (let newest = 0; newest < rows; newest++) writeSample(buffers, sampler, trail, newest, time);
  };

  /** The next ribbon row at a stern sample: its path distance from the previous row adds up. */
  const writeSample = (
    buffers: WakeBuffers, sampler: WakeWaterSampler, trail: WakeTrail, newest: number, time: number
  ) => {
    const offset = sampleOffset(trail, newest), samples = trail.samples;
    const x = samples[offset]!, z = samples[offset + 1]!;
    const forwardX = samples[offset + 2]!, forwardZ = samples[offset + 3]!;
    const step = Math.hypot(x - row.x, z - row.z);
    const turn = Math.abs(Math.atan2(row.forwardX * forwardZ - row.forwardZ * forwardX,
      row.forwardX * forwardX + row.forwardZ * forwardZ));
    row.along += step;
    row.age = Math.min(1, (time - samples[offset + 4]!) / WAKE_LIFE_SECONDS);
    row.forwardX = forwardX;
    row.forwardZ = forwardZ;
    row.strength = samples[offset + 5]!;
    row.x = x;
    row.z = z;
    writeRow(buffers, sampler, trail.hull, turn > 1e-4 ? step / turn : Infinity);
    linkRow(buffers);
  };

  /** Writes every ribbon and frees faded trails; returns the index count to draw. */
  const finish = (buffers: WakeBuffers, sampler: WakeWaterSampler, time: number) => {
    rowVertex = 0;
    indexCount = 0;
    for (const trail of pool) {
      if (trail.key < 0) continue;
      if (!trail.seen) trail.speed = 0;
      writeTrail(buffers, sampler, trail, time);
      releaseFaded(trail, time);
    }
    return indexCount;
  };

  return { finish, track };
};
