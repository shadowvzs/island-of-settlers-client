import type { Page } from "playwright-core";

import { openDevelopmentAction } from "./development-ui-helpers";

/**
 * Saves through the live save coordinator. The manual Save now UI was removed (background saves are
 * silent), so tools use the same coordinator the autosave interval and tab-hide flush use.
 */
export const saveFromMenu = async (page: Page) => {
  const saved = await page.evaluate(async () => {
    const settlement = (window as {
      __settlement?: { saving?: { flush: (reason: "manual") => Promise<boolean> } };
    }).__settlement;
    if (!settlement?.saving) throw new Error("The settlement save coordinator is not available");
    return settlement.saving.flush("manual");
  });
  if (!saved) throw new Error("The game did not save");
};

/**
 * Starts the saved game again (Load game is gone: a player resumes the latest save on start). The browser
 * save is staged as the next start's game, then the page reloads; resolves once the island is ready.
 */
export const resumeSavedGame = async (page: Page, timeout = 180_000) => {
  const loaded = page.waitForEvent("load", { timeout });
  await page.evaluate(`(async () => {
    const { openLocalSaveStore } = await import("/src/app/save-store/local-save-store.ts");
    const store = await openLocalSaveStore();
    await store.writeStartupGame(JSON.stringify(await store.readSavedGame()));
    location.reload();
  })()`);
  await loaded;
  await page.waitForFunction(() => (window as { __islandReady?: boolean }).__islandReady === true, null, { timeout });
};

/** Menu > Export game / Import game (the button, so the caller can wait for the download or chooser first). */
/**
 * Export/Import live in Development tools > Diagnostics (the Main selection no longer carries them).
 * Keep the historical helper name because the save/acceptance tools share it.
 */
export const openMenuAction = async (page: Page, name: "Export game" | "Import game") =>
  openDevelopmentAction(page, name);

/** Import game asks before replacing the current game: answers Replace. */
export const confirmImport = (page: Page) =>
  page.getByRole("button", { exact: true, name: "Replace the current game" }).click();
