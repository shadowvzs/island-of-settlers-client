import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { closeDevelopment,openDevelopmentAction, openDevelopmentCategory } from "./development-ui-helpers";

/**
 * Development menu with the info icon, the info panel, the player nation select, the wider camera
 * panel and the paper checkboxes, on desktop and phone in both HUD themes (OUT_DIR as in shots).
 */
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/ui-panels";
const VIEWPORTS = [
  ["desktop", { height: 900, width: 1600 }],
  ["phone", { height: 800, width: 390 }]
] as const;
const THEMES = ["light", "dark"] as const;

/** Reach controls through their actual visible HUD entry points. */
const openCornerPanel = async (page: Page, label: string) => {
  const button = page.getByRole("button", { name: label, exact: true });
  if (!await button.isVisible() && label === "Settings")
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await button.click();
};

const shoot = (page: Page, name: string) => page.screenshot({ path: join(outDir, `${name}.png`) });

const reviewDevelopmentMenu = async (page: Page, prefix: string) => {
  await openDevelopmentCategory(page, "Appearance");
  assert.equal(await page.locator(".development-menu [aria-label='Show info']").count(), 1);
  // The nation is picked with the 3D helmet radio buttons (Roman, Viking, Japanese, Nubian).
  assert.equal(await page.locator(".development-menu .race-picker [role='radio']").count(), 4);
  await shoot(page, `${prefix}-development`);
  await (await openDevelopmentAction(page, "Show info")).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".stats-overlay").isVisible(), true);
  assert.equal(await page.locator(".development-menu").isVisible(), false);
  await shoot(page, `${prefix}-info-panel`);
};

const reviewInfoDrag = async (page: Page) => {
  const panel = page.locator(".stats-overlay");
  const before = (await panel.boundingBox())!;
  const handle = (await panel.locator(".settlement-ui__drag-handle").boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + handle.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!;
  assert.ok(Math.abs(after.y - before.y - 60) < 2, "info panel follows the drag handle");
};

const reviewInfoClose = async (page: Page) => {
  await reviewInfoDrag(page);
  await page.click(".stats-overlay .settlement-ui__panel-header button");
  assert.equal(await page.locator(".stats-overlay").isVisible(), false);
  const stored = await page.evaluate(() => localStorage.getItem("island-of-settlers.info-box"));
  console.log("info box stored after close:", stored);
};

const reviewCheckboxes = async (page: Page, prefix: string) => {
  await openCornerPanel(page, "Settings");
  const critters = page.locator(".settings-panel__check").filter({ hasText: "Critters" });
  await critters.scrollIntoViewIfNeeded();
  await shoot(page, `${prefix}-settings-checkboxes`);
  const box = critters.locator("input");
  const before = await box.isChecked();
  await box.focus();
  await page.keyboard.press("Space");
  assert.equal(await box.isChecked(), !before);
  await page.keyboard.press("Space");
  assert.equal(await box.isChecked(), before);
  await shoot(page, `${prefix}-settings-checkboxes-focus`);
  await page.locator(".settings-panel__check").filter({ hasText: "Wildlife" }).scrollIntoViewIfNeeded();
  await shoot(page, `${prefix}-sound-checkboxes`);
};

/** The rail replaces the removed Army dialog. Empty and enabled troop choices are distinct states. */
const reviewArmyCheckboxes = async (page: Page, prefix: string) => {
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Army", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Select troops", exact: true }).click();
  const panel = page.getByRole("region", { name: "Select troop types", exact: true });
  await panel.waitFor({ state: "visible" });
  const boxes = panel.getByRole("checkbox"); assert.equal(await boxes.count(), 4);
  for (let index = 0; index < 4; index++) assert.equal(await boxes.nth(index).isDisabled(), true);
  await shoot(page, `${prefix}-empty-troop-selection`);
  await page.getByRole("button", { name: "Close troop selection", exact: true }).click();
  await (await openDevelopmentAction(page, "Start training encounter")).click();
  await closeDevelopment(page);
  await page.getByRole("button", { name: "Select troops", exact: true }).click();
  await boxes.first().waitFor({ state: "visible" });
  for (let index = 0; index < 4; index++) {
    const box = boxes.nth(index); assert.equal(await box.isDisabled(), false);
    await box.focus(); const checked = await box.isChecked();
    await page.keyboard.press("Space"); assert.equal(await box.isChecked(), !checked);
    await page.keyboard.press("Space"); assert.equal(await box.isChecked(), checked);
  }
  await shoot(page, `${prefix}-training-troop-selection`);
  await page.getByRole("button", { name: "Close troop selection", exact: true }).click();
  // Soldier equipment belongs to local building windows, not this rail.
  const home = await page.evaluate(() => {
    const app = (window as any).__settlement, home = app.simulation.home();
    app.focusGround(home.x, home.z); return { x: home.x, z: home.z };
  });
  const point = await page.evaluate(home => (window as any).__settlement.projectGround(home.x, home.z), home);
  await page.mouse.click(point.x, point.y);
  const roster = page.getByRole("region", { name: "Soldier details and equipment", exact: true });
  await roster.waitFor({ state: "visible" });
  assert((await roster.getByRole("combobox").count()) > 0);
  const equipment = roster.getByRole("combobox").first();
  await equipment.focus();
  const handle = await equipment.elementHandle();
  await page.waitForTimeout(300);
  assert(await equipment.evaluate((element, original) => element === original && document.activeElement === element, handle));
  await shoot(page, `${prefix}-building-soldier-roster`);
  await page.keyboard.press("Escape");
};

const reviewViewport = async (page: Page, prefix: string) => {
  await reviewDevelopmentMenu(page, prefix);
  await reviewInfoClose(page);
  await openCornerPanel(page, "Camera controls");
  const width = await page.locator(".camera-controls-panel").evaluate((panel) => panel.clientWidth);
  console.log(prefix, "camera panel width", width);
  await shoot(page, `${prefix}-camera`);
  await reviewCheckboxes(page, prefix);
  await reviewArmyCheckboxes(page, prefix);
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  for (const [name, viewport] of VIEWPORTS) {
    for (const theme of THEMES) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript((value) => {
        localStorage.setItem("island-of-settlers.hud-paper-theme", value);
      }, theme);
      await page.goto(`${url}?seed=1234&size=96`);
      await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
      await page.waitForTimeout(1200);
      await reviewViewport(page, `${name}-${theme}`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  await browser.close();
  await server.close();
};

await main();
