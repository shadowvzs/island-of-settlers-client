import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "public-building-navigation-2026-11-03");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const rows: unknown[] = [], errors: string[] = [], missing: string[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() === 404) missing.push(response.url()); });
    page.on("console", message => { if (message.type() === "error" && /shader|WebGL|THREE.*Error/i.test(message.text()))
      errors.push(message.text()); });
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.route("**/navigation-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.goto(`${url}navigation-fixture.html`);
    await page.evaluate(async () => {
      const helper = await import(/* @vite-ignore */ String("/tools/bench/public-building-navigation-frame.ts"));
      await helper.preparePublicBuildingFixture();
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
    const initial = await page.evaluate(async () => (await import(/* @vite-ignore */
      String("/tools/bench/public-building-navigation-frame.ts"))).beginPublicBuildingJourney());
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(output, `${quality}-start.png`) });
    const middle = await page.evaluate(async () => (await import(/* @vite-ignore */
      String("/tools/bench/public-building-navigation-frame.ts"))).stepPublicBuildingJourney(50));
    assert(middle.actorFrame, `${quality}: actual soldier has a rendered worker frame`);
    assert(middle.actorFrame.visible !== false);
    assert(Math.hypot(middle.actorFrame.x - middle.position.x, middle.actorFrame.z - middle.position.z) < .15);
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(output, `${quality}-around-room.png`) });
    const end = await page.evaluate(async () => (await import(/* @vite-ignore */
      String("/tools/bench/public-building-navigation-frame.ts"))).stepPublicBuildingJourney(1200));
    assert(end.arrived, `${quality}: ordinary soldier arrives through actual public yard`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(output, `${quality}-arrived.png`) });
    const receipt = await page.evaluate(async () => (await import(/* @vite-ignore */
      String("/tools/bench/public-building-navigation-frame.ts"))).finishPublicBuildingJourney());
    // Record replay parity without hiding a fixture/replay failure; the native movement is asserted above.
    rows.push({ quality, replayOk: receipt.replay.ok, replay: receipt.replay, reservedAtArrival: receipt.reservedAtArrival });
    assert.equal(receipt.reservedAtArrival, true);
    assert.deepEqual(receipt.worldHashesAfter, receipt.worldHashesBefore);
    assert(receipt.travelled > receipt.directDistance);
    rows.push({ quality, initial, middle, end, receipt });
    await page.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, missing, rows }, null, 2));
  await browser.close(); await server.close();
}
