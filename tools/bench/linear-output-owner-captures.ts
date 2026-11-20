import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

/**
 * R11a pixel identity: frozen frames on the owner save, High and Minimal, iso and possessed, with
 * the simulation held right after the island is ready. Run it on the build before and after a
 * renderer change with the same arguments; `DIFF_DIR=<earlier run>` then compares the raw RGBA
 * dumps and writes an amplified difference image per pair. The save is only read.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWS=iso,possessed]
 *   [VIEWPORT=1600x900] [STRIP=1] [WARMUP=40] [DIFF_DIR=<earlier output dir>] [DIFF_ONLY=1]
 *   [ZOOMS=1.4,1.6] [RECROSS=6] [CLEAR_SKY=1]
 *   npx tsx tools/bench/linear-output-owner-captures.ts
 * DIFF_ONLY=1 skips the browser run and only compares an existing OUTPUT_DIR against DIFF_DIR.
 * ZOOMS adds an iso shot per camera zoom (`<quality>-iso-z<zoom>`). RECROSS=N then alternates those
 * zooms N times and shoots each again (`...-again`), compared in-run with the first shot (R16a).
 * CLEAR_SKY=1 pins rain and snow to 0: precipitation particles are random per page load.
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1600x900").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const views = (process.env.VIEWS ?? "iso,possessed").split(",");
assert(views.every(view => view === "iso" || view === "possessed"), "VIEWS: iso,possessed");
const diffDir = process.env.DIFF_DIR ? resolve(process.env.DIFF_DIR) : null;
const zooms = process.env.ZOOMS ? process.env.ZOOMS.split(",").map(Number) : [];
const recross = Number(process.env.RECROSS ?? 0);
const clearSky = process.env.CLEAR_SKY === "1";
/** STRIP=0 keeps the dynamic actors in the frame; the default removes them for a stable snapshot. */
const stripDynamic = process.env.STRIP !== "0";
/** Draws of the frozen frame before each shot, so deferred bakes settle before the read. */
const warmUpDraws = Number(process.env.WARMUP ?? 40);
mkdirSync(resolve(outputDir, "diff"), { recursive: true });
const saveText = readFileSync(sourcePath, "utf8");
const save = JSON.parse(saveText);
// Freeze the presentation clock of the save: every capture sees the same light and weather.
const environment = save.runtime.environment;
Object.assign(environment, { cycling: false, targetHour: environment.hour, weatherState: "clear" });
const stagedSave = JSON.stringify(save);
const report: Record<string, any> = { device: [], diff: [], frames: [], shots: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

const patchRoutes = async (page: Page) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    const body = patchAtmosphereLiveCost(await response.text())
      .replace("atmosphereDebug.api = result;", "atmosphereDebug.world = world; atmosphereDebug.api = result;");
    await route.fulfill({ body, response });
  });
  await page.route("**/exploration-weather-adapter.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({ body: patchAtmosphereWeatherClock(await response.text()), response });
  });
};

const openPage = async (browser: Browser, url: string, quality: string) => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: height!, width: width! } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 300));
  });
  await patchRoutes(page);
  // Full resolution everywhere: the adaptive controller would otherwise change the drawing buffer
  // between the iso and possessed views and between runs.
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY,
    value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await stageStartupSave(page, url, stagedSave, true);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  const device = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return { buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      renderer: gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
      scene: debug.api.getStats().details };
  });
  assert(/NVIDIA/.test(device.renderer) && !/swiftshader/i.test(device.renderer),
    `Not the hardware GPU: ${device.renderer}`);
  report.device.push({ errors, quality, ...device });
  if (errors.length) throw new Error(`${quality}: ${errors.join(" | ")}`);
  return page;
};

/**
 * Snapshots the iso frame right after the island is ready and pins the presentation clock, so the
 * frame depends on the save only, not on how long the load took. Dynamic actors (workers, wildlife,
 * ships, arrows) are removed from the snapshot (STRIP=0 keeps them): they are simulation state, not
 * renderer state, and would otherwise move between page loads.
 */
const prepareScene = (page: Page, strip: boolean) => page.evaluate(async ({ clear, stripDynamic }) => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { snapshotAtmosphereFrame } = await load("/tools/bench/atmosphere-frame-snapshot.ts");
  const pinned = structuredClone(debug.lastFrame.environment);
  if (clear) Object.assign(pinned, { rain: 0, snow: 0 });
  /** Snapshots start at time 0: one draw resets delta-driven clocks (wind phase), then time 12. */
  debug.snapshotFrame = (frame: any) => {
    const snapshot = snapshotAtmosphereFrame(frame);
    snapshot.environment = structuredClone(pinned);
    snapshot.time = 0;
    return snapshot;
  };
  debug.stripDynamic = (frame: any) => {
    if (!stripDynamic || !frame) return;
    for (const key of ["cavalryMounts", "handcarts", "militaryArrows", "militaryDeaths", "mounts",
      "shipPreviewWorkers", "ships", "shuttleBoats", "transportHorses", "workers"]) frame[key] = [];
    for (const key of ["animals", "birds", "butterflies", "critters"])
      if (frame[key]) frame[key].count = 0;
    if (frame.exploration) frame.exploration.smoke = null;
  };
  debug.isoFrame = debug.snapshotFrame(debug.lastFrame);
  debug.stripDynamic(debug.isoFrame);
  debug.frozenFrame = debug.isoFrame;
  debug.draw();
  debug.isoFrame.time = 12;
  debug.renderer.info.autoReset = false;
  return { camera: debug.isoFrame.camera };
}, { clear: clearSky, stripDynamic: strip });

const enterPossessed = async (page: Page) => {
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed",
    null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
};

/**
 * Holds the settlement and freezes the possessed eye view at a fixed look (yaw 290 degrees, level),
 * so only the saved eye position remains. The hold comes after possession: the entry needs the
 * live simulation to move the player and settle the camera.
 */
const freezePossessed = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  const live = (window as any).__settlement;
  const held = live.update(0);
  live.update = () => held;
  debug.possessedFrame = debug.snapshotFrame(debug.lastFrame);
  if (!debug.possessedFrame.exploration?.camera?.pose) throw new Error("No possessed eye frame");
  debug.possessedFrame.exploration.camera.pose.yaw = 290 * Math.PI / 180;
  debug.possessedFrame.exploration.camera.pose.pitch = 0;
  debug.stripDynamic(debug.possessedFrame);
  debug.frozenFrame = debug.possessedFrame;
  debug.frozen = true;
  debug.draw();
  debug.possessedFrame.time = 12;
  return { pose: debug.possessedFrame.exploration.camera.pose };
});

const setIsoZoom = (page: Page, zoom: number) => page.evaluate(value => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.isoFrame.camera.zoom = value;
  debug.frozenFrame = debug.isoFrame;
}, zoom);

/** R16a: one iso shot per zoom; with RECROSS, the zooms alternate and every shot is repeated. */
const captureZooms = async (page: Page, quality: string) => {
  const name = (zoom: number) => `${quality}-iso-z${zoom}`;
  for (const zoom of zooms) { await setIsoZoom(page, zoom); await capture(page, name(zoom)); }
  if (!recross) return;
  for (let cycle = 0; cycle < recross; cycle++)
    for (const zoom of zooms) { await setIsoZoom(page, zoom); await warmUp(page); }
  for (const zoom of zooms) {
    await setIsoZoom(page, zoom);
    await capture(page, `${name(zoom)}-again`);
    const shot = report.shots.at(-1) as Shot;
    report.recross ??= [];
    report.recross.push(diffPair({ ...shot, name: `${name(zoom)}-again` }, resolve(outputDir, `${name(zoom)}.rgba`)));
  }
};

const setFrame = (page: Page, name: "isoFrame" | "possessedFrame") => page.evaluate(frame => {
  (window as any).__atmosphereLiveDebug.frozenFrame = (window as any).__atmosphereLiveDebug[frame];
}, name);

/** Draws the frozen frame until deferred bakes (impostors, sky environment, shadows) settle. */
const warmUp = (page: Page) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug;
  for (let index = 0; index < count; index++) {
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, warmUpDraws);

const capture = async (page: Page, name: string) => {
  await warmUp(page);
  const shot = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
    debug.draw();
    const shotWidth = gl.drawingBufferWidth, shotHeight = gl.drawingBufferHeight;
    const pixels = new Uint8Array(shotWidth * shotHeight * 4);
    gl.readPixels(0, 0, shotWidth, shotHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { dataUrl: debug.renderer.domElement.toDataURL("image/png"), height: shotHeight,
      pixels, width: shotWidth };
  });
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(shot.dataUrl.split(",")[1]!, "base64"));
  writeFileSync(resolve(outputDir, `${name}.rgba`), Buffer.from(shot.pixels));
  report.shots.push({ height: shot.height, name, width: shot.width });
  saveReport();
};

type Shot = { height: number; name: string; width: number };
const diffPair = (shot: Shot, beforePath = resolve(diffDir!, `${shot.name}.rgba`),
  afterPath = resolve(outputDir, `${shot.name}.rgba`)) => {
  const { height: shotHeight, name, width: shotWidth } = shot;
  const before = readFileSync(beforePath);
  const after = readFileSync(afterPath);
  assert.equal(before.length, after.length, `${name}: raw size differs`);
  const pixels = before.length / 4;
  let changed = 0, maximum = 0, over1 = 0, over8 = 0, total = 0;
  const image = Buffer.alloc(before.length);
  for (let index = 0; index < before.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++)
      delta = Math.max(delta, Math.abs(before[index + channel]! - after[index + channel]!));
    changed += delta > 0 ? 1 : 0;
    over1 += delta > 1 ? 1 : 0;
    over8 += delta > 8 ? 1 : 0;
    maximum = Math.max(maximum, delta);
    total += delta;
    image[index] = Math.min(255, delta * 16);
    image[index + 1] = 0;
    image[index + 2] = 0;
    image[index + 3] = 255;
  }
  const rawPath = resolve(outputDir, "diff", `${name}-diff.rgba`);
  writeFileSync(rawPath, image);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${shotWidth}x${shotHeight}`, "-i", rawPath, "-vf", "vflip", "-frames:v", "1",
    resolve(outputDir, "diff", `${name}-diff.png`)]);
  return { changed, maximum, mean: total / pixels, name, over1, over8, pixels };
};

/** DIFF_ONLY=1 skips the browser run and only compares the shot list of OUTPUT_DIR with DIFF_DIR. */
const diffOnly = process.env.DIFF_ONLY === "1";
if (!diffOnly) {
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    for (const quality of qualities) {
      const page = await openPage(browser, url, quality);
      const { camera } = await prepareScene(page, stripDynamic);
      report.frames.push({ camera, quality, stripDynamic });
      if (views.includes("possessed")) {
        await enterPossessed(page);
        report.frames.push({ pose: (await freezePossessed(page)).pose, quality });
      }
      for (const view of views) {
        await setFrame(page, view === "iso" ? "isoFrame" : "possessedFrame");
        await capture(page, `${quality}-${view}`);
      }
      await captureZooms(page, quality);
      await page.close();
    }
  } finally {
    saveReport();
    await browser.close();
    await server.close();
  }
}
if (diffDir) {
  const shots = diffOnly
    ? JSON.parse(readFileSync(resolve(outputDir, "report.json"), "utf8")).shots
    : report.shots;
  for (const shot of shots) report.diff.push(diffPair(shot));
  writeFileSync(resolve(outputDir, diffOnly ? "diff-report.json" : "report.json"),
    JSON.stringify(report, null, 2));
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots");
