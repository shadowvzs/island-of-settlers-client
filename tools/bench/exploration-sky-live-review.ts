import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import type { ExplorationCameraBoundary, ExplorationController } from "../../src/app/exploration/contracts";

interface LiveHook {
  camera: ExplorationCameraBoundary;
  controller: ExplorationController;
}

/** Real home-island entry, upward look and return. Uses a small fixture to isolate this visual change. */
export const reviewLiveSky = async (browser: Browser, url: string, output: string) => {
  const results = [];
  for (const quality of (process.env.LIVE_QUALITIES ?? "high,minimal").split(",")) {
    assert(["high", "minimal"].includes(quality), "LIVE_QUALITIES must name high and/or minimal");
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    await page.addInitScript("window.__name = value => value;");
    const errors: string[] = [];
    let moonRequests = 0;
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`);
    });
    page.on("response", response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    page.on("request", request => { if (request.url().includes("moon-lroc")) moonRequests++; });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__weather = weather; window.__islandReady = true") });
    });
    const size = Number(process.env.LIVE_SIZE ?? 64);
    assert([64, 128, 256].includes(size), "LIVE_SIZE must be 64, 128 or 256");
    await page.goto(`${url}?quality=${quality}&size=${size}&seed=123&cache=0`);
    await page.waitForFunction(() => Boolean((window as unknown as { __islandReady: boolean }).__islandReady),
      null, { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
    assert.equal(moonRequests, 0, "isometric startup must not request the moon texture");
    if (process.env.LIVE_RAIN === "1") {
      await page.evaluate(() => (window as unknown as { __weather: { controller: { toggleRain: () => void } } })
        .__weather.controller.toggleRain());
      await page.waitForFunction(() => {
        const weather = (window as unknown as { __weather: { controller: { saveState: () => { rain?: number } } } }).__weather;
        return (weather.controller.saveState().rain ?? 0) > .9;
      }, null, { timeout: 45_000 });
      await page.waitForTimeout(1000);
    }
    const saved = await page.evaluate(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.camera.savedRts());
    await page.locator("[data-exploration-entry]").click();
    await page.waitForFunction(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.controller.snapshot().phase === "possessed",
    null, { timeout: 60_000 });
    await page.screenshot({ path: resolve(output, `live-${quality}-walking.png`) });
    if (process.env.LIVE_OPPOSITE === "1") {
      // Rotate presentation only: the saved RTS camera and the body stay unchanged.
      const original = await page.evaluateHandle(() => {
        const { camera } = (window as unknown as { __exploration: LiveHook }).__exploration;
        const setPose = camera.setPose;
        camera.setPose = (pose, blend) => setPose(pose ? { ...pose, yaw: pose.yaw + Math.PI } : null, blend);
        return setPose;
      });
      await page.waitForTimeout(100);
      await page.screenshot({ path: resolve(output, `live-${quality}-opposite.png`) });
      await page.evaluate(setPose => {
        (window as unknown as { __exploration: LiveHook }).__exploration.camera.setPose = setPose;
      }, original);
      await original.dispose();
    }
    await page.evaluate(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.controller.setLook(0, 4));
    await page.waitForFunction(() =>
      ((window as unknown as { __exploration: LiveHook }).__exploration.camera.frame().camera?.pose.pitch ?? 0) > 1.3);
    await page.evaluate(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.controller.setLook(0, 0));
    await page.screenshot({ path: resolve(output, `live-${quality}-upward.png`) });
    const intervals = await page.evaluate(async () => {
      const times: number[] = [];
      let last = performance.now();
      for (let index = 0; index < 90; index++) {
        const next = await new Promise<number>(done => requestAnimationFrame(done));
        if (index > 0) times.push(next - last);
        last = next;
      }
      times.sort((left, right) => left - right);
      return { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * 0.95)] };
    });
    await page.waitForFunction(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.controller.snapshot().leaveUnlockInMs === 0);
    await page.locator('[data-exploration-control="leave"]').click();
    await page.waitForFunction(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.controller.snapshot().phase === "idle",
    null, { timeout: 30_000 });
    const restored = await page.evaluate(() =>
      (window as unknown as { __exploration: LiveHook }).__exploration.camera.savedRts());
    assert.deepEqual(restored, saved, "FPS sky must preserve the saved RTS camera");
    await page.screenshot({ path: resolve(output, `live-${quality}-returned.png`) });
    assert.equal(moonRequests, 0, "daytime exploration must not download the lunar texture");
    assert.equal(errors.length, 0, errors.join("\n"));
    results.push({ errors, intervals, moonRequests, quality, rain: process.env.LIVE_RAIN === "1", rtsCameraPreserved: true });
    await page.close();
  }
  return results;
};
