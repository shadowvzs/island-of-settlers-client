import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "verification-completion-2026-11-05", "yard-grass",
  process.env.RUN ?? "native-a");
assert(!process.env.RUN || /^[a-z0-9-]+$/.test(process.env.RUN), "Safe run id");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const rows: unknown[] = [], errors: string[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/navigation-fixture.html", route => route.fulfill({
      contentType: "text/html", body: "<body></body>"
    }));
    await page.goto(`${url}navigation-fixture.html`);
    await page.evaluate(async () => {
      const helper = await import(/* @vite-ignore */ String("/tools/bench/public-building-navigation-frame.ts"));
      await helper.preparePublicBuildingFixture(null);
    });
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "(window.__yardReview = { camera, settlement, simulation: settlement?.simulation, world }, window.__islandReady = true)") });
    });
    await page.goto(`${url}?quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__yardReview), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.evaluate(() => Object.assign((window as any).__yardReview.camera,
      { centerX: 48, centerZ: 48, tilt: 0, yaw: .5, zoom: 3.2 }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(output, `${quality}-before.png`) });
    const placed = await page.evaluate(async () => {
      const helper = await import(/* @vite-ignore */ String("/tools/bench/public-building-navigation-frame.ts"));
      const result = helper.placeYardBuilding(4);
      const yard = await import(/* @vite-ignore */ String("/src/app/settlement/island-building-clearance.ts"));
      const cover = await import(/* @vite-ignore */ String("/src/render-common/props/field-cover-exclusions.ts"));
      const world = (window as any).__yardReview.world;
      return { ...result, cells: yard.buildingGroundCoverCells(
        (window as any).__yardReview.simulation.buildings().find((b: any) => b.uid === result.uid),
        "roman", world).length, counts: Boolean(cover.getBuildingGroundCoverCounts(world)) };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(output, `${quality}-after.png`) });
    assert(placed.cells > 0 && placed.cells < 16, `${quality}: physical cells inside the full plot`);
    assert(placed.counts, `${quality}: live grass mask registered`);
    rows.push({ quality, placed });
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors,
    scope: "Empty saved yard, then a real watchtower placed live through the production simulation and grass hook; " +
      "fixed before/after camera in High/Minimal. Not an earned-progression or occupied-neighbour journey." }, null, 2));
  console.log(`Yard grass: ${rows.length} quality cases, ${output}`);
} finally {
  await browser.close();
  await server.close();
}
