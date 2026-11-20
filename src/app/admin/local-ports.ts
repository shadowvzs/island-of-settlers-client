import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, type GameSettings
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  checkGameSettings, formatGameSettingsIssue, hasGameSettingsErrors
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings-issues";
import { localRulesRevision } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { BUNDLED_SETTINGS_FILE, CACHED_SETTINGS_KEY } from "../game-settings/constants";
import { browserSettingsSource, resolveBootGameSettings } from "../game-settings/settings-source";
import { openGameDatabase } from "../settlement/game-database";
import type { SaveSettingsResult, SettingsPort } from "./admin-ports";

/**
 * Offline and standalone builds (no server): the window edits this browser's settings source (GS3a), the boot
 * value the game reads before the bundled file. No revision history; the revision is the local hash.
 */
export const createLocalSettingsPort = (): SettingsPort => {
  const database = openGameDatabase();
  const source = async () => browserSettingsSource({
    backend: null, bundledUrl: `${import.meta.env.BASE_URL}${BUNDLED_SETTINGS_FILE}`, database: await database
  });
  return {
    latestRevision: async () => null,
    load: async () => {
      const boot = await resolveBootGameSettings(await source());
      const settings = boot.settings ?? cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
      return { revision: boot.revision ?? localRulesRevision(settings), settings };
    },
    save: async (settings: GameSettings): Promise<SaveSettingsResult> => {
      const issues = checkGameSettings(settings);
      if (hasGameSettingsErrors(issues)) return { messages: issues.map(formatGameSettingsIssue), ok: false };
      const snapshot = { revision: localRulesRevision(settings), settings };
      await (await database).writeValue(CACHED_SETTINGS_KEY, JSON.stringify(snapshot));
      return { ok: true, snapshot, warnings: issues.map(formatGameSettingsIssue) };
    },
    store: "local"
  };
};
