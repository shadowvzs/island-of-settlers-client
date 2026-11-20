import type { SettlementBuilding } from "./settlement-types";

export const METALWORKS_TYPE = 25;
/** Production choice: the metalworks makes a random tool each cycle (owner, 2026-10-20). */
export const RANDOM_TOOLS = "randomTools";
/** Production choice: other multi-output workshops make each of their products in turn. */
export const PRODUCTS_IN_TURN = "productsInTurn";

/** The mixed (no single product) production choice of a building type; stored as no `selectedOutput`. */
export const mixedProductionChoice = (typeId: number) => typeId === METALWORKS_TYPE ? RANDOM_TOOLS : PRODUCTS_IN_TURN;

/**
 * Deterministic per-cycle random index: the same building and cycle always give the same tool, so saves,
 * reloads and reproduction replays stay identical without storing any extra state.
 */
const randomOutputIndex = (uid: number, cycle: number, count: number) => {
  let hash = Math.imul(uid ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(cycle + 1, 0xc2b2ae35);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) % count;
};

/** Output of a mixed-production cycle: a random tool at the metalworks, otherwise the next in turn. */
export const mixedCycleOutput = (
  building: Pick<SettlementBuilding, "cycle" | "typeId" | "uid">, outputs: readonly string[]
) => {
  if (mixedProductionChoice(building.typeId) === PRODUCTS_IN_TURN) return outputs[building.cycle % outputs.length]!;
  return outputs[randomOutputIndex(building.uid, building.cycle, outputs.length)]!;
};
