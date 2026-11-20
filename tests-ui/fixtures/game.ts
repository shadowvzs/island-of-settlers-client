import { expect, type Page,test as base } from "@playwright/test";

import { UI_TEST_URL } from "./server";
import { resetUi } from "./ui";

export interface GameOptions {
  quality: "high" | "minimal";
  screen: { height: number; width: number };
}

export interface GamePage {
  /** Page errors since the last case finished (the case fixture fails on any). */
  errors: string[];
  page: Page;
  screen: GameOptions["screen"];
}

/**
 * Smallest map that boots a full settlement, fixed seed, island cache off (fresh code every run).
 * Automated browsers skip the account scroll and start as a guest.
 */
const GAME_QUERY = "size=64&seed=123&cache=0";
const READY_TIMEOUT = 150_000;

const openGame = async (page: Page, quality: GameOptions["quality"]) => {
  // No backend in the UI layer: the chat socket would only retry.
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}?quality=${quality}&${GAME_QUERY}`);
  await page.waitForFunction(() => Boolean(window.__islandReady), null, { timeout: READY_TIMEOUT });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
};

/**
 * `game`: ONE game page per worker (= per quality × viewport project), loaded once and reused by
 * every case — a game load costs ~10–30 s, a case well under a second. Cases leave the UI as they
 * found it; the automatic `cleanCase` fixture closes leftovers and fails the case on page errors.
 */
export const test = base.extend<{ cleanCase: void }, { game: GamePage; gameOptions: GameOptions }>({
  cleanCase: [async ({ game }, use) => {
    await use();
    const errors = game.errors.splice(0);
    await resetUi(game.page);
    expect(errors, "page errors during the case").toEqual([]);
  }, { auto: true }],
  game: [async ({ browser, gameOptions }, use) => {
    const page = await browser.newPage({ viewport: gameOptions.screen });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openGame(page, gameOptions.quality);
    await use({ errors, page, screen: gameOptions.screen });
    await page.close();
  }, { scope: "worker", timeout: READY_TIMEOUT + 30_000 }],
  gameOptions: [
    { quality: "minimal", screen: { height: 800, width: 1280 } },
    { option: true, scope: "worker" }
  ]
});

export { expect };
