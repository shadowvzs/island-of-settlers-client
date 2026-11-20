import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  captureFrame,
  differenceStats,
  enterPossessed,
  freezeIso,
  openFrozenPage,
  pinScene,
  setFrame,
  stackHorizontally,
  stageFrozenSave
} from "./frozen-frame-review";

/**
 * R11c possessed auto-exposure review: frozen owner-save frames (pinned light, weather, actors and
 * clock). Per page: the iso view with the exposure hook off and on (must be identical), then the
 * possessed eye in the open sun, in the shade of a building and through the raised spyglass. Each
 * possessed view is captured with the fixed exposure and fully adapted (fast tuning while warming),
 * with the measured mean log2 luminance and EV. A time series walks from the open view into the
 * shade with the real tuning and records the EV every 100 ms (smooth, monotonic, no pumping).
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [SCENES=12,day,night] [QUALITIES=high,medium,minimal]
 *   [VIEWPORT=1600x900] [WARMUP=40] [SETTLE_MS=3000] [SERIES=1] [OVERRIDES='{"autoExposure":50}']
 *
 * OVERRIDES stores Settings > Graphics overrides first (the Eye adaptation slider's real path;
 * at 0 % the level has no hook, so only the fixed frames are captured).
 *
 * The source save is only read. Browsers run through captures/browser-slot.sh.
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1600x900").split("x").map(Number);
const scenes = (process.env.SCENES ?? "12,night").split(",");
const qualities = (process.env.QUALITIES ?? "high,medium,minimal").split(",");
const warmUpDraws = Number(process.env.WARMUP ?? 40);
const settleMs = Number(process.env.SETTLE_MS ?? 3000);
const series = process.env.SERIES !== "0";
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageFrozenSave(saveText);
mkdirSync(outputDir, { recursive: true });
const report: Record<string, any> = { pages: [], series: [], views: [] };
const saveReport = () => writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));

/** Switches the exposure hook (false when the level has none) and returns whether it applies. */
const setAutoExposure = (page: Page, active: boolean) => page.evaluate(value => {
  const hook = (window as any).__autoExposure;
  return hook ? hook(value) as boolean : false;
}, active);

const probe = (page: Page) => page.evaluate(() => (window as any).__exposureProbe?.() ?? null);

/** Fast adaptation while warming a frozen frame (converged captures); `null` restores the preset. */
const setFastTuning = (page: Page, fast: boolean) => page.evaluate(value => {
  const hook = (window as any).__exposureTuning;
  if (!hook) return;
  const defaults = (window as any).__exposureTuningDefaults ??= { ...hook() };
  hook(value ? { brightenSeconds: 0.02, darkenSeconds: 0.02 } : defaults);
}, fast);

/** Freezes the eye at `pose` (mutating the frozen possessed frame) and stores it as `frameName`. */
const freezeEye = (page: Page, frameName: string, aim: "open" | "shade" | "spyglass") => page.evaluate(
  ({ aim, frameName }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.freeze();
    const frame = debug.snapshotFrame(debug.frozenFrame);
    debug.stripDynamic(frame);
    const pose = frame.exploration.camera.pose;
    const sun = debug.pinned.sun;
    const length = Math.hypot(sun.azimuthX, sun.azimuthZ) || 1;
    const towardSunX = sun.azimuthX / length, towardSunZ = sun.azimuthZ / length;
    if (aim === "shade") {
      // The darkest of the eight nearest buildings' shadow sides (sun behind it, eye 6 units out),
      // measured by the exposure probe itself; on levels without it the nearest one.
      const buildings = [...frame.buildings ?? []].sort((left: any, right: any) =>
        Math.hypot(left.x - pose.x, left.z - pose.z) - Math.hypot(right.x - pose.x, right.z - pose.z))
        .slice(0, 8);
      const groundY = pose.y - 1.6;
      const place = (building: any) => {
        pose.x = building.x - towardSunX * 6;
        pose.z = building.z - towardSunZ * 6;
        pose.y = (building.y ?? groundY) + 1.6;
      };
      pose.yaw = Math.atan2(towardSunX, towardSunZ);
      pose.pitch = -0.25;
      let darkest = { building: buildings[0], meanLog2: Infinity };
      debug.frozenFrame = frame;
      for (const building of buildings) {
        place(building);
        for (let draw = 0; draw < 3; draw++) debug.draw();
        const meanLog2 = (window as any).__exposureProbe?.()?.meanLog2 ?? 0;
        if (meanLog2 < darkest.meanLog2) darkest = { building, meanLog2 };
      }
      if (darkest.building) place(darkest.building);
    } else {
      pose.yaw = Math.atan2(-towardSunX, -towardSunZ);
      pose.pitch = aim === "spyglass" ? -0.02 : -0.08;
    }
    frame.time = 12;
    debug[frameName] = frame;
    debug.frozenFrame = frame;
    debug.draw();
    return { pitch: pose.pitch, x: pose.x, y: pose.y, yaw: pose.yaw, z: pose.z };
  }, { aim, frameName });

const raiseSpyglass = async (page: Page) => {
  await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozen = false; });
  await page.evaluate(() => {
    const controller = (window as any).__exploration.controller;
    controller.toggleSpyglass();
    for (let step = 0; step < 10; step++) controller.adjustSpyglassZoom(1);
  });
  await page.waitForTimeout(2500);
};

const capture = (page: Page, name: string) => captureFrame(page, outputDir, name, warmUpDraws);

/** The view with the fixed exposure, then fully adapted; returns both shots and the probe. */
const captureFixedAndAdapted = async (page: Page, prefix: string) => {
  await setAutoExposure(page, false);
  const fixed = await capture(page, `${prefix}-fixed`);
  const applies = await setAutoExposure(page, true);
  if (!applies) {
    report.views.push({ applies, name: prefix });
    return;
  }
  await setFastTuning(page, true);
  const adapted = await capture(page, `${prefix}-auto`);
  const reading = await probe(page);
  await setFastTuning(page, false);
  stackHorizontally(resolve(outputDir, `${prefix}-fixed-auto.png`),
    [resolve(outputDir, `${prefix}-fixed.png`), resolve(outputDir, `${prefix}-auto.png`)]);
  report.views.push({ applies, diff: differenceStats(fixed, adapted), name: prefix, probe: reading });
  saveReport();
};

/** Open eye converged, then the shade frame drawn every animation frame with the real tuning. */
const captureSeries = async (page: Page, prefix: string) => {
  if (!(await setAutoExposure(page, true))) return;
  await setFrame(page, "openFrame");
  await setFastTuning(page, true);
  await capture(page, `${prefix}-series-start`);
  await setFastTuning(page, false);
  const trace = await page.evaluate(async () => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.frozenFrame = debug.shadeFrame;
    const samples: { ev: number; meanLog2: number; seconds: number }[] = [];
    const started = performance.now();
    let nextSample = 0;
    while (performance.now() - started < 6000) {
      debug.draw();
      const seconds = (performance.now() - started) / 1000;
      if (seconds >= nextSample) {
        samples.push({ ...(window as any).__exposureProbe(), seconds });
        nextSample += 0.1;
      }
      await new Promise(done => requestAnimationFrame(done));
    }
    return samples;
  });
  const evs = trace.map(sample => sample.ev);
  const reversals = evs.slice(2).filter((ev, index) =>
    Math.sign(ev - evs[index + 1]!) * Math.sign(evs[index + 1]! - evs[index]!) < 0 &&
    Math.abs(ev - evs[index + 1]!) > 0.002).length;
  report.series.push({ name: prefix, reversals, trace });
  saveReport();
};

const capturePage = async (page: Page, quality: string, scene: string) => {
  const prefix = `${quality}-${scene}`;
  await freezeIso(page);
  await page.waitForTimeout(settleMs);
  await setFrame(page, "isoFrame");
  await setAutoExposure(page, false);
  const isoFixed = await capture(page, `${prefix}-iso-fixed`);
  await setAutoExposure(page, true);
  const isoAuto = await capture(page, `${prefix}-iso-auto`);
  report.views.push({ diff: differenceStats(isoFixed, isoAuto), name: `${prefix}-iso` });
  await enterPossessed(page);
  const poses = {
    open: await freezeEye(page, "openFrame", "open"),
    shade: await freezeEye(page, "shadeFrame", "shade")
  };
  await page.waitForTimeout(settleMs);
  for (const view of ["open", "shade"]) {
    await setFrame(page, `${view}Frame`);
    await captureFixedAndAdapted(page, `${prefix}-${view}`);
  }
  if (series) await captureSeries(page, prefix);
  await raiseSpyglass(page);
  const spyglass = await freezeEye(page, "spyglassFrame", "spyglass");
  await page.waitForTimeout(settleMs);
  await captureFixedAndAdapted(page, `${prefix}-spyglass`);
  report.pages.push({ name: prefix, poses: { ...poses, spyglass } });
  saveReport();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const scene of scenes) for (const quality of qualities) {
    const { errors, page, stats } = await openFrozenPage(browser, url, {
      qualityOverrides: process.env.OVERRIDES, query: "", quality, stagedSave, viewport: { height: height!, width: width! }
    });
    report.pages.push({ errors, quality, scene, stats });
    if (errors.length) throw new Error(`${quality}: ${errors.join(" | ")}`);
    await pinScene(page, scene, true);
    await capturePage(page, quality, scene);
    await page.close();
  }
} finally {
  saveReport();
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log(JSON.stringify(report.views.map((view: any) =>
  ({ diff: view.diff && { changed: view.diff.changed, mean: view.diff.mean }, name: view.name,
    probe: view.probe })), null, 1));
console.log(JSON.stringify(report.series.map((entry: any) => ({ name: entry.name, reversals: entry.reversals,
  trace: entry.trace.filter((_: unknown, index: number) => index % 5 === 0)
    .map((sample: any) => `${sample.seconds.toFixed(1)}:${sample.ev.toFixed(3)}`).join(" ") }))));
