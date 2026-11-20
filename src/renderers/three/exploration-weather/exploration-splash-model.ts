/**
 * Fixed-ring splash and ripple pools for the FPS rain volume. Spawning samples at most a profile-
 * capped number of drops and surfaces per frame; slots are reused, never allocated per splash.
 */
import type { ExplorationRainDrop } from "./exploration-rain-model";
import { createPresentationRandom, mixPresentationSeed, PRESENTATION_WEATHER_SEED } from "./presentation-random";

export interface ExplorationSplash {
  active: boolean;
  age: number;
  /** Yaw of the irregular splash shape (radians), random per impact. */
  angle: number;
  duration: number;
  /** 1 at the impact, fading to 0 at the end of its short life. */
  fade: number;
  scale: number;
  /** Size at the impact; `scale` grows from it. */
  size: number;
  /** Horizontal squash of the shape (0.7..1.3): no two impacts share an outline. */
  stretch: number;
  x: number;
  y: number;
  z: number;
}

export interface ExplorationSplashFieldOptions {
  rippleCapacity?: number;
  rippleChance?: number;
  rippleSpawnsPerUpdate?: number;
  seed?: number;
  splashCapacity: number;
  splashChance?: number;
  splashSpawnsPerUpdate?: number;
}

export interface ExplorationSplashFieldUpdate {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  deltaSeconds: number;
  drops: readonly ExplorationRainDrop[];
  intensity: number;
  /** Called at most `splashSpawnsPerUpdate` per pool per frame (never per drop). */
  surfaceY?: (x: number, z: number) => number;
  /** Ripple rings only spawn where this is true (open water); every surface when omitted. */
  waterAt?: (x: number, z: number) => boolean;
}

export interface ExplorationSplashFieldSample {
  active: boolean;
  intensity: number;
  rippleCapacity: number;
  ripples: readonly ExplorationSplash[];
  rippleCount: number;
  spawns: number;
  splashCapacity: number;
  splashes: readonly ExplorationSplash[];
  splashCount: number;
}

export interface ExplorationSplashField {
  readonly rippleCapacity: number;
  readonly splashCapacity: number;
  dispose: () => void;
  reset: () => void;
  sample: () => ExplorationSplashFieldSample;
  update: (input: ExplorationSplashFieldUpdate) => ExplorationSplashFieldSample;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

const createSplashSlot = (): ExplorationSplash => ({
  active: false, age: 0, angle: 0, duration: 1, fade: 0, scale: 0, size: 0, stretch: 1, x: 0, y: 0, z: 0
});

/** Life and size of one impact: crown splashes are tiny and very short, ripples small and brief. */
const SPLASH_SHAPES = {
  ripple: { duration: [0.32, 0.6], grow: 1.8, size: [0.06, 0.12] },
  splash: { duration: [0.09, 0.17], grow: 0.5, size: [0.05, 0.1] }
} as const;

type SplashShape = (typeof SPLASH_SHAPES)[keyof typeof SPLASH_SHAPES];

/** Bounded splash/ripple model; both pools can be zero on the Minimal device tier. */
export const createExplorationSplashField = (
  options: ExplorationSplashFieldOptions
): ExplorationSplashField => {
  const splashCapacity = Math.max(0, Math.floor(options.splashCapacity));
  const rippleCapacity = Math.max(0, Math.floor(options.rippleCapacity ?? Math.ceil(splashCapacity * 0.8)));
  const splashSpawns = Math.max(0, Math.floor(options.splashSpawnsPerUpdate ??
    Math.min(3, splashCapacity)));
  const rippleSpawns = Math.max(0, Math.floor(options.rippleSpawnsPerUpdate ??
    Math.min(2, rippleCapacity)));
  const splashChance = clamp01(options.splashChance ?? 0.62);
  const rippleChance = clamp01(options.rippleChance ?? 0.34);
  const random = createPresentationRandom(
    mixPresentationSeed(options.seed ?? PRESENTATION_WEATHER_SEED, 0x5a1a)
  );
  const splashes: ExplorationSplash[] = Array.from({ length: splashCapacity }, createSplashSlot);
  const ripples: ExplorationSplash[] = Array.from({ length: rippleCapacity }, createSplashSlot);
  const sample: ExplorationSplashFieldSample = {
    active: false, intensity: 0, rippleCapacity, ripples, rippleCount: 0, spawns: 0,
    splashCapacity, splashes, splashCount: 0
  };
  let splashCursor = 0;
  let rippleCursor = 0;
  let spawns = 0;
  let disposed = false;
  let lastIntensity = 0;

  const agePool = (pool: ExplorationSplash[], delta: number, grow: number) => {
    let count = 0;
    for (const splash of pool) {
      if (!splash.active) continue;
      splash.age += delta;
      const t = Math.min(1, splash.age / splash.duration);
      splash.scale = splash.size * (1 + t * grow);
      splash.fade = (1 - t) * (1 - t);
      if (t >= 1) splash.active = false;
      else count++;
    }
    return count;
  };

  const between = ([low, high]: readonly [number, number]) => low + random() * (high - low);

  const emit = (pool: ExplorationSplash[], cursor: number, x: number, y: number, z: number, shape: SplashShape) => {
    const slot = pool[cursor]!;
    slot.active = true;
    slot.age = 0;
    slot.angle = random() * Math.PI * 2;
    slot.duration = between(shape.duration);
    slot.fade = 1;
    slot.size = between(shape.size);
    slot.scale = slot.size;
    slot.stretch = 0.7 + random() * 0.6;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    spawns++;
  };

  const spawnFromDrops = (input: ExplorationSplashFieldUpdate, amount: number, chance: number,
    pool: ExplorationSplash[], cursor: number, shape: SplashShape) => {
    const drops = input.drops;
    if (!drops.length || !pool.length) return cursor;
    for (let attempt = 0; attempt < amount; attempt++) {
      if (random() > chance) continue;
      const drop = drops[Math.floor(random() * drops.length) % drops.length]!;
      if (!drop.active || !drop.visible || drop.sheltered) continue;
      if (shape === SPLASH_SHAPES.ripple && input.waterAt && !input.waterAt(drop.x, drop.z)) continue;
      const y = input.surfaceY
        ? finiteOr(input.surfaceY(drop.x, drop.z), input.cameraY - 1.7)
        : input.cameraY - 1.7;
      emit(pool, cursor, drop.x, y + 0.02, drop.z, shape);
      cursor = (cursor + 1) % pool.length;
    }
    return cursor;
  };

  const measure = (intensity: number) => {
    sample.active = !disposed && intensity > 0.01 && (splashCapacity > 0 || rippleCapacity > 0);
    sample.intensity = intensity;
    sample.spawns = spawns;
    sample.splashCount = splashes.reduce((count, splash) => count + (splash.active ? 1 : 0), 0);
    sample.rippleCount = ripples.reduce((count, ripple) => count + (ripple.active ? 1 : 0), 0);
    return sample;
  };

  const reset = () => {
    for (const splash of splashes) splash.active = false;
    for (const ripple of ripples) ripple.active = false;
    splashCursor = 0;
    rippleCursor = 0;
    spawns = 0;
    lastIntensity = 0;
    sample.active = false;
    sample.splashCount = 0;
    sample.rippleCount = 0;
    sample.spawns = 0;
  };

  const update = (input: ExplorationSplashFieldUpdate): ExplorationSplashFieldSample => {
    if (disposed) return measure(0);
    const intensity = clamp01(input.intensity);
    lastIntensity = intensity;
    const delta = Math.min(0.2, Math.max(0, finiteOr(input.deltaSeconds, 0)));
    if (intensity <= 0.01 || (!splashCapacity && !rippleCapacity)) {
      reset();
      sample.intensity = intensity;
      return sample;
    }
    agePool(splashes, delta, SPLASH_SHAPES.splash.grow);
    agePool(ripples, delta, SPLASH_SHAPES.ripple.grow);
    splashCursor = spawnFromDrops(input, splashSpawns, splashChance * intensity, splashes,
      splashCursor, SPLASH_SHAPES.splash);
    rippleCursor = spawnFromDrops(input, rippleSpawns, rippleChance * intensity, ripples,
      rippleCursor, SPLASH_SHAPES.ripple);
    return measure(intensity);
  };

  return {
    dispose: () => {
      disposed = true;
      reset();
    },
    reset,
    rippleCapacity,
    sample: () => measure(lastIntensity),
    splashCapacity,
    update
  };
};
