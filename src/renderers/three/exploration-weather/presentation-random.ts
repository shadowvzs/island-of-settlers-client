/**
 * Presentation-only randomness for EXPLORE-01F weather. It is deliberately independent of the
 * simulation RNG (and of `Math.random`): the same seed produces the same rain, bolt and thunder
 * variation, and no gameplay state or timer is touched.
 */

export const PRESENTATION_WEATHER_SEED = 0x51f0a7;

/** xorshift32: small, fast and deterministic; never used for gameplay decisions. */
export const createPresentationRandom = (seed: number) => {
  let state = (seed >>> 0) || PRESENTATION_WEATHER_SEED;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
};

/** Derives an independent stream so rain, lightning and audio do not consume each other's sequence. */
export const mixPresentationSeed = (seed: number, salt: number) => {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
};
