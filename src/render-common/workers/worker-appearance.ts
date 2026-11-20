import { TRIPO_ROSTER } from "@workers/tripo-roster";

import { NATIONS } from "../../../../island-of-settlers-shared/src/nations";
import { pickFrom, shuffle } from "../../shared/world/rng";
import { workerBodyNation } from "./worker-body-nation";
import { type WorkerAppearance, type WorkerNation } from "./worker-unit";

/** Every nation has Tripo3D bodies of both genders (the owner's models, the generator's clips). */
export const WORKER_NATIONS = NATIONS.filter(
  (nation): nation is keyof typeof TRIPO_ROSTER => nation in TRIPO_ROSTER
);

/** Stable player choices also include nations whose bodies are still being reviewed. */
export const PLAYER_NATIONS = NATIONS;

/** The nation's bodies, women and men taking turns (random start), each gender shuffled. */
const mixBodies = (nation: WorkerNation, random: () => number) => {
  const { female, male }: Record<"female" | "male", readonly string[]> = TRIPO_ROSTER[workerBodyNation(nation)];
  const [first, second] =
    random() < 0.5
      ? [shuffle([...female], random), shuffle([...male], random)]
      : [shuffle([...male], random), shuffle([...female], random)];
  const length = Math.max(first.length, second.length);
  return Array.from({ length }, (_, index) => [first[index], second[index]])
    .flat()
    .filter((id): id is string => id !== undefined);
};

/**
 * Appearances of a group of workers: one nation for all (the chosen one, else random), its
 * bodies mixed (women and men, distinct while the nation's list lasts).
 */
export const randomWorkerAppearances = (
  count: number,
  nation?: WorkerNation,
  random: () => number = Math.random
): WorkerAppearance[] => {
  const groupNation = nation ?? pickFrom(random, WORKER_NATIONS);
  const bodies = mixBodies(groupNation, random);
  return Array.from({ length: count }, (_, index) => ({
    nation: groupNation,
    variant: bodies[index % bodies.length]!
  }));
};

/** The nation's other bodies (same gender first) to try when `appearance`'s files fail. */
export const listFallbackBodies = (appearance: WorkerAppearance) => {
  const { female, male }: Record<"female" | "male", readonly string[]> =
    TRIPO_ROSTER[workerBodyNation(appearance.nation, appearance.variant)];
  const [own, other] = female.includes(appearance.variant) ? [female, male] : [male, female];
  return [...own, ...other].filter((variant) => variant !== appearance.variant);
};

/**
 * Loads a worker body; a body whose files are missing or invalid (not built or baked yet) is
 * skipped with a warning and the nation's other bodies are tried, so one body never blocks
 * startup. Fails only when no body of the nation loads.
 */
export const loadWorkerBody = async <T>(
  appearance: WorkerAppearance,
  load: (appearance: WorkerAppearance) => Promise<T>
) => {
  for (const variant of [appearance.variant, ...listFallbackBodies(appearance)]) {
    try {
      return await load({ ...appearance, variant });
    } catch (error) {
      console.warn(`Worker body "${variant}" did not load; using another body`, error);
    }
  }
  throw new Error(`No ${appearance.nation} worker body loads`);
};

export const isWorkerNation = (value: unknown): value is WorkerNation =>
  PLAYER_NATIONS.includes(value as WorkerNation);
