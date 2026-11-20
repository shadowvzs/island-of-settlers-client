/** Authored and saved marble sources share stable local IDs and finite quantities. */
import { MARBLE_DEPOSIT_QUANTITY } from "../balance/resources";
import { type ColonyStone,isColonyStone } from "./colony-resource-tiers";
import type { WorldData } from "./world-data";
export interface MarbleDeposit {
  id: number; remaining: number; x: number; z: number;
  /** Absent is legacy marble. A prop source retains its existing boulder identity. */
  material?: ColonyStone;
  sourceProp?: number;
}
/** Authored stone material sources per map (stable ids 0..MAX-1). */
export const MAX_MARBLE_DEPOSITS = 12;

export const validMarbleDeposits = (value: unknown, width: number, depth: number): value is MarbleDeposit[] | undefined => {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_MARBLE_DEPOSITS) return false;
  const ids = new Set<number>();
  const sourceProps = new Set<number>();
  return value.every(deposit => {
    if (!deposit || typeof deposit !== "object" || Array.isArray(deposit) ||
      !Number.isSafeInteger(deposit.id) || deposit.id < 0 || deposit.id >= MAX_MARBLE_DEPOSITS ||
      ids.has(deposit.id)) return false;
    ids.add(deposit.id);
    if (deposit.material !== undefined && !isColonyStone(deposit.material)) return false;
    if (deposit.sourceProp !== undefined && (!Number.isSafeInteger(deposit.sourceProp) || deposit.sourceProp < 0)) return false;
    if (deposit.sourceProp !== undefined) {
      if (sourceProps.has(deposit.sourceProp)) return false;
      sourceProps.add(deposit.sourceProp);
    }
    return Number.isSafeInteger(deposit.remaining) &&
    deposit.remaining >= 0 && deposit.remaining <= MARBLE_DEPOSIT_QUANTITY &&
    Number.isFinite(deposit.x) && Number.isFinite(deposit.z) &&
    deposit.x >= 1 && deposit.z >= 1 && deposit.x < width - 1 && deposit.z < depth - 1;
  });
};

/**
 * The finite stone material sources of a map, read exactly as the settlement reads them
 * (`colony-marble-deposits`): the scenario's own list when it has one, else the map's sources
 * (`colonyStoneDeposits`). A plain home map therefore takes explicit deposits without becoming an
 * authored scenario, and a scenario added later keeps showing them.
 */
export const getAuthoredDeposits = (world: WorldData): readonly MarbleDeposit[] =>
  world.scenario?.marbleDeposits ?? world.colonyStoneDeposits ?? [];
