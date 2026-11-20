import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { enterPossessed, openReviewPage, pinLight, prepareScene, setIsoView, stageReviewSave } from "./water-review-page";

/**
 * FISH-SCHOOLS review: frozen owner-save frames (pinned day light, clear weather) around the fish
 * home nearest the save camera. Shots with the fish layer off ("before") and on ("after"): iso
 * close, iso normal, a render-only ship passing beside the school (3.5 units off its home), and the possessed view from the
 * nearest shore. CLIP=1 also saves 3 s of the ship pass at 30 fps. The source save is only read.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080] [CLIP=1]
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const clipMode = process.env.CLIP === "1";
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(outputDir, { recursive: true });
const report: Record<string, unknown> = { pages: [], shots: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

const readFrame = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  debug.draw();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const image = new Uint8ClampedArray(pixels.length), row = w * 4;
  for (let y = 0; y < h; y++) image.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  for (let index = 3; index < image.length; index += 4) image[index] = 255;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.putImageData(new ImageData(image, w, h), 0, 0);
  return canvas.toDataURL("image/png") as string;
});

const save = async (page: Page, name: string) => {
  const dataUrl = await readFrame(page);
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  (report.shots as string[]).push(name);
  saveReport();
  console.log("shot", name);
};

/** The home nearest the camera with a school species and the nearest dry shore point to it. */
const findSite = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  // Minimal builds no fish layer: the same homes from the shared code, for the same framing.
  const { createFishHomes } = await import(
    /* @vite-ignore */ String("/src/render-common/fish-schools/fish-school-homes.ts"));
  const { createFishWater } = await import(/* @vite-ignore */ String("/src/render-common/fish-schools/fish-water.ts"));
  const water = createFishWater(debug.world);
  const schools = (window as any).__fishSchools ?? { homes: createFishHomes(water, false), water };
  const { centerX, centerZ } = debug.isoFrame.camera;
  const homes = [...schools.homes].sort((a: any, b: any) =>
    Math.hypot(a.x - centerX, a.z - centerZ) - Math.hypot(b.x - centerX, b.z - centerZ));
  const home = homes.find((item: any) => item.count >= 4) ?? homes[0];
  let shore = null as null | { x: number; z: number; d: number };
  for (let z = home.z - 14; z <= home.z + 14; z += 0.5) for (let x = home.x - 14; x <= home.x + 14; x += 0.5) {
    const depth = schools.water.depth(x, z);
    if (depth > -0.15 || depth < -0.6) continue;
    const d = Math.hypot(x - home.x, z - home.z);
    if (!shore || d < shore.d) shore = { d, x, z };
  }
  const reef = homes.find((item: any) => item.species >= 3) ?? home;
  debug.fishSite = { home, reef, shore, water: schools.water };
  return { home, homes: schools.homes.length, reef, shore };
});

/** Presentation time runs on: fish swim, an optional ship crosses the home along +x. */
const run = (page: Page, seconds: number, ship: boolean, startTime: number) => page.evaluate(async args => {
  const debug = (window as any).__atmosphereLiveDebug, frame = debug.frozenFrame;
  const { home } = debug.fishSite, template = debug.shipTemplate;
  for (let step = 0; step <= Math.round(args.seconds * 30); step++) {
    frame.time = args.startTime + step / 30;
    const x = home.x - 12 + (step / 30) * 2.4;
    frame.ships = args.ship && template ? [{ ...template, phase: "sailing", x, y: debug.sites.seaLevel, yaw: Math.PI / 2,
      z: home.z + 3.5 }] : [];
    debug.draw();
    if (step % 15 === 0) await new Promise(done => requestAnimationFrame(done));
  }
}, { seconds, ship, startTime });

const setFish = (page: Page, enabled: boolean) => page.evaluate(value =>
  (window as any).__atmosphereLiveDebug.api.setFishSchoolsEnabled?.(value), enabled);

const shotPair = async (page: Page, name: string, seconds: number, ship = false) => {
  for (const enabled of [false, true]) {
    await setFish(page, enabled);
    await run(page, seconds, ship, 20);
    await save(page, `${name}-${enabled ? "after" : "before"}`);
  }
};

const possess = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  const { home, shore, water } = debug.fishSite;
  const frame = debug.possessedFrame, pose = frame.exploration.camera.pose;
  pose.x = shore.x;
  pose.z = shore.z;
  pose.y = Math.max(water.ground(shore.x, shore.z), debug.sites.seaLevel) + 1.7;
  // Look at where the school swims now (it wanders within its home), else at the home.
  const schools = (window as any).__fishSchools?.schools;
  const homeIndex = (window as any).__fishSchools?.homes.indexOf(home) ?? -1;
  const school = schools ? Array.from(schools.home as Int32Array).indexOf(homeIndex) : -1;
  const target = school >= 0 && schools.active[school]
    ? { x: schools.centerX[school], z: schools.centerZ[school] } : home;
  pose.yaw = Math.atan2(target.x - pose.x, target.z - pose.z);
  pose.pitch = -0.42;
  debug.frozenFrame = frame;
});

const capturePage = async (page: Page, quality: string) => {
  await prepareScene(page);
  await pinLight(page, "day");
  const site = await findSite(page);
  report[`${quality}-site`] = site;
  saveReport();
  const home = site?.home ?? (await page.evaluate(() => (window as any).__atmosphereLiveDebug.isoFrame.camera));
  const centerX = home.x ?? home.centerX, centerZ = home.z ?? home.centerZ;
  await setIsoView(page, { centerX, centerZ, zoom: 3.2 });
  await shotPair(page, `${quality}-iso-close`, 4);
  await setIsoView(page, { centerX, centerZ, zoom: 1.6 });
  await shotPair(page, `${quality}-iso-normal`, 4);
  await setIsoView(page, { centerX, centerZ, zoom: 2.6 });
  await shotPair(page, `${quality}-iso-ship-pass`, 4.2, true);
  if (clipMode && site) await captureClip(page, `${quality}-ship-pass`);
  if (site?.reef) {
    await setIsoView(page, { centerX: site.reef.x, centerZ: site.reef.z, zoom: 4.5 });
    await shotPair(page, `${quality}-iso-reef`, 4);
  }
  if (!site?.shore) return;
  await enterPossessed(page);
  await possess(page);
  await shotPair(page, `${quality}-possessed-shore`, 4);
};

const captureClip = async (page: Page, name: string) => {
  const directory = resolve(outputDir, `clip-${name}`);
  mkdirSync(directory, { recursive: true });
  await setFish(page, true);
  await run(page, 1, true, 40);
  for (let frame = 1; frame <= 150; frame++) {
    await run(page, 0, true, 41 + frame / 30);
    await page.evaluate(f => {
      const debug = (window as any).__atmosphereLiveDebug, { home } = debug.fishSite;
      debug.frozenFrame.ships = debug.shipTemplate ? [{ ...debug.shipTemplate, phase: "sailing",
        x: home.x - 12 + (1 + f / 30) * 2.4, y: debug.sites.seaLevel, yaw: Math.PI / 2, z: home.z + 3.5 }] : [];
    }, frame);
    const dataUrl = await readFrame(page);
    writeFileSync(resolve(directory, `${String(frame).padStart(3, "0")}.png`),
      Buffer.from(dataUrl.split(",")[1]!, "base64"));
  }
  console.log("clip", name);
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { errors, page } = await openReviewPage(browser, url, quality, stageReviewSave(saveText),
      { height: height!, width: width! });
    (report.pages as unknown[]).push({ errors, quality });
    await capturePage(page, quality);
    await page.close();
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done");
