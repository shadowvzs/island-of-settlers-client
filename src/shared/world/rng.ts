// Copied from ../map-generator/src/core/rng.ts (own code).
/** Deterministic PRNG (mulberry32): the same seed always yields the same sequence. */
export type Random = () => number;

const MULBERRY_STEP = 0x6d2b79f5;

/** One mulberry32 output (0..1) for an advanced state. */
const getMulberryValue = (state: number) => {
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
};

export const createRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_STEP) >>> 0;
    return getMulberryValue(state);
  };
};

export interface StatefulRandom { (): number; getState(): number; setState(state: number): void }

export const createStatefulRandom = (seed: number): StatefulRandom => {
  let state = seed >>> 0;
  const random = () => {
    state = (state + MULBERRY_STEP) >>> 0;
    return getMulberryValue(state);
  };
  return Object.assign(random, { getState: () => state, setState: (saved: number) => { state = saved >>> 0; } });
};

/** A key (grid cell, feature index) mixed into a seed: the key's own stream start. */
const mixKey = (seed: number, key: number) => (seed ^ Math.imul(key + 1, 0x9e3779b1)) >>> 0;

/**
 * A stream of its own per grid cell (render detail rebuilt per area: the cells keep their look
 * whatever else is rebuilt).
 */
export const createCellRandom = (seed: number, cell: number) => createRandom(mixKey(seed, cell));

/**
 * One reusable stream re-seeded per key (cell, feature index), the same sequence as
 * `createCellRandom(seed, key)` without an allocation per key (hot generation loops): what one
 * key draws never shifts another key's numbers.
 */
export const createKeyedRandom = (seed: number) => {
  let state = 0;
  const random: Random = () => {
    state = (state + MULBERRY_STEP) >>> 0;
    return getMulberryValue(state);
  };
  return (key: number) => {
    state = mixKey(seed, key);
    return random;
  };
};

/** Mixes a seed with a stage label so every generation stage has its own stream. */
export const deriveSeed = (seed: number, label: string) => {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
};

/** A uniform value in min..max (one draw). */
export const randomBetween = (random: Random, min: number, max: number) => min + random() * (max - min);

/** A uniform value in a [min, max] range (one draw). */
export const randomInRange = (random: Random, [min, max]: readonly [number, number]) =>
  randomBetween(random, min, max);

/** A uniform pick from a non-empty list (one draw). */
export const pickFrom = <T>(random: Random, items: readonly T[]) => items[Math.floor(random() * items.length)]!;

export const randomInt = (random: Random, maxExclusive: number) =>
  Math.floor(random() * maxExclusive);

export const shuffle = <T>(items: T[], random: Random) => {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = randomInt(random, index + 1);
    const swap = items[index] as T;
    items[index] = items[other] as T;
    items[other] = swap;
  }
  return items;
};

/** Index picked with probability proportional to its weight; -1 when every weight is zero. */
export const pickWeighted = (weights: ArrayLike<number>, random: Random) => {
  let total = 0;
  for (let index = 0; index < weights.length; index += 1) total += weights[index] ?? 0;
  if (total <= 0) return -1;
  let target = random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    target -= weights[index] ?? 0;
    if (target < 0) return index;
  }
  return weights.length - 1;
};
