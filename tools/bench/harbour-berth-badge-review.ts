import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { trackPageErrors, waitForIsland } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Harbour placement badge (owner, 2026-10-15), High and Minimal: the placement ghost on a plot whose
 * harbour gets two berths ("2 berths") and on one that gets one ("1 berth").
 * Usage: npx tsx tools/bench/harbour-berth-badge-review.ts
 */
const output = resourcesPath("ship-motion", "harbour-berth-badge");
mkdirSync(output, { recursive: true });
type Page = import("playwright-core").Page;

/** Valid harbour plots near the headquarters, one per berth count (searched in the page). */
const findPlots = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation, hq = simulation.headquarters;
  const found: Record<number, { rotation: number; x: number; z: number }> = {};
  for (let radius = 4; radius <= 40 && Object.keys(found).length < 2; radius++)
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      // Plot centres lie on cell centres or cell corners, depending on the footprint's sides.
      for (let rotation = 0; rotation < 2; rotation++) for (const offset of [0, .5]) {
        const x = Math.floor(hq.x) + dx + offset, z = Math.floor(hq.z) + dz + offset;
        if (simulation.validatePlacement(39, x, z, rotation) !== null) continue;
        const berths = simulation.harbourBerthPreview(39, x, z, rotation);
        if (berths && !found[berths]) found[berths] = { rotation, x, z };
      }
    }
  return found;
});

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => quality);
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    // The harbour review's island: its headquarters' territory reaches the ocean shore.
    await page.goto(`${url}?quality=${quality}&seed=12&size=128&mountains=0&forest=0&cache=0&skipLogin=1`);
    await waitForIsland(page);
    const plots = await findPlots(page);
    assert(Object.keys(plots).length, "No valid harbour plot near the headquarters");
    for (const [berths, plot] of Object.entries(plots)) {
      await page.evaluate(({ rotation, x, z }) => {
        const settlement = (window as any).__settlement;
        settlement.focusGround(x, z);
        settlement.controls.selectBuilding(39);
        for (let turn = 0; turn < rotation; turn++) settlement.controls.rotate();
      }, plot);
      // Project once the camera has moved there (picking uses the last frame's camera).
      await page.waitForTimeout(600);
      const point = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), plot);
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(output, `${quality}-${berths}-berths.png`) });
      await page.evaluate(() => (window as any).__settlement.controls.cancel());
    }
    report[quality] = { errors, plots };
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
