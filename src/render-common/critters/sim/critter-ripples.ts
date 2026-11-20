import type { CritterTerrain } from "../habitat/critter-terrain";
import type { RippleFrame } from "./critter-pool";

/** Seconds a ring of size 1 lives (smaller rings fade sooner). */
const LIFE_PER_SIZE = 3.2;
const MIN_LIFE = 0.9;

/**
 * Expanding rings on the water surface (wakes, dabbling, strikes, leaping fish, whales): a small
 * fixed pool, the oldest ring is reused when it is full.
 */
export const createRipples = (capacity: number, terrain: Pick<CritterTerrain, "fog" | "water">) => {
  const x = new Float32Array(capacity);
  const y = new Float32Array(capacity);
  const z = new Float32Array(capacity);
  const age = new Float32Array(capacity).fill(1);
  const life = new Float32Array(capacity).fill(1);
  const size = new Float32Array(capacity);

  const findSlot = () => {
    let oldest = 0;
    for (let index = 0; index < capacity; index += 1) {
      if (age[index]! >= 1) return index;
      if (age[index]! > age[oldest]!) oldest = index;
    }
    return oldest;
  };

  const emit = (atX: number, atZ: number, radius: number) => {
    const index = findSlot();
    x[index] = atX;
    z[index] = atZ;
    y[index] = terrain.water(atX, atZ);
    size[index] = radius;
    age[index] = 0;
    life[index] = Math.max(MIN_LIFE, radius * LIFE_PER_SIZE);
  };

  const step = (seconds: number) => {
    for (let index = 0; index < capacity; index += 1) {
      if (age[index]! < 1) age[index] = Math.min(1, age[index]! + seconds / life[index]!);
    }
  };

  const write = (frame: RippleFrame) => {
    let count = 0;
    for (let index = 0; index < capacity; index += 1) {
      if (age[index]! >= 1) continue;
      frame.x[count] = x[index]!;
      frame.y[count] = y[index]!;
      frame.z[count] = z[index]!;
      frame.age[count] = age[index]!;
      frame.size[count] = size[index]!;
      frame.visibility[count] = terrain.fog(x[index]!, z[index]!);
      count += 1;
    }
    frame.count = count;
  };

  return { emit, step, write };
};
