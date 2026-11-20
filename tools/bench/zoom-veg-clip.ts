import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

/**
 * ZOOM-VEG clip: a screen recording (WebM) of a slow wheel-like zoom sweep on the owner save (read
 * only), to look for vegetation popping or missing chunks while the visible chunk set changes.
 *
 *   OWNER_SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITY=high] [SWEEP_MIN=0.6] [SWEEP_FACTOR=1.006]
 *   npx tsx tools/bench/zoom-veg-clip.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const quality = process.env.QUALITY ?? "high";
const sweep = { factor: Number(process.env.SWEEP_FACTOR ?? 1.006), min: Number(process.env.SWEEP_MIN ?? 0.6) };
mkdirSync(outputDir, { recursive: true });

const { server, url } = await startDevServer();
try {
  const browser = await launchBrowser();
  const context = await browser.newContext({ deviceScaleFactor: 1,
    recordVideo: { dir: outputDir, size: { height: 720, width: 1280 } }, viewport: { height: 720, width: 1280 } });
  const page = await context.newPage();
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value");
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY, value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, saveText);
  await page.route("**/src/app/render-loop.ts", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("const controller = createCameraController",
      "window.__clipCamera = options.camera; const controller = createCameraController");
    await route.fulfill({ body, response });
  });
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  await page.waitForTimeout(6000);
  await page.evaluate(({ factor, min }) => new Promise<void>(done => {
    const camera = (window as any).__clipCamera;
    let direction = -1, turns = 0;
    const tick = () => {
      camera.zoom = direction > 0 ? Math.min(3, camera.zoom * factor) : Math.max(min, camera.zoom / factor);
      if (camera.zoom >= 3 || camera.zoom <= min) { direction = -direction; turns += 1; }
      if (turns >= 2) { done(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), sweep);
  await page.waitForTimeout(1000);
  await context.close();
  console.log(await page.video()?.path());
  await browser.close();
} finally {
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
