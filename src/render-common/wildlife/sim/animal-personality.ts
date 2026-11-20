import { createRandom } from "../../../shared/world/rng";

/**
 * Subtle personality of an individual, factors around 1: shy (low boldness) notices danger
 * earlier and flees sooner, bold wanders further and lets a threat come closer, calm idles
 * and rests longer. Deterministic per behaviour seed.
 */
export interface Personality {
  alertness: number;
  boldness: number;
  idleDuration: number;
  restFrequency: number;
  speed: number;
  wanderRadius: number;
}

/** Spread of each factor (+-): kept small, so the species still behaves as one. */
export const PERSONALITY_SPREAD: Readonly<Record<keyof Personality, number>> = {
  alertness: 0.2,
  boldness: 0.25,
  idleDuration: 0.25,
  restFrequency: 0.25,
  speed: 0.08,
  wanderRadius: 0.25
};

export const createPersonality = (seed: number): Personality => {
  const random = createRandom(seed ^ 0x5bd1e995);
  const factor = (key: keyof Personality) => 1 + (random() * 2 - 1) * PERSONALITY_SPREAD[key];
  return {
    alertness: factor("alertness"),
    boldness: factor("boldness"),
    idleDuration: factor("idleDuration"),
    restFrequency: factor("restFrequency"),
    speed: factor("speed"),
    wanderRadius: factor("wanderRadius")
  };
};
