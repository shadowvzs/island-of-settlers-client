import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  enterPossessed,
  openReviewPage,
  pinLight,
  prepareScene,
  readFrame,
  sailShip,
  setIsoView,
  setPossessedView,
  stageReviewSave
} from "./water-review-page";

/**
 * R18a water review: frozen owner-save frames (pinned light, clear weather, camera and clock) of
 * the coast and the harbour, High and Minimal. A render-only synthetic ship sails an arc over deep
 * water near the save's camera (no simulation change), so the wake has a real motion history.
 * Shots: day and dusk iso, a close coast, the harbour with the moving ship, and two possessed
 * views (coast, ship). The source save is only read. Browsers run through captures/browser-slot.sh.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1920x1080]
 *   [CLIP=1] (instead of stills: 3 s of the sailing ship at 30 fps, harbour iso and possessed, as PNG
 *   frames in OUTPUT_DIR/clip-<view>/ for an ffmpeg clip and a frame-to-frame shimmer review)
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const clipMode = process.env.CLIP === "1";
const CLIP_FRAMES = 90;
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageReviewSave(saveText);
mkdirSync(outputDir, { recursive: true });
const report: Record<string, any> = { pages: [], shots: [], sites: null };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

const capture = async (page: Page, name: string, sailSeconds: number) => {
  await sailShip(page, sailSeconds);
  const dataUrl = await readFrame(page);
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  report.shots.push(name);
  saveReport();
  console.log("shot", name);
};

/** Continues the voyage one 1/30 s step per frame and saves every frame. */
const captureClip = async (page: Page, name: string) => {
  const directory = resolve(outputDir, `clip-${name}`);
  mkdirSync(directory, { recursive: true });
  await sailShip(page, 8);
  for (let frame = 1; frame <= CLIP_FRAMES; frame++) {
    await sailShip(page, 0, 12 + frame / 30);
    const dataUrl = await readFrame(page);
    const file = `${String(frame).padStart(3, "0")}.png`;
    writeFileSync(resolve(directory, file), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  }
  console.log("clip", name);
};

const captureClips = async (page: Page, quality: string) => {
  report.sites = await prepareScene(page);
  const { deep } = report.sites.sites;
  await pinLight(page, "day");
  await setIsoView(page, { centerX: deep.x, centerZ: deep.z, zoom: 1.3 });
  await captureClip(page, `${quality}-iso`);
  await enterPossessed(page);
  await setPossessedView(page, "ship");
  await captureClip(page, `${quality}-possessed`);
};

const capturePage = async (page: Page, quality: string) => {
  report.sites = await prepareScene(page);
  const { coast, deep } = report.sites.sites;
  const saveCamera = report.sites.camera;
  for (const scene of ["day", "dusk"] as const) {
    await pinLight(page, scene);
    await setIsoView(page, { centerX: saveCamera.centerX, centerZ: saveCamera.centerZ, zoom: saveCamera.zoom });
    await capture(page, `${quality}-${scene}-iso`, 2);
  }
  await pinLight(page, "day");
  await setIsoView(page, { centerX: coast.x, centerZ: coast.z, zoom: 3.2 });
  await capture(page, `${quality}-day-coast-close`, 2);
  await setIsoView(page, { centerX: deep.x, centerZ: deep.z, zoom: 1.3 });
  await capture(page, `${quality}-day-harbour-wake`, 8);
  await enterPossessed(page);
  for (const target of ["coast", "ship"] as const) {
    await setPossessedView(page, target);
    await capture(page, `${quality}-day-possessed-${target}`, 8);
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { errors, page } = await openReviewPage(browser, url, quality, stagedSave,
      { height: height!, width: width! });
    report.pages.push({ errors, quality });
    await (clipMode ? captureClips : capturePage)(page, quality);
    await page.close();
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done", report.shots.length, "shots");
