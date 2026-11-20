import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gameErrors, lookAt, trackPageErrors, waitForIsland } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Native review of the residences (POP-02): raises the small, medium and big residence on a fresh
 * seed-123 Roman island and shoots each at gameplay distance and close up, on High and Minimal.
 * Run: `npx tsx tools/bench/residence-review.ts`.
 */
const QUALITIES = (process.env.QUALITY ?? "high,minimal").split(",");
const RESIDENCES = [57, 58, 59];
const output = resourcesPath("settlement-previews", "residences");
mkdirSync(output, { recursive: true });

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of QUALITIES) {
    const page = await browser.newPage({ viewport: { height: 860, width: 1280 } });
    const errors = trackPageErrors(page, () => quality);
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&forest=0&cache=0`);
    await waitForIsland(page);
    for (const typeId of RESIDENCES) {
      const site = await page.evaluate(id => {
        const result = (window as any).__settlement.simulation.debugRaiseBuilding(id);
        return result.ok ? { x: result.building.x, z: result.building.z } : null;
      }, typeId);
      assert(site, `residence ${typeId} could not be raised`);
      await lookAt(page, site);
      await page.mouse.move(640, 430);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(output, `${quality}-${typeId}-normal.png`) });
      await page.mouse.wheel(0, -1200);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(output, `${quality}-${typeId}-close.png`) });
      await page.mouse.wheel(0, 1200);
    }
    assert.deepEqual(gameErrors(errors), []);
    await page.close();
  }
  console.log(`Residence review: ${output}`);
} finally { await browser.close(); await server.close(); }
