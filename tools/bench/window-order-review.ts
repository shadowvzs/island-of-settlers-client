import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/window-order");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const width of [1200, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/window-review.html", route => route.fulfill({
      contentType: "text/html", body: "<body style='margin:0;background:#758359'>"
    }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}window-review.html`);
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ String("/src/app/styles.css"));
      const { createSettlementUi } = await import(/* @vite-ignore */ String("/src/app/settlement-ui/index.ts"));
      const ui = createSettlementUi({ onSelectBuilding() {}, onRotate() {}, onRoadMode() {},
        onSettings() {}, onMinimap() {}, onDemolishBuilding: () => true });
      (window as any).__ui = ui;
      ui.onIslandShown(); // the HUD's React content loads once the island is shown
      const { createStatsOverlay } = await import(/* @vite-ignore */ String("/src/app/stats-overlay/stats-overlay.ts"));
      const { createCreditsWindow } = await import(/* @vite-ignore */ String("/src/app/settings/credits-window.ts"));
      const { createCornerPanels } = await import(/* @vite-ignore */ String("/src/app/settings/corner-panel.ts"));
      const info = createStatsOverlay(document.body, { detail: "high", gl: { getExtension: () => null } as any,
        visible: false, onVisibilityChange() {} });
      const credits = createCreditsWindow(document.body);
      const corner = createCornerPanels(document.body, [{ content: document.createElement("div"),
        icon: { kind: "settlement", name: "settings" }, id: "settings", label: "Test settings" }]);
      corner.onIslandShown();
      (window as any).__windowReview = { info, credits, settings: corner.panels[0] };
      ui.update({ buildings: [{ id: "7", type: 36, completed: true, input: { planks: 2 } }] });
    });
    // The HUD and the window frames render with React after their chunks load.
    await page.locator('.settlement-ui [aria-label="Menu"]').click();
    await page.evaluate(() => (window as any).__ui.focusBuilding("7"));
    await page.locator(".settlement-ui__building-details-window:not([hidden])").waitFor();
    await page.evaluate(() => {
      const panels = document.querySelectorAll<HTMLElement>(".settlement-ui .settlement-ui__panel:not([hidden])");
      panels.forEach((panel, index) => {
        panel.style.left = `${10 + index * 70}px`;
        panel.style.top = `${40 + index * 90}px`;
        panel.style.bottom = "auto";
        panel.style.width = `${Math.min(300, innerWidth - 100)}px`;
      });
    });
    const main = page.locator(".settlement-ui__panel--main-selection");
    const details = page.locator(".settlement-ui__building-details-window");
    const top = async () => page.evaluate(() => {
      const node = document.elementFromPoint(100, 160);
      return node?.closest(".settlement-ui__panel")?.className;
    });
    assert.match((await top())!, /building-details-window/);
    await page.mouse.click(30, 60);
    assert.match((await top())!, /panel--main-selection/);
    const detailsBounds = (await details.boundingBox())!;
    await page.mouse.click(detailsBounds.x + detailsBounds.width - 15, detailsBounds.y + 60);
    assert.match((await top())!, /building-details-window/);
    await main.locator(".settlement-ui__drag-handle").focus();
    assert.match((await top())!, /panel--main-selection/);
    await details.locator(".settlement-ui__drag-handle").focus();
    assert.match((await top())!, /building-details-window/);
    await page.mouse.move(30, 80);
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(50);
    assert.match((await top())!, /panel--main-selection/);
    // These windows used to live in independently ranked parent layers.
    await page.evaluate(() => {
      const fixture = (window as any).__windowReview;
      fixture.info.toggle();
      fixture.credits.open();
    });
    await page.locator(".credits-window:not([hidden])").waitFor();
    await page.locator(".stats-overlay:not([hidden])").waitFor();
    await page.evaluate(() => {
      const info = document.querySelector<HTMLElement>(".stats-overlay")!;
      const credits = document.querySelector<HTMLElement>(".credits-window")!;
      for (const [index, panel] of [info, credits].entries()) Object.assign(panel.style, {
        left: `${30 + index * 30}px`, top: `${70 + index * 20}px`, bottom: "auto",
        width: `${Math.min(300, innerWidth - 100)}px`, height: "300px", maxHeight: "none"
      });
    });
    assert.match((await top())!, /credits-window/);
    await page.mouse.click(35, 76);
    assert.match((await top())!, /stats-overlay/);
    await main.locator(".settlement-ui__drag-handle").focus();
    assert.match((await top())!, /panel--main-selection/);
    await page.locator(".stats-overlay .settlement-ui__drag-handle").focus();
    assert.match((await top())!, /stats-overlay/);
    await page.locator(".settings-panel").waitFor({ state: "attached" });
    await page.evaluate(() => {
      const { settings } = (window as any).__windowReview;
      settings.setOpen(true);
      Object.assign(document.querySelector<HTMLElement>(".settings-panel")!.style, { position: "fixed", left: "60px", top: "90px",
        bottom: "auto", right: "auto", width: "220px", height: "300px" });
    });
    assert.equal(await page.evaluate(() => document.elementFromPoint(100, 160)?.closest(".settings-panel") !== null), true);
    await main.locator(".settlement-ui__drag-handle").focus();
    assert.match((await top())!, /panel--main-selection/);
    assert.equal(await page.locator(".app-window-layer").count(), 1);
    await page.evaluate(() => {
      const modal = document.createElement("div"); modal.className = "settlement-popup";
      modal.innerHTML = "<button>Confirmation</button>";
      document.querySelector(".settlement-ui")!.append(modal);
    });
    assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(100, 160)?.closest(".settlement-popup"))), true);
    await page.locator(".settlement-popup:not([hidden])").evaluate(node => node.remove());
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, `${width}-active-shipyard.png`) });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ widths: [1200, 390], pointerAndKeyboard: "passed" }));
  console.log("Window order review passed");
} finally { await browser.close(); await server.close(); }
