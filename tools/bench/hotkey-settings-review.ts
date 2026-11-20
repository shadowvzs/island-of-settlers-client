import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "hotkey-settings-2026-11-03");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], rows: unknown[] = [];
let status = "running";
try {
  for (const quality of ["high", "minimal"] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(quality => {
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
    }, quality);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const openSettings = async () => {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("tab", { name: "Hotkeys", exact: true }).click();
    };
    await page.goto(url);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    await openSettings();
    const names = page.getByRole("textbox", { name: "Toggle building names", exact: true });
    await names.focus(); await names.press("KeyB");
    assert.equal(await names.inputValue(), "B");
    await page.getByRole("tab", { name: "Possessed mode", exact: true }).click();
    await page.getByRole("textbox", { name: "Move forward", exact: true }).focus();
    await page.keyboard.press("KeyW");
    assert.equal(await page.getByRole("textbox", { name: "Move forward", exact: true }).inputValue(), "W");
    await page.getByRole("textbox", { name: "Move backward", exact: true }).focus();
    await page.keyboard.press("KeyW");
    assert.match(await page.locator(".hotkey-settings__error").innerText(), /already assigned/);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("textbox", { name: "Move backward", exact: true }).inputValue(), "↓");
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await names.focus(); await page.keyboard.press("KeyQ");
    await page.evaluate(() => document.body.focus());
    const before = await page.locator("canvas.settlement-building-names").evaluate(element => (element as HTMLCanvasElement).hidden);
    await page.keyboard.press("KeyN");
    assert.equal(await page.locator("canvas.settlement-building-names").evaluate(element => (element as HTMLCanvasElement).hidden), before);
    await page.keyboard.press("KeyQ");
    assert.equal(await page.locator("canvas.settlement-building-names").evaluate(element => (element as HTMLCanvasElement).hidden), !before);
    await page.screenshot({ path: resolve(output, `${quality}-hotkeys.png`) });
    await page.reload();
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    await openSettings();
    assert.equal(await names.inputValue(), "Q");
    const general = page.getByRole("tab", { name: "General", exact: true });
    await general.focus(); await general.press("ArrowRight");
    assert.equal(await page.getByRole("tab", { name: "Possessed mode", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("textbox", { name: "Move forward", exact: true }).inputValue(), "W");
    await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    assert.equal(await names.inputValue(), "N");
    await page.getByRole("tab", { name: "Sounds", exact: true }).click();
    const sound = page.getByRole("checkbox", { name: "Sound", exact: true });
    await sound.check();
    await sound.uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem("island-of-settlers.sound.master-volume")), "0");
    await sound.check();
    assert.equal(await page.evaluate(() => localStorage.getItem("island-of-settlers.sound.master-volume")), "100");
    const environment = page.getByRole("slider", { name: /^Environment volume/ });
    await environment.fill("0");
    const layers = page.locator(".sound-controls__layers input");
    assert.equal(await layers.count(), 4);
    for (const layer of await layers.all()) {
      assert.equal(await layer.isChecked(), false); assert.equal(await layer.isDisabled(), true);
    }
    await environment.fill("50");
    for (const layer of await layers.all()) {
      assert.equal(await layer.isChecked(), false); assert.equal(await layer.isDisabled(), false);
    }
    // Paper checkbox checkmarks animate for120ms; capture their settled state.
    await page.waitForTimeout(180);
    await page.screenshot({ path: resolve(output, `${quality}-sounds.png`) });
    rows.push({ quality, persisted: true, sameModeConflict: true, customToggle: true,
      restoredDefaults: true, soundMasterZeroHundred: true, environmentZeroDisablesAndUnchecks: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  status = "passed";
} finally {
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, rows, errors,
    scope: "Real Settings DOM and building-name action in High/Minimal; CPU tests separately cover live possessed remap and held-input release. No full E2E or performance claim." }, null, 2));
}
