import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATEGORY_GROUPS, getBuildingCategory } from "../../src/render-common/buildings/building-menu-groups";
import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentCategory } from "./development-ui-helpers";
import { resourcesPath } from "./resources-path";

/** Footprint tabs (≤4 Small, ≤5 Medium, >5 Big, owner Medium exceptions) plus the Mines tab. */

const output = resourcesPath("settlement-previews", "player-nation-ui");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}?size=96&quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180000 });
    // The player nation choice (3D helmet radio buttons) lives in the development panel.
    await openDevelopmentCategory(page, "Appearance");
    const picker = page.getByRole("radiogroup", { name: "Player nation", exact: true });
    for (const nation of ["roman", "viking", "japanese", "nubian"]) {
      await picker.locator(`[data-nation="${nation}"]`).click();
      await page.waitForFunction(nation => (window as any).__settlement.simulation.playerNation() === nation,
        nation, { timeout: 120000 });
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(
        '[role="radiogroup"][aria-label="Player nation"] button')].every(button => !button.disabled));
      const report = await page.evaluate(() => {
        const live = (window as any).__settlement;
        return { nation: live.simulation.playerNation(), saved: live.simulation.saveState().playerNation,
          workerNations: [...new Set(live.workerFrames.map((frame: any) => frame.nation))],
          buildingNations: [...new Set(live.update(0).buildings.map((frame: any) => frame.nation))],
          cachedIcons: [...document.querySelectorAll<HTMLImageElement>('img[data-building-icon]')]
            .map(image => image.getAttribute("src")) };
      });
      assert.equal(report.nation, nation); assert.equal(report.saved, nation);
      assert(report.workerNations.every(value => value === nation));
      assert(report.buildingNations.length > 0 && report.buildingNations.every(value => value === nation));
      assert(report.cachedIcons.length > 0 && report.cachedIcons.every(source => source?.includes(`/${nation}-`)));
      reports.push({ quality, ...report });
      await page.screenshot({ path: resolve(output, `${quality}-${nation}.png`) });
    }
    await page.getByRole("button", { name: "Close development tools panel", exact: true }).click();
    await page.getByRole("button", { name: "Build", exact: true }).click();
    const tabs = page.getByRole("tablist", { name: "Building categories" }).getByRole("tab");
    assert.equal(await tabs.count(), BUILDING_CATEGORY_GROUPS.length);
    for (const [index, { id: category }] of BUILDING_CATEGORY_GROUPS.entries()) {
      await tabs.nth(index).click();
      const ids = await page.locator(".settlement-ui__cards:not([hidden]) button[data-building]")
        .evaluateAll(cards => cards.map(card => Number((card as HTMLElement).dataset.building)));
      assert(ids.length > 0);
      for (const id of ids) {
        assert.equal(getBuildingCategory(id), category);
      }
    }
    await page.setViewportSize({ width: 390, height: 800 });
    const tabBounds = await tabs.evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect(); return { left: rect.left, right: rect.right };
    }));
    assert(tabBounds.every(bounds => bounds.left >= 0 && bounds.right <= 390));
    await page.screenshot({ path: resolve(output, `${quality}-size-tabs-phone.png`) });
    assert.deepEqual(errors, []); await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log("Player nations, persisted choices, all four building tabs and phone bounds pass.");
} finally { await browser.close(); await server.close(); }
