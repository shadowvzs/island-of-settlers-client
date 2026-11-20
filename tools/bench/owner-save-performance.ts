import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  enterPossessedView, installFrameProfiler, readFrameProfile, resetFrameProfile, sampleHotFunctions,
  stageStartupSave
} from "./frame-profile";
import { resourcesPath } from "./resources-path";

const sourcePath = process.env.OWNER_SAVE;
assert(sourcePath, "Set OWNER_SAVE to the read-only save to profile");
const bytes = readFileSync(sourcePath);
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const save = JSON.parse(bytes.toString("utf8"));
/** OUTPUT_DIR: a worktree without resources/ (and lane receipts) writes outside the workspace. */
const output = process.env.OUTPUT_DIR
  ? resolve(process.env.OUTPUT_DIR)
  : resourcesPath("project-reviews", "2026-10-13", "owner-save-performance");
/** VIEWPORT=1920x1080 matches an owner's full-HD report; the historical default is 1400x900. */
const [width, height] = (process.env.VIEWPORT ?? "1400x900").split("x").map(Number);
/** VIEWS=iso,possessed also measures the possessed eye view entered from the iso camera. */
const views = (process.env.VIEWS ?? "iso").split(",");
mkdirSync(output, { recursive: true });

const measureView = async (page: Page, quality: string, view: string, errors: string[]) => {
  await resetFrameProfile(page);
  // Measure normal play separately: CPU sampling itself adds frame overhead.
  await page.waitForTimeout(7000);
  const unprofiled = await page.evaluate(() => (window as any).__ownerStats);
  await resetFrameProfile(page);
  const { hot, profile } = await sampleHotFunctions(page, 7000);
  const measured = await readFrameProfile(page);
  const report = await page.evaluate(() => {
    const root = window as any;
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const gpu = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      stats: root.__ownerStats,
      gpu: gpu && gl?.getParameter(gpu.UNMASKED_RENDERER_WEBGL),
      scene: {
        buildings: root.__settlement.simulation.buildings().length,
        actors: root.__settlement.simulation.frames().length
      }
    };
  });
  Object.assign(report, { stages: measured.stages, passes: measured.passes, frameCount: measured.frameCount });
  const viewTag = view === "iso" ? "" : `-${view}`;
  const label = `${quality}${viewTag}${process.env.REPORT_TAG ? `-${process.env.REPORT_TAG}` : ""}`;
  await page.screenshot({ path: resolve(output, `${label}.png`) });
  writeFileSync(
    resolve(output, `${label}.json`),
    JSON.stringify(
      { quality, view, sha256: hash(bytes), savedWorld: save.settlement.world, unprofiled, ...report, hot, errors },
      null,
      2
    )
  );
  writeFileSync(resolve(output, `${label}.cpuprofile`), JSON.stringify(profile));
  console.log(JSON.stringify({ quality, view, unprofiled, ...report, hot: hot.slice(0, 15), errors }));
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { height: height!, width: width! } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.log(error.message);
    });
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
    await stageStartupSave(page, url, bytes.toString("utf8"));
    await installFrameProfiler(page);
    await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&profile=1`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.waitForTimeout(6000);
    for (const view of views) {
      if (view === "possessed") await enterPossessedView(page);
      await measureView(page, quality, view, errors);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.equal(hash(readFileSync(sourcePath)), hash(bytes), "Source save stays unchanged");
} finally {
  await browser.close();
  await server.close();
}
