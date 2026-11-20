import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Player corner review: HUD, quest book (list + details), gem shop purchase, portrait toggle,
 * light and dark paper themes, desktop and phone widths, on High and Minimal.
 */
const saved = JSON.parse(readFileSync("/home/shadowvzs/Downloads/island-settlers-2026-10-11.json", "utf8"));
// Isolated fixture: level 10 (delivery quests start there), five XP short of level 11, so one quest
// shows the level-up popup; gems to shop with.
saved.player = { experience: 995, gems: 40, questDay: "", quests: [], seed: 1234, version: 1 };
const output = resolve("../resources/settlement-previews/player-hud-shop-quests");
mkdirSync(output, { recursive: true });
const shot = (name: string) => resolve(output, `${name}.png`);
const hudClip = { height: 300, width: 420, x: 0, y: 0 };
/** Lets freshly built window images decode before a screenshot. */
const settle = (page: Page) => page.waitForTimeout(400);

const loadFixture = async (page: Page, url: string, quality: string) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/hud-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}hud-fixture.html`);
  await page.evaluate(async fixture => {
    localStorage.removeItem("island-of-settlers.portrait-hidden");
    localStorage.removeItem("island-of-settlers.hud-paper-theme");
    const { openLocalSaveStore } = await import(
      /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const storage = await openLocalSaveStore();
    await storage.writeStartupGame(JSON.stringify(fixture));
  }, saved);
  await page.goto(`${url}?quality=${quality}`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.locator(".player-hud").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1200);
};

const headquartersStock = (page: Page, ware: string) =>
  page.evaluate(name => (window as any).__settlement.simulation.headquarters.inventory[name] ?? 0, ware);

const reviewQuests = async (page: Page, quality: string) => {
  // Stock every quest ware so a delivery can be paid; the badge then counts the claimable quests.
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    Object.assign(simulation.headquarters.inventory, { fish: 99, logs: 99, meat: 99, stone: 99, water: 99 });
  });
  await page.waitForTimeout(700);
  assert.notEqual(await page.locator(".player-hud__quest-badge").innerText(), "");
  await page.screenshot({ path: shot(`${quality}-hud-badge`), clip: hudClip });
  await page.locator(".player-hud__quests").click();
  const questWindow = page.locator(".settlement-ui__quest-window");
  await questWindow.waitFor({ state: "visible" });
  const entries = questWindow.locator(".quest-window__entry");
  const before = await entries.count();
  assert.equal(await entries.first().getAttribute("aria-selected"), "true");
  await settle(page);
  await questWindow.screenshot({ path: shot(`${quality}-quests`) });
  await entries.filter({ hasText: /^Deliver/ }).first().click();
  await questWindow.getByRole("button", { name: "Deliver", exact: true }).click();
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible", timeout: 5000 });
  assert.match(await popup.innerText(), /Level 11!/);
  await popup.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await entries.count(), before - 1, "claimed quests leave the list");
  await settle(page);
  await questWindow.screenshot({ path: shot(`${quality}-quests-after-claim`) });
  await questWindow.getByRole("button", { name: "Close daily quests window" }).click();
};

const reviewShop = async (page: Page, quality: string) => {
  await page.locator(".player-hud__gems").click();
  const shop = page.locator(".settlement-ui__gem-shop-window");
  await shop.waitFor({ state: "visible" });
  await settle(page);
  await shop.screenshot({ path: shot(`${quality}-shop`) });
  const logs = await headquartersStock(page, "logs");
  await shop.locator('[data-offer-id="logs-100"] button').click();
  assert.equal(await headquartersStock(page, "logs"), logs + 100);
  // 40 gems + 5 for reaching level 11 - 10 for the logs.
  assert.match(await page.locator(".player-hud__gems").innerText(), /^35$/);
  assert.equal(await shop.locator('[data-offer-id="coins-500"] button').isDisabled(), true);
  await settle(page);
  await shop.screenshot({ path: shot(`${quality}-shop-after-purchase`) });
  await shop.getByRole("button", { name: "Close gem shop window" }).click();
};

const reviewPortraitToggle = async (page: Page, quality: string) => {
  const portrait = page.locator(".player-hud__portrait");
  await page.locator(".player-hud__experience").click();
  assert.equal(await portrait.isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("island-of-settlers.portrait-hidden")), "1");
  await page.screenshot({ path: shot(`${quality}-portrait-hidden`), clip: hudClip });
  await page.locator(".player-hud__experience").click();
  assert.equal(await portrait.isVisible(), true);
};

/** The theme button opens a popover; pick the mode there and close it again. */
const pickHudMode = async (page: Page, mode: "light" | "dark") => {
  await page.locator(".hud-theme-toggle").click();
  await page.locator(`[data-hud-mode="${mode}"]`).click();
  await page.keyboard.press("Escape");
};

const reviewDarkTheme = async (page: Page, quality: string) => {
  await pickHudMode(page, "dark");
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot(`${quality}-dark-hud`), clip: hudClip });
  await page.locator(".player-hud__gems").click();
  await settle(page);
  await page.locator(".settlement-ui__gem-shop-window").screenshot({ path: shot(`${quality}-dark-shop`) });
  await page.getByRole("button", { name: "Close gem shop window" }).click();
  await page.locator(".player-hud__quests").click();
  await settle(page);
  await page.locator(".settlement-ui__quest-window").screenshot({ path: shot(`${quality}-dark-quests`) });
  await page.getByRole("button", { name: "Close daily quests window" }).click();
  await pickHudMode(page, "light");
};

const reviewPhone = async (page: Page, quality: string) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(`${quality}-phone`) });
  await page.locator(".player-hud__quests").click();
  await settle(page);
  await page.screenshot({ path: shot(`${quality}-phone-quests`) });
  await page.getByRole("button", { name: "Close daily quests window" }).click();
  await page.locator(".player-hud__gems").click();
  await settle(page);
  await page.screenshot({ path: shot(`${quality}-phone-shop`) });
  await page.getByRole("button", { name: "Close gem shop window" }).click();
  await page.locator(".player-hud__experience").click();
  await page.screenshot({ path: shot(`${quality}-phone-portrait-hidden`) });
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await loadFixture(page, url, quality);
    const text = await page.locator(".player-hud").innerText();
    assert.match(text, /95 \/ 100 XP/);
    assert.equal(await page.locator(".player-hud__quests").count(), 1);
    await page.screenshot({ path: shot(`${quality}-hud`), clip: hudClip });
    await reviewQuests(page, quality);
    await reviewShop(page, quality);
    await reviewPortraitToggle(page, quality);
    if (quality === "high") await reviewDarkTheme(page, quality);
    await reviewPhone(page, quality);
    reports.push({ errors, quality, text });
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(output, JSON.stringify(reports.map(report => ({ quality: report.quality, text: report.text }))));
