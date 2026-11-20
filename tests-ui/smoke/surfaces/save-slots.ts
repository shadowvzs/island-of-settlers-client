import type { Page } from "@playwright/test";

import { GAME_SETTINGS_PRESETS } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { expect, test } from "../../fixtures/game";
import { UI_TEST_URL } from "../../fixtures/server";
import { expectInsideViewport } from "../../fixtures/ui";

/**
 * SAVE-SLOTS on the title page (offline without a home, automatic saving off): two slots copied from the working
 * slot in the game-session worker show under Load, Continue is the newest slot, and Delete asks first. The deep
 * checks (record-level round trip, the in-game flow) live in `tools/bench/save-slots-review.ts`.
 */
const seedSlots = (page: Page) => page.evaluate(async () => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const [{ openGameDatabase }, { copyGameSlotInWorker }] = await Promise.all([
    load("/src/app/settlement/game-database.ts"), load("/src/app/settlement/game-session-worker.ts")]);
  const database = await openGameDatabase();
  await database.writeValue("offline.story/story-progress", JSON.stringify({ experience: 0 }));
  const raw: IDBDatabase = await new Promise(resolve => {
    const open = indexedDB.open("island-settlers-db");
    open.onsuccess = () => resolve(open.result);
  });
  await new Promise<void>(resolve => {
    const transaction = raw.transaction(["sessions"], "readwrite");
    transaction.objectStore("sessions").put({ active: null, id: "offline.story", savedAt: 1 });
    transaction.oncomplete = () => resolve();
  });
  await copyGameSlotInWorker({ from: "offline.story", meta: { label: "First", savedAt: 1 }, to: "offline.story.1" });
  await copyGameSlotInWorker({ from: "offline.story", meta: { label: "Second", savedAt: 2 }, to: "offline.story.2" });
});

test.describe("save slots", () => {
  test("title page: Load lists the slots, Delete asks first", async ({ browser, game }) => {
    const page = await browser.newPage({ viewport: game.screen });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/game-settings.json", route => route.fulfill({ json: GAME_SETTINGS_PRESETS.story }));
    await page.route("**/slots-fixture.html",
      route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
    await page.goto(`${UI_TEST_URL}slots-fixture.html`);
    await seedSlots(page);
    await page.goto(`${UI_TEST_URL}?login=1&size=64&cache=0`);
    const panel = page.locator(".title-page__panel");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.locator('[data-title-entry="continue"]'), "Continue = the newest slot").toBeEnabled();
    await panel.locator('[data-title-entry="load"]').click();
    await expect(panel.locator("[data-save-slot]")).toHaveCount(2);
    await expectInsideViewport(page, panel, true);
    await panel.locator('[data-save-slot="1"] [data-save-slot-action="delete"]').click();
    await expect(panel.locator(".save-slots__question")).toHaveText("Delete the save in slot 1?");
    await panel.locator("[data-save-slot-confirm]").click();
    await expect(panel.locator("[data-save-slot]")).toHaveCount(1);
    await expect(panel.locator(".save-slots__status")).toHaveText("Slot 1 deleted");
    expect(errors).toEqual([]);
    await page.close();
  });
});
