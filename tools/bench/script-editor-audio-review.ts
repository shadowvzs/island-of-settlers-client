import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the Script workspace's audio picker (lane AUDIO-CATALOG) through the real UI: a "play the music" action
 * is added to a template trigger, its track slot opens the picker (collection tabs, search, preview buttons), then
 * the "Uploaded" tab with the own-or-licence-free confirmation.
 * Run: npx tsx --env-file=<file with OUT=<folder> [PORT=<port>] [SCRIPT_LANG=hu]> tools/bench/script-editor-audio-review.ts
 */
const DESKTOP = { height: 860, width: 1366 };
const SETTLE_MS = 400;
const MUSIC_ACTION = /play the music|lejátssza a zenét|spiele die Musik/;
const MUSIC_SLOT_COUNT = 5;
const out = process.env.OUT ?? "/tmp/script-editor-audio-review";
const LANGUAGES = new Set(["de", "hu"]);
const language = LANGUAGES.has(process.env.SCRIPT_LANG ?? "") ? process.env.SCRIPT_LANG! : "en";
mkdirSync(out, { recursive: true });

const workspaceWindow = (page: Page) => page.locator(".script-workspace-window");
const dialog = (page: Page) => page.locator(".script-dialog");
const panel = (page: Page) => workspaceWindow(page).locator(".script-workspace__panel:not([hidden])");

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(SETTLE_MS);
  const overflow = await dialog(page).evaluate(host => host.scrollWidth > host.clientWidth + 1);
  await page.screenshot({ path: join(out, `${name}-${language}.png`) });
  console.log(`${name}${overflow ? " (horizontal overflow!)" : ""}`);
};

const openMusicPicker = async (page: Page) => {
  await page.locator(".map-editor__tabs [role=tab]").last().click();
  await page.locator(".map-editor__tab-panel:not([hidden]) button[aria-haspopup=dialog]").click();
  await workspaceWindow(page).locator(".script-workspace").waitFor();
  await workspaceWindow(page).locator(".script-list__toolbar button").nth(1).click();
  await dialog(page).locator(".script-templates button").first().click();
  await dialog(page).locator(".script-dialog__primary").click();
  await panel(page).locator(".script-row__add button").first().click();
  await dialog(page).locator(".script-add__option").filter({ hasText: MUSIC_ACTION }).first().click();
  const slots = panel(page).locator(".script-form .script-slot");
  await slots.nth(await slots.count() - MUSIC_SLOT_COUNT).click();
  await dialog(page).locator(".script-audio").waitFor();
};

const port = Number(process.env.PORT) || undefined;
const { server, url } = await startDevServer({ port });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: DESKTOP });
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await page.addInitScript(locale => localStorage.setItem("island-of-settlers.language", locale), language);
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}editor.html?quality=minimal&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean((window as Window & { __editorReady?: boolean }).__editorReady), null,
    { timeout: 180_000 });
  await openMusicPicker(page);
  await shoot(page, "audio-picker-music-desktop");
  await dialog(page).locator(".script-audio__search").fill("lan");
  await dialog(page).locator(".script-audio .script-picker__tabs [role=tab]").nth(-2).click();
  await shoot(page, "audio-picker-search-desktop");
  await dialog(page).locator(".script-audio__search").fill("");
  await dialog(page).locator(".script-audio .script-picker__tabs [role=tab]").last().click();
  await dialog(page).locator(".script-audio__confirm input").check();
  // The paper checkbox's hover colour hides its checked fill: move the pointer off it for the still.
  await page.mouse.move(0, 0);
  await shoot(page, "audio-picker-uploads-desktop");
} finally {
  await browser.close();
  await server.close();
}
