import type { Random } from "../../shared/world/rng";

/**
 * Water thrown up by the whale: the blow's mist, splash droplets and foam lying on the water. A
 * fixed pool (the oldest particle is reused when it is full); emitters scale their counts by the
 * pool's `density` (Minimal's smaller pool keeps the same look with fewer, larger particles).
 */
export const SPRAY_KIND = { foam: 2, mist: 0, spray: 1 } as const;

/** Gravity (world units / s^2; a unit is about two metres) and drag per kind. */
const GRAVITY = [1.2, 6.5, 0] as const;
const DRAG = [1.7, 0.35, 0] as const;
/** Pool size the emitter counts are authored for. */
const FULL_CAPACITY = 320;

export interface SprayFrame {
  /** Live particles written this frame. */
  count: number;
  /** Per particle: x, y, z, size. */
  placement: Float32Array;
  /** Per particle: age 0..1, kind, seed, opacity. */
  look: Float32Array;
}

export interface WhaleSpray {
  /** Fills the frame with the live particles (wind drifts the mist). */
  write: (frame: SprayFrame) => void;
  blow: (x: number, y: number, z: number, height: number, random: Random) => void;
  /** Foam left on the water (radius in world units). */
  foam: (x: number, y: number, z: number, radius: number, random: Random) => void;
  live: () => number;
  reset: () => void;
  /** A splash of `strength` (about its radius in world units) where something hit the water. */
  splash: (x: number, y: number, z: number, strength: number, random: Random) => void;
  step: (seconds: number, windX: number, windZ: number, waterY: number) => void;
  /** Water streaming off a body leaving the surface (`up`: its rising speed). */
  stream: (x: number, y: number, z: number, up: number, random: Random) => void;
}

/** The next particle an emitter places (one object reused by every emitter). */
interface Particle {
  grow: number;
  kind: number;
  life: number;
  opacity: number;
  size: number;
  vx: number;
  vy: number;
  vz: number;
}

export const createSprayFrame = (capacity: number): SprayFrame => ({
  count: 0, look: new Float32Array(capacity * 4), placement: new Float32Array(capacity * 4)
});

export const createWhaleSpray = (capacity: number): WhaleSpray => {
  const position = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const age = new Float32Array(capacity).fill(1);
  const life = new Float32Array(capacity).fill(1);
  const size = new Float32Array(capacity);
  const growth = new Float32Array(capacity);
  const kind = new Uint8Array(capacity);
  const seed = new Float32Array(capacity);
  const opacity = new Float32Array(capacity);
  const density = Math.min(1, capacity / FULL_CAPACITY);
  /** Fewer particles on a small pool, each a little larger. */
  const sizeScale = 1 / Math.sqrt(density);
  let cursor = 0;

  const findSlot = () => {
    for (let tries = 0; tries < capacity; tries += 1) {
      const index = (cursor + tries) % capacity;
      if (age[index]! >= 1) {
        cursor = (index + 1) % capacity;
        return index;
      }
    }
    const index = cursor;
    cursor = (cursor + 1) % capacity;
    return index;
  };

  const particle: Particle = { grow: 0, kind: 0, life: 1, opacity: 1, size: 1, vx: 0, vy: 0, vz: 0 };

  const emit = (x: number, y: number, z: number, random: Random) => {
    const index = findSlot();
    position[index * 3] = x;
    position[index * 3 + 1] = y;
    position[index * 3 + 2] = z;
    velocity[index * 3] = particle.vx;
    velocity[index * 3 + 1] = particle.vy;
    velocity[index * 3 + 2] = particle.vz;
    age[index] = 0;
    life[index] = particle.life;
    size[index] = particle.size * sizeScale;
    growth[index] = particle.grow * sizeScale;
    kind[index] = particle.kind;
    seed[index] = random();
    opacity[index] = particle.opacity;
  };

  const countFor = (authored: number) => Math.max(1, Math.round(authored * density));

  const between = (random: Random, low: number, high: number) => low + random() * (high - low);

  const blow = (x: number, y: number, z: number, height: number, random: Random) => {
    const count = countFor(64);
    for (let index = 0; index < count; index += 1) {
      const lift = between(random, 0.45, 1.15) * height * 2.2;
      const spread = between(random, 0.05, 0.3) * lift;
      const angle = random() * Math.PI * 2;
      Object.assign(particle, {
        grow: height * between(random, 0.16, 0.3), kind: SPRAY_KIND.mist, life: between(random, 2.2, 3.6),
        opacity: between(random, 0.6, 1), size: height * between(random, 0.05, 0.09),
        vx: Math.cos(angle) * spread, vy: lift, vz: Math.sin(angle) * spread
      });
      emit(x, y + random() * 0.1 * height, z, random);
    }
  };

  const splash = (x: number, y: number, z: number, strength: number, random: Random) => {
    const crown = countFor(16 + strength * 26);
    for (let index = 0; index < crown; index += 1) {
      const angle = random() * Math.PI * 2;
      const out = between(random, 0.8, 2.4) * Math.sqrt(strength);
      Object.assign(particle, {
        grow: strength * between(random, 0.15, 0.35), kind: SPRAY_KIND.spray, life: between(random, 1, 1.8),
        opacity: between(random, 0.8, 1), size: strength * between(random, 0.18, 0.4),
        vx: Math.cos(angle) * out, vy: between(random, 3, 7) * Math.sqrt(strength), vz: Math.sin(angle) * out
      });
      const radius = random() * strength * 0.5;
      emit(x + Math.cos(angle) * radius, y + 0.05, z + Math.sin(angle) * radius, random);
    }
    const column = countFor(3 + strength * 4);
    for (let index = 0; index < column; index += 1) {
      Object.assign(particle, {
        grow: strength * between(random, 0.8, 1.3), kind: SPRAY_KIND.mist, life: between(random, 1.6, 2.6),
        opacity: between(random, 0.6, 0.9), size: strength * between(random, 0.45, 0.75),
        vx: between(random, -0.5, 0.5), vy: between(random, 1.5, 3.5) * Math.sqrt(strength),
        vz: between(random, -0.5, 0.5)
      });
      emit(x, y + 0.1, z, random);
    }
    foam(x, y, z, strength * 0.9, random);
  };

  const foam = (x: number, y: number, z: number, radius: number, random: Random) => {
    const count = countFor(3 + radius * 2);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const offset = random() * radius * 0.6;
      Object.assign(particle, {
        grow: radius * between(random, 0.5, 0.9), kind: SPRAY_KIND.foam, life: between(random, 7, 11),
        opacity: between(random, 0.6, 0.9), size: radius * between(random, 0.45, 0.75), vx: 0, vy: 0, vz: 0
      });
      emit(x + Math.cos(angle) * offset, y, z + Math.sin(angle) * offset, random);
    }
  };

  const stream = (x: number, y: number, z: number, up: number, random: Random) => {
    const count = countFor(3);
    for (let index = 0; index < count; index += 1) {
      Object.assign(particle, {
        grow: 0.15, kind: SPRAY_KIND.spray, life: between(random, 0.6, 1.1), opacity: between(random, 0.5, 0.8),
        size: between(random, 0.08, 0.18), vx: between(random, -0.6, 0.6), vy: up * between(random, 0.3, 0.7),
        vz: between(random, -0.6, 0.6)
      });
      emit(x, y, z, random);
    }
  };

  const step = (seconds: number, windX: number, windZ: number, waterY: number) => {
    for (let index = 0; index < capacity; index += 1) {
      if (age[index]! >= 1) continue;
      age[index] = Math.min(1, age[index]! + seconds / life[index]!);
      const type = kind[index]!;
      if (type === SPRAY_KIND.foam) continue;
      const offset = index * 3;
      const keep = Math.exp(-DRAG[type]! * seconds);
      const drift = type === SPRAY_KIND.mist ? 1 - keep : 0;
      velocity[offset] = velocity[offset]! * keep + windX * drift;
      velocity[offset + 1] = velocity[offset + 1]! * keep - GRAVITY[type]! * seconds;
      velocity[offset + 2] = velocity[offset + 2]! * keep + windZ * drift;
      position[offset] = position[offset]! + velocity[offset]! * seconds;
      position[offset + 1] = position[offset + 1]! + velocity[offset + 1]! * seconds;
      position[offset + 2] = position[offset + 2]! + velocity[offset + 2]! * seconds;
      // Droplets falling back are gone where they meet the water.
      if (type === SPRAY_KIND.spray && position[offset + 1]! < waterY - 0.05) age[index] = 1;
    }
  };

  const write = (frame: SprayFrame) => {
    let count = 0;
    for (let index = 0; index < capacity; index += 1) {
      if (age[index]! >= 1) continue;
      const offset = count * 4;
      frame.placement[offset] = position[index * 3]!;
      frame.placement[offset + 1] = position[index * 3 + 1]!;
      frame.placement[offset + 2] = position[index * 3 + 2]!;
      frame.placement[offset + 3] = size[index]! + growth[index]! * Math.sqrt(age[index]!);
      frame.look[offset] = age[index]!;
      frame.look[offset + 1] = kind[index]!;
      frame.look[offset + 2] = seed[index]!;
      frame.look[offset + 3] = opacity[index]!;
      count += 1;
    }
    frame.count = count;
  };

  return {
    blow,
    foam,
    live: () => age.reduce((live, value) => (value < 1 ? live + 1 : live), 0),
    reset: () => age.fill(1),
    splash,
    step,
    stream,
    write
  };
};
