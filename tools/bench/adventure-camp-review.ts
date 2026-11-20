import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import {
  gameErrors, lookAt, openFreshIsland, runDevelopmentTool, sailUntilLanded, trackPageErrors, visitIsland
} from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/** Real debug voyage/visit and saved camp centres, through the normal terrain and render layers. */
const output = resourcesPath("project-reviews", "codex-2026-10-15", "adventure-camps");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const quality of (process.env.QUALITY ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => quality);
    await openFreshIsland(page, url, quality);
    await runDevelopmentTool(page, "Test adventure", async () => {});
    const voyage = await sailUntilLanded(page); assert.equal(voyage.status, "arrived");
    await visitIsland(page, "[data-adventure-visit]");
    const camps = await page.evaluate(() => (window as any).__settlement.simulation.adventureCampSites());
    assert(camps.length > 0 && camps.length <= 6);
    const diagnostics = await page.evaluate(async () => {
      const simulation = (window as any).__settlement.simulation;
      const source = (name: string) => import(name);
      const { chooseAdventureWorld } = await source("/src/shared/settlement/colony-world-choice.ts");
      const { adventureCampLayout, createThreeAdventureCamps } = await source("/src/renderers/three/settlement/three-adventure-camps.ts");
      const world = chooseAdventureWorld(simulation.adventure().island);
      const frames = (window as any).__settlement.update(0).adventureCamps;
      const layer = createThreeAdventureCamps(world, false); layer.update(frames);
      const count = layer.root.children.length; layer.dispose();
      return { count, frames, layout: adventureCampLayout(world, frames[0], frames) };
    });
    await page.evaluate(() => {
      for (const panel of document.querySelectorAll<HTMLElement>(".colony-tracker, .settlement-ui__panel, .settlement-ui__status")) panel.style.display = "none";
    });
    const tent = diagnostics.layout.find((part: any) => part.kind === "tent");
    assert(tent, "The actual camp should have a tent on safe outer ground");
    const campFocus = { x: camps[0].x + tent.x / 2, z: camps[0].z + tent.z / 2 };
    await lookAt(page, campFocus); await page.mouse.move(640, 430);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(output, `${quality}-gameplay.png`) });
    await page.mouse.wheel(0, -950); await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(output, `${quality}-close.png`) });
    await lookAt(page, { x: camps[0].x + tent.x, z: camps[0].z + tent.z });
    await page.mouse.wheel(0, -600); await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(output, `${quality}-tent-close.png`) });
    report[quality] = { camps, diagnostics, errors: gameErrors(errors), voyage };
    assert.deepEqual(gameErrors(errors), []); await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, report }, null, 2));
} finally { await browser.close(); await server.close(); }
