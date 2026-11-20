import type { Page } from "@playwright/test";

import {
  GAME_SETTINGS_PRESETS, type GameSettings
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { expect, test } from "../../fixtures/game";
import { UI_TEST_URL } from "../../fixtures/server";
import { expectInsideViewport } from "../../fixtures/ui";

/**
 * GS3b: the title page shows before any world when the build's settings play without a home or offline. It gets
 * its own short-lived page: the bundled settings file is answered by a route and `?login=1` keeps the automated
 * browser from booting as a tool run (no `seed`/`map`: those launches boot straight into the game).
 */
const openTitle = async (page: Page, settings: GameSettings) => {
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/game-settings.json", route => route.fulfill({ json: settings }));
  await page.goto(`${UI_TEST_URL}?login=1&size=64&cache=0`);
  const panel = page.locator(".title-page__panel");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  return panel;
};

test.describe("title page", () => {
  test("without a home: its entries, the placeholder, campaigns and settings, no world behind it", async ({
    browser, game
  }) => {
    const page = await browser.newPage({ viewport: game.screen });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const panel = await openTitle(page, GAME_SETTINGS_PRESETS.story);
    const entry = (id: string) => panel.locator(`[data-title-entry="${id}"]`);
    await expect(panel.locator("[data-title-entry]")).toHaveCount(4);
    await expect(entry("continue"), "nothing to continue in a fresh browser").toBeDisabled();
    await expect(entry("multiplayer")).toBeDisabled();
    await expect(entry("multiplayer")).toHaveAttribute("title", "Player versus player maps are planned");
    await expect(panel.getByText("Offline game")).toBeVisible();
    await expectInsideViewport(page, panel, true);
    await entry("campaigns").click();
    await expect(panel.locator(".campaign-window__note")).toBeVisible();
    await panel.locator(".title-page__back").click();
    await entry("settings").click();
    await expect(panel.locator(".language-settings")).toBeVisible();
    await panel.locator(".title-page__back").click();
    await expect(entry("settings")).toBeVisible();
    expect(await page.evaluate(() => Boolean(window.__islandReady)), "no world behind the title page").toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  });

  test("offline with a home: New game hands over to the island boot and drops the title parameter", async ({
    browser, game
  }) => {
    const page = await browser.newPage({ viewport: game.screen });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const panel = await openTitle(page, GAME_SETTINGS_PRESETS.offlineSettlement);
    await expect(panel.locator("[data-title-entry]")).toHaveCount(2);
    await panel.locator('[data-title-entry="newGame"]').click();
    // The title page is gone and the loading scene shows the boot's own steps again. The island boot itself is
    // the ordinary boot path; a second full boot beside every smoke worker's game starves the shared GPU (minutes
    // in "Preparing the first view"), so this case stops at the hand-over.
    await expect(page.locator(".title-page-host")).toHaveCount(0);
    await expect(page.locator("#loading-screen")).not.toHaveClass(/is-title/);
    await expect(page.locator(".loading-screen__message")).toBeVisible();
    expect(new URL(page.url()).searchParams.has("title")).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  });
});
