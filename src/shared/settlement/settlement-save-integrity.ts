import { isSaveInteger, isSaveObject } from "./save-validation";
import type { SettlementSaveV1 } from "./settlement-save-state";

/**
 * Entity and timer counts the simulation held when it saved (D3): snapshot verification compares
 * them with what the snapshot actually carries, so a truncated or corrupt snapshot is rejected instead of silently
 * replaying a different island. Every seeded random stream's state is saved with its owner (`military.randomState`,
 * `plantingRandomState`, wildlife `randomState`, felling `randomState`).
 */
export interface SettlementSaveIntegrity {
  actors: number;
  buildings: number;
  soldiers: number;
  timers: number;
  transfers: number;
}

type CountedSave = Pick<SettlementSaveV1, "actors" | "buildings" | "military" | "stoneRespawns" | "transfers">;

/** The counts a save carries (recruit, training and stone respawn timers count together). */
export const countSaveIntegrity = (save: CountedSave): SettlementSaveIntegrity => ({
  actors: save.actors.length,
  buildings: save.buildings.length,
  soldiers: save.military?.soldiers.length ?? 0,
  timers: (save.military?.recruitTimers.length ?? 0) + (save.military?.trainTimers.length ?? 0) +
    (save.stoneRespawns?.length ?? 0),
  transfers: save.transfers.length
});

const COUNTED_KEYS: readonly (keyof SettlementSaveIntegrity)[] =
  ["actors", "buildings", "soldiers", "timers", "transfers"];

/** Why the written counts differ from the expected ones; null when they match (or an older save has none). */
export const saveIntegrityProblem = (save: CountedSave & { integrity?: unknown }): string | null => {
  const expected = save.integrity;
  if (expected === undefined) return null;
  if (!isSaveObject(expected) || COUNTED_KEYS.some(key => !isSaveInteger(expected[key])))
    return "Invalid snapshot integrity counts";
  const written = countSaveIntegrity(save);
  const wrong = COUNTED_KEYS.find(key => expected[key] !== written[key]);
  if (!wrong) return null;
  return `Snapshot integrity: ${String(expected[wrong])} ${wrong} expected, ${written[wrong]} written`;
};
