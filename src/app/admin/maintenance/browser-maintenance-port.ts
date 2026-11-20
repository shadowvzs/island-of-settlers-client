import { clearIslandCache } from "../../island-cache";
import { openMapStorage } from "../../map-editor/map-storage";
import { openGameDatabase } from "../../settlement/game-database";
import { BROWSER_LOG_KEY, KEPT_BROWSER_VALUES } from "./constants";
import { appendBrowserLog } from "./helpers";
import type { BrowserMaintenancePort } from "./maintenance-ports";

type GameDatabase = Awaited<ReturnType<typeof openGameDatabase>>;

/** Console line and boot-value entry of one browser action (no server audit exists for these). */
const logBrowserAction = async (database: GameDatabase, action: string) => {
  console.info(`[admin maintenance] ${action}`);
  const previous = await database.readValue(BROWSER_LOG_KEY);
  await database.writeValue(BROWSER_LOG_KEY, appendBrowserLog(previous, { action, at: new Date().toISOString() }));
};

const readKeptValues = async (database: GameDatabase) =>
  Promise.all(KEPT_BROWSER_VALUES.map(async key => [key, await database.readValue(key)] as const));

/**
 * M11/M12 in this browser: caches (island cache with packed worker results, published starter copies) and the
 * local game database. Other open game tabs keep their own state until they reload.
 */
export const createBrowserMaintenancePort = (): BrowserMaintenancePort => ({
  clearCaches: async () => {
    await clearIslandCache();
    const maps = await openMapStorage();
    try {
      await maps?.removePublishedCopies();
    } finally {
      maps?.close();
    }
    await logBrowserAction(await openGameDatabase(), "caches.clear");
  },
  recreateDatabase: async () => {
    console.info("[admin maintenance] browser-database.recreate");
    await (await openGameDatabase()).recreateDatabase();
  },
  resetGames: async () => {
    const database = await openGameDatabase();
    const kept = await readKeptValues(database);
    await database.clearAllGames();
    for (const [key, value] of kept) if (value !== null) await database.writeValue(key, value);
    await logBrowserAction(database, "browser-games.reset");
  }
});
