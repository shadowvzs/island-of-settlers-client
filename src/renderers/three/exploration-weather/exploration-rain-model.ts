/**
 * Bounded, camera-local rain and splash presentation for EXPLORE-01F.
 *
 * There is no island-wide precipitation simulation and no per-drop physics/raycast loop. Drops are
 * recycled in one fixed array; shelter and surface callbacks are sampled only on bounded, rotating
 * probes. The caller supplies camera, wind and intensity values copied from the current frame
 * environment, and all variation comes from this module's presentation PRNG.
 */
import { createPresentationRandom, mixPresentationSeed, PRESENTATION_WEATHER_SEED } from "./presentation-random";

export interface ExplorationRainDrop {
  active: boolean;
  /** Depth along the supplied view direction; used for perspective rejection. */
  depth: number;
  /** Length of the streak in world units. */
  length: number;
  sheltered: boolean;
  speed: number;
  tailX: number;
  tailY: number;
  tailZ: number;
  visible: boolean;
  x: number;
  y: number;
  z: number;
}

export interface ExplorationRainFieldOptions {
  /** Maximum drops in the fixed pool (hard-capped by the adapter profile). */
  capacity: number;
  /** Camera-local horizontal radius. */
  radius?: number;
  /** Vertical band above/below the eye. */
  height?: number;
  /** How far below the eye the volume starts. */
  bottomOffset?: number;
  seed?: number;
  shelter?: (x: number, z: number) => number;
  shelterProbeBudget?: number;
  near?: number;
  far?: number;
}

export interface ExplorationRainFieldUpdate {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  deltaSeconds: number;
  /** View direction in world space; drops behind the near plane or beyond `far` are rejected. */
  forwardX?: number;
  forwardY?: number;
  forwardZ?: number;
  intensity: number;
  timeSeconds?: number;
  /** 0 rain .. 1 snow; snow falls slower and sways sideways. */
  snowShare?: number;
  windX: number;
  windZ: number;
}

export interface ExplorationRainFieldSample {
  active: boolean;
  capacity: number;
  count: number;
  depthRejected: number;
  drops: readonly ExplorationRainDrop[];
  far: number;
  intensity: number;
  near: number;
  radius: number;
  sheltered: number;
  snowShare: number;
  windX: number;
  windZ: number;
}

export interface ExplorationRainField {
  readonly capacity: number;
  dispose: () => void;
  reset: () => void;
  sample: () => ExplorationRainFieldSample;
  update: (input: ExplorationRainFieldUpdate) => ExplorationRainFieldSample;
}

const TAU = Math.PI * 2;
const SHELTER_THRESHOLD = 0.55;
const SHELTER_RECHECK_SECONDS = 2;
const VOLUME_HEADROOM = 1.35;

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

const normalizeForward = (x?: number, y?: number, z?: number) => {
  const length = Math.hypot(x ?? 0, y ?? 0, z ?? 1);
  if (length < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: (x ?? 0) / length, y: (y ?? 0) / length, z: (z ?? 1) / length };
};

export const createExplorationRainField = (
  options: ExplorationRainFieldOptions
): ExplorationRainField => {
  const capacity = Math.max(0, Math.floor(options.capacity));
  const radius = Math.max(0.5, options.radius ?? 20);
  const height = Math.max(1, options.height ?? 24);
  const bottomOffset = Math.max(0.1, options.bottomOffset ?? 6);
  const near = Math.max(0, options.near ?? 0.25);
  const far = Math.max(near + 0.1, options.far ?? 60);
  const probeBudget = Math.max(0, Math.floor(options.shelterProbeBudget ?? 8));
  const random = createPresentationRandom(
    mixPresentationSeed(options.seed ?? PRESENTATION_WEATHER_SEED, 0x1a1f)
  );
  const drops: ExplorationRainDrop[] = Array.from({ length: capacity }, () => ({
    active: false, depth: 0, length: 0, sheltered: false, speed: 0,
    tailX: 0, tailY: 0, tailZ: 0, visible: false, x: 0, y: 0, z: 0
  }));
  const nextShelterProbeAt = new Float64Array(capacity);
  const shelterValues = new Float32Array(capacity);
  const sample: ExplorationRainFieldSample = {
    active: false, capacity, count: 0, depthRejected: 0, drops, far, intensity: 0, near,
    radius, sheltered: 0, snowShare: 0, windX: 0, windZ: 0
  };
  let initialized = false;
  let probeCursor = 0;
  let disposed = false;
  let lastIntensity = 0;
  let lastSnowShare = 0;
  let lastWindX = 0;
  let lastWindZ = 0;

  const spawn = (index: number, cameraX: number, cameraY: number, cameraZ: number) => {
    const drop = drops[index]!;
    const angle = random() * TAU;
    const distance = Math.sqrt(random()) * radius;
    drop.x = cameraX + Math.cos(angle) * distance;
    drop.z = cameraZ + Math.sin(angle) * distance;
    const bottom = cameraY - bottomOffset;
    drop.y = bottom + random() * height;
    drop.speed = 13 + random() * 11;
    drop.length = 0.42 + random() * 0.58;
    drop.active = true;
    drop.visible = false;
    drop.sheltered = false;
    drop.depth = 0;
    drop.tailX = drop.x;
    drop.tailY = drop.y;
    drop.tailZ = drop.z;
    nextShelterProbeAt[index] = -Infinity;
    shelterValues[index] = 0;
  };

  const probeShelter = (index: number, timeSeconds: number) => {
    if (!options.shelter || timeSeconds < nextShelterProbeAt[index]!) return;
    const drop = drops[index]!;
    shelterValues[index] = clamp01(options.shelter(drop.x, drop.z));
    nextShelterProbeAt[index] = timeSeconds + SHELTER_RECHECK_SECONDS;
  };

  const measure = (intensity: number) => {
    sample.active = !disposed && capacity > 0 && intensity > 0.01;
    sample.capacity = capacity;
    sample.count = 0;
    sample.depthRejected = 0;
    sample.sheltered = 0;
    sample.intensity = intensity;
    sample.snowShare = lastSnowShare;
    sample.windX = lastWindX;
    sample.windZ = lastWindZ;
    for (const drop of drops) {
      if (!drop.active) {
        drop.visible = false;
        continue;
      }
      if (drop.sheltered) sample.sheltered++;
      if (drop.visible) sample.count++;
      else if (!drop.sheltered && drop.depth > 0) sample.depthRejected++;
    }
    if (!sample.active) sample.count = 0;
    return sample;
  };

  const reset = () => {
    initialized = false;
    probeCursor = 0;
    for (let index = 0; index < capacity; index++) {
      const drop = drops[index]!;
      drop.active = false;
      drop.visible = false;
      drop.sheltered = false;
      drop.depth = 0;
      nextShelterProbeAt[index] = -Infinity;
      shelterValues[index] = 0;
    }
    sample.active = false;
    sample.count = 0;
    sample.depthRejected = 0;
    sample.sheltered = 0;
    lastIntensity = 0;
    lastSnowShare = 0;
    lastWindX = 0;
    lastWindZ = 0;
  };

  const update = (input: ExplorationRainFieldUpdate): ExplorationRainFieldSample => {
    if (disposed) return measure(0);
    const intensity = clamp01(input.intensity);
    lastIntensity = intensity;
    lastSnowShare = clamp01(input.snowShare ?? 0);
    lastWindX = finiteOr(input.windX, 0);
    lastWindZ = finiteOr(input.windZ, 0);
    if (intensity <= 0.01 || capacity === 0) {
      reset();
      sample.intensity = intensity;
      return sample;
    }
    const cameraX = finiteOr(input.cameraX, 0);
    const cameraY = finiteOr(input.cameraY, 0);
    const cameraZ = finiteOr(input.cameraZ, 0);
    const delta = Math.min(0.2, Math.max(0, finiteOr(input.deltaSeconds, 0)));
    const timeSeconds = finiteOr(input.timeSeconds ?? 0, 0);
    const forward = normalizeForward(input.forwardX, input.forwardY, input.forwardZ);
    const bottom = cameraY - bottomOffset;
    const top = bottom + height;
    const maxHorizontal = radius * VOLUME_HEADROOM;
    const windScale = 2.2 + intensity * 2.6;
    const driftX = lastWindX * windScale;
    const driftZ = lastWindZ * windScale;

    if (!initialized) {
      for (let index = 0; index < capacity; index++) spawn(index, cameraX, cameraY, cameraZ);
      initialized = true;
    }

    // Bounded round-robin shelter sampling: never one raycast per drop per frame.
    if (capacity > 0) {
      for (let probes = 0; probes < probeBudget; probes++) {
        const index = probeCursor % capacity;
        probeCursor++;
        if (drops[index]!.active) probeShelter(index, timeSeconds);
      }
    }

    const snowShare = lastSnowShare;
    const fallScale = 1 - .88 * snowShare, streakScale = 1 - .92 * snowShare;
    for (let index = 0; index < capacity; index++) {
      const drop = drops[index]!;
      const dx = drop.x - cameraX;
      const dz = drop.z - cameraZ;
      if (!drop.active || dx * dx + dz * dz > maxHorizontal * maxHorizontal ||
        drop.y < bottom - 0.5 || drop.y > top + 2) {
        spawn(index, cameraX, cameraY, cameraZ);
        drop.visible = false;
        drop.depth = 0;
        continue;
      }
      const sway = Math.sin(timeSeconds * .8 + index) * .25 * snowShare;
      drop.x += (driftX + sway) * delta;
      drop.z += (driftZ - sway * .35) * delta;
      drop.y -= drop.speed * fallScale * delta;
      const movedX = drop.x - cameraX;
      const movedZ = drop.z - cameraZ;
      if (drop.y < bottom || movedX * movedX + movedZ * movedZ >
        maxHorizontal * maxHorizontal) {
        spawn(index, cameraX, cameraY, cameraZ);
        drop.visible = false;
        drop.depth = 0;
        continue;
      }
      const vx = driftX + sway, speed = drop.speed * fallScale, length = drop.length * streakScale;
      const vz = driftZ - sway * .35;
      const magnitude = Math.hypot(vx, speed, vz) || 1;
      drop.tailX = drop.x - vx * length / magnitude;
      drop.tailY = drop.y + speed * length / magnitude;
      drop.tailZ = drop.z - vz * length / magnitude;
      const toX = drop.x - cameraX;
      const toY = drop.y - cameraY;
      const toZ = drop.z - cameraZ;
      drop.depth = toX * forward.x + toY * forward.y + toZ * forward.z;
      drop.sheltered = shelterValues[index]! > SHELTER_THRESHOLD;
      const insideDepth = drop.depth >= near && drop.depth <= far;
      drop.visible = drop.active && !drop.sheltered && insideDepth;
    }

    return measure(intensity);
  };

  return {
    capacity,
    dispose: () => {
      disposed = true;
      reset();
    },
    reset,
    sample: () => measure(lastIntensity),
    update
  };
};
