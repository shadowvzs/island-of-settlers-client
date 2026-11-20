import { DMath } from "../../shared/math/deterministic-math";
import type { Random } from "../../shared/world/rng";

/** Falling leaves (struct of arrays). Renderers draw each live particle as a small leaf. */
export interface LeafParticles {
  /** 0..1, fades out at the end of life. */
  alpha: Float32Array;
  /** Rotation around the leaf's own axis (radians). */
  angle: Float32Array;
  capacity: number;
  /** 0..2: leaf colour variant (fresh, mid, yellowing). */
  shade: Uint8Array;
  size: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export interface LeafBurst {
  count: number;
  /** Height the leaves land on. */
  ground: number;
  /** Horizontal spread around the centre. */
  radius: number;
  /** Leaf size; the fall speed and drift scale with it. */
  size: number;
  x: number;
  y: number;
  z: number;
}

const LIFE = 5;
const FADE = 1;

/**
 * Small particle simulation: leaves drift down with a swaying side motion and a tumbling spin,
 * rest on the ground, then fade. A fixed pool: the oldest leaves are reused when it is full.
 */
export const createLeafParticles = (capacity: number, random: Random) => {
  const particles: LeafParticles = {
    alpha: new Float32Array(capacity),
    angle: new Float32Array(capacity),
    capacity,
    shade: new Uint8Array(capacity),
    size: new Float32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity)
  };
  const age = new Float32Array(capacity).fill(LIFE);
  const ground = new Float32Array(capacity);
  const drift = new Float32Array(capacity * 2);
  const sway = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  let next = 0;

  const spawn = (burst: LeafBurst) => {
    for (let leaf = 0; leaf < burst.count; leaf += 1) {
      const slot = next;
      next = (next + 1) % capacity;
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * burst.radius;
      particles.x[slot] = burst.x + DMath.cos(angle) * distance;
      particles.y[slot] = burst.y + (random() - 0.5) * burst.radius * 0.6;
      particles.z[slot] = burst.z + DMath.sin(angle) * distance;
      particles.size[slot] = burst.size * (0.7 + random() * 0.6);
      particles.shade[slot] = Math.floor(random() * 3);
      drift[slot * 2] = DMath.cos(angle) * burst.size * (1 + random() * 2);
      drift[slot * 2 + 1] = DMath.sin(angle) * burst.size * (1 + random() * 2);
      sway[slot] = random() * Math.PI * 2;
      spin[slot] = (random() - 0.5) * 9;
      ground[slot] = burst.ground;
      age[slot] = 0;
    }
  };

  const updateLeaf = (slot: number, deltaSeconds: number) => {
    age[slot]! += deltaSeconds;
    const size = particles.size[slot]!;
    const airborne = particles.y[slot]! > ground[slot]!;
    if (airborne) {
      const swing = DMath.sin(age[slot]! * 3.2 + sway[slot]!);
      particles.x[slot]! += (drift[slot * 2]! + swing * size * 4) * deltaSeconds;
      particles.z[slot]! += (drift[slot * 2 + 1]! - swing * size * 4) * deltaSeconds;
      particles.y[slot] = Math.max(ground[slot]!, particles.y[slot]! - size * 9 * deltaSeconds);
      particles.angle[slot]! += spin[slot]! * deltaSeconds;
    }
    particles.alpha[slot] = Math.min(1, Math.max(0, (LIFE - age[slot]!) / FADE));
  };

  const update = (deltaSeconds: number) => {
    for (let slot = 0; slot < capacity; slot += 1) {
      if (age[slot]! < LIFE) updateLeaf(slot, deltaSeconds);
      else particles.alpha[slot] = 0;
    }
  };

  return { particles, spawn, update };
};
