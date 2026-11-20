import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Gentle beach review (owner 2026-10-13): photographs the sea beaches nearest the start of several
 * seeds on High and Minimal, close and at gameplay distance, looking from the land out to sea.
 * Run: `npx tsx tools/bench/beach-review.ts` (SEEDS=123,7 QUALITIES=minimal OUTPUT=dir narrow it).
 */
const output = process.env.OUTPUT ?? resourcesPath("settlement-previews", "beaches");
mkdirSync(output, { recursive: true });
const seeds = (process.env.SEEDS ?? "1234,123,7,42").split(",").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const VIEWS = [{ name: "close", tilt: -0.25, zoom: 3 }, { name: "normal", tilt: 0, zoom: 1.4 }];

/** In the page: sea shore vertices (beach, not cliff) nearest the start, spread apart. */
const findBeaches = () => {
  const { world } = (window as any).__beachReview;
  const stride = world.cellsX + 1, start = world.start;
  const isSea = (index: number) => world.waterDepth[index] > 0 && world.riverDistance[index] > 6;
  const shores: { distance: number; seaX: number; seaZ: number; x: number; z: number }[] = [];
  for (let z = 2; z < world.cellsZ - 2; z++) for (let x = 2; x < world.cellsX - 2; x++) {
    const index = z * stride + x;
    if (world.waterDepth[index] > 0 || world.heights[index] > 0.6) continue;
    let seaX = 0, seaZ = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (isSea(index + dz * stride + dx)) { seaX += dx; seaZ += dz; }
    }
    if (seaX === 0 && seaZ === 0) continue;
    const length = Math.hypot(seaX, seaZ);
    shores.push({ distance: Math.hypot(x - start.x, z - start.z), seaX: seaX / length, seaZ: seaZ / length, x, z });
  }
  shores.sort((first, second) => first.distance - second.distance);
  const picked: typeof shores = [];
  for (const shore of shores) {
    if (picked.every(other => Math.hypot(other.x - shore.x, other.z - shore.z) > 30)) picked.push(shore);
    if (picked.length === 3) break;
  }
  return picked;
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const seed of seeds) for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/src/app/main.ts", async route => {
      const response = await route.fetch(), text = await response.text();
      assert(text.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: text.replace("window.__islandReady = true",
        "window.__beachReview = { world, camera }; window.__islandReady = true") });
    });
    await page.goto(`${url}?quality=${quality}&seed=${seed}&reveal=1&time=day&cache=0`);
    await page.waitForFunction(() => Boolean((window as any).__beachReview), null, { timeout: 300000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const beaches = await page.evaluate(findBeaches);
    report[`${seed}-${quality}`] = beaches;
    for (const [number, beach] of beaches.entries()) for (const view of VIEWS) {
      await page.evaluate(({ beach, view }) => Object.assign((window as any).__beachReview.camera, {
        centerX: beach.x + beach.seaX * 2, centerZ: beach.z + beach.seaZ * 2, tilt: view.tilt,
        yaw: Math.atan2(-beach.seaX, beach.seaZ), zoom: view.zoom }), { beach, view });
      await page.waitForTimeout(700);
      await page.screenshot({ path: resolve(output, `${seed}-${quality}-beach${number + 1}-${view.name}.png`) });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  console.log(`Beach review: ${output}`);
} finally {
  await browser.close(); await server.close();
}
