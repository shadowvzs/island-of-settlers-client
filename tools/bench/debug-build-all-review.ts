import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gameErrors, lookAt, runDevelopmentTool, trackPageErrors, waitForIsland } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Native review of the development menu "Build every building" (and "Get a hand cart") on a fresh
 * seed-123 island with revealed ore: the town after raising every type, on High and Minimal, at
 * gameplay distance and zoomed out. Every raised building must be finished and reach the
 * headquarters by road. Run: `npx tsx tools/bench/debug-build-all-review.ts`.
 */
const QUALITIES = (process.env.QUALITY ?? "high,minimal").split(",");
const output = resourcesPath("settlement-previews", "development-menu", "build-all");
mkdirSync(output, { recursive: true });
type Page = import("playwright-core").Page;

const town = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const home = simulation.headquarters;
  const buildings = simulation.buildings().filter((building: any) => building !== home);
  return { buildings: buildings.length, home: { x: home.x, z: home.z },
    handcarts: simulation.handcarts(home.uid),
    unfinished: buildings.filter((building: any) => building.construction < 1).map((b: any) => b.typeId),
    unconnected: buildings.filter((building: any) => building.status === "Road not connected to storage")
      .map((building: any) => building.typeId),
    staffed: buildings.filter((building: any) => building.worker !== undefined).length };
});

const { server, url } = await startDevServer(), browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const quality of QUALITIES) {
    const page = await browser.newPage({ viewport: { height: 860, width: 1280 } });
    const errors = trackPageErrors(page, () => quality);
    await page.addInitScript("window.__name=value=>value;");
    await page.addInitScript(() => localStorage.setItem("island-of-settlers.reveal-ore", "1"));
    await page.routeWebSocket("**/*", () => {});
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&forest=0&cache=0`);
    await waitForIsland(page);
    const shot = (name: string) => page.screenshot({ path: resolve(output, `${quality}-${name}.png`) });
    const cart = await runDevelopmentTool(page, "Get a hand cart", async () => {});
    const started = Date.now();
    const status = await runDevelopmentTool(page, "Build every building",
      async suffix => { if (suffix) await shot("menu"); });
    await page.waitForFunction(() => [...document.querySelectorAll(".settlement-ui__status")]
      .some(node => node.textContent?.includes("finished building")), null, { timeout: 60000 });
    const seconds = (Date.now() - started) / 1000;
    const summary = await page.evaluate(() => [...document.querySelectorAll(".settlement-ui__status")]
      .map(node => node.textContent?.trim()).find(text => text?.includes("finished building")));
    await page.evaluate(() => {
      for (let second = 0; second < 40; second++) (window as any).__settlement.simulation.update(1);
    });
    const result = await town(page);
    assert.deepEqual(result.unfinished, []);
    assert.deepEqual(result.unconnected, []);
    assert.equal(result.handcarts, 1);
    await lookAt(page, result.home);
    await page.mouse.move(640, 430);
    await page.waitForTimeout(1500);
    await shot("town");
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1500);
    await shot("town-overview");
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(1500);
    await shot("town-close");
    report[quality] = { cart, errors: gameErrors(errors), result, seconds, status, summary };
    assert.deepEqual(gameErrors(errors), []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  console.log(`Build every building review: ${output}`, JSON.stringify(report, null, 2));
} finally { await browser.close(); await server.close(); }
