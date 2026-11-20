import type { ColonyDifficulty } from "../../src/shared/settlement/colony-expedition-rules";
import { simulateColonyAssault, typicalForce } from "../../tools/bench/garrison-balance-harness";

/** Ranks of the colony balance forces (garrison-balance*.test.ts; seeds and history there). */
export const AVERAGE = [0, 1], VETERANS = [1, 2];
const MIXED = { archers: true, cavalry: true };

/** Whether the force wins one deterministic colony assault. */
export const assault = (
  difficulty: ColonyDifficulty, size: number, ranks: readonly number[], seed: number, mixed = false
) => simulateColonyAssault({ difficulty, force: typicalForce(size, mixed ? MIXED : {}, ranks), seed }).won;
