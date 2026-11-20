import type { CommanderLevel } from "../../balance/commander-profiles";
import { FACTION_AI_LEVELS } from "../../world/constants";
import { MAX_FACTION } from "../../world/scenario-players";

/** Saved: [faction, level], factions ascending. */
export type CommanderLevelEntry = [faction: number, level: CommanderLevel];

const isCommanderLevel = (value: unknown): value is CommanderLevel =>
  (FACTION_AI_LEVELS as readonly unknown[]).includes(value);

const isComputerFaction = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_FACTION;

/**
 * The commander levels a map script gave computer factions (`setCommanderLevel`, A14 plan §7 step 1). A script
 * level outranks the map's, the island's and the global difficulty; it is saved with the combat state.
 * `revision` changes whenever a faction's level may have changed (a script action or a load).
 */
export const createCommanderLevels = () => {
  const levels = new Map<number, CommanderLevel>();
  let revision = 0;
  return {
    /** Another source of a faction's level changed (the script's `setFactionAi` level). */
    invalidate: () => { revision++; },
    of: (faction: number) => levels.get(faction),
    restore: (saved: readonly CommanderLevelEntry[] | undefined) => {
      levels.clear();
      for (const [faction, level] of saved ?? []) levels.set(faction, level);
      revision++;
    },
    revision: () => revision,
    save: (): CommanderLevelEntry[] | undefined =>
      levels.size ? [...levels].sort(([first], [second]) => first - second) : undefined,
    /** False for anything but a computer faction and a known level. */
    set: (faction: number, level: unknown) => {
      if (!isComputerFaction(faction) || !isCommanderLevel(level)) return false;
      if (levels.get(faction) === level) return true;
      levels.set(faction, level);
      revision++;
      return true;
    }
  };
};

export type CommanderLevels = ReturnType<typeof createCommanderLevels>;

/** Null when the saved script levels are well formed: computer factions ascending, each with a known level. */
export const commanderLevelsSaveError = (saved: unknown) => {
  if (saved === undefined) return null;
  if (!Array.isArray(saved) || !saved.length) return "Invalid commander levels";
  let previous = 0;
  for (const entry of saved as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return "Invalid commander level";
    const [faction, level] = entry as unknown[];
    if (!isComputerFaction(faction) || faction <= previous || !isCommanderLevel(level))
      return "Invalid commander level";
    previous = faction;
  }
  return null;
};
