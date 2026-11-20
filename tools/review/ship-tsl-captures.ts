import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { PARITY_VIEWPORT } from "../bench/parity-helpers";
import {
  openReviewPage, pinLight, prepareScene, sailShip, stageReviewSave
} from "../bench/water-review-page";

/**
 * TSL ship matrix on the real island renderer (frozen owner-save frame): every nation's hull,
 * both owner pirate models, a raider galley, a fishing skiff and a shipyard construction stage,
 * WebGL against `webgpu-gl` at iso close/normal, day and dusk, plus a sail-wind motion strip.
 * The nation style comes from the live player nation (`setWorkerAppearances`), the rest is staged
 * render-only frames; nothing touches the simulation.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> <captures>/browser-slot.sh npx tsx --env-file=<file> \
 *     tools/review/ship-tsl-captures.ts
 */

const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const NATIONS = (process.env.NATIONS ??
  "roman,viking,japanese,nubian,chinese,persian,maya,indigenous").split(",");
const RENDERERS = (process.env.SHIP_RENDERERS ?? "webgl,webgpu-gl").split(",");
const HOURS = (process.env.SHIP_HOURS ?? "day,dusk").split(",");
const VIEWS = (process.env.SHIP_VIEWS ?? "close,normal").split(",");
const shotsDir = resolve(outputDir, "shots");
mkdirSync(shotsDir, { recursive: true });

type Renderer = "webgl" | "webgpu-gl";
type ShipConfig = {
  fishing?: boolean;
  livery?: "enemy";
  nation?: string;
  phase: "idle" | "sailing";
  site?: boolean;
  siteKind?: "dock";
  time: number;
  x: number;
  z: number;
  yaw: number;
};

/** Places the staged render-only ships/fishing skiff/construction site and draws one frame. */
const stageShips = (page: Page, config: ShipConfig) => page.evaluate(async config => {
  const debug = (window as any).__atmosphereLiveDebug;
  if (config.nation && debug.captureNation !== config.nation) {
    const { randomWorkerAppearances } = await import(
      /* @vite-ignore */ String("/src/render-common/workers/worker-appearance.ts"));
    await debug.api.setWorkerAppearances(randomWorkerAppearances(1, config.nation));
    debug.captureNation = config.nation;
  }
  const { deep, water } = debug.sites;
  const frame = debug.frozenFrame;
  frame.time = config.time;
  let x = deep.x + config.x, z = deep.z + config.z;
  if (config.site && debug.realSite) {
    x = debug.realSite.x;
    z = debug.realSite.z;
  }
  const ids = config.livery ? [900, 901] : [901];
  frame.ships = config.fishing || config.site ? [] : ids.map((id, index) => ({
    cargoCount: 0, id, livery: config.livery, phase: config.phase,
    x: x + index * 7, y: water, yaw: config.yaw, z: z + index * 2
  }));
  if (config.site) {
    const site = debug.realSite ? structuredClone(debug.realSite) : {
      cloth: 0, id: 990, nation: config.nation, progress: 0.55, x, y: water, yaw: config.yaw, z
    };
    site.progress = config.siteKind === "dock" ? 1 : 0.55;
    if (config.siteKind === "dock") site.kind = "dock";
    frame.shipSites = [site];
  } else frame.shipSites = [];
  frame.fishingBoats = config.fishing ? [{
    crewed: true, id: 980, nation: config.nation, person: 900000, rowing: true,
    x: x + 2, y: water, yaw: config.yaw, z: z - 2
  }] : [];
  debug.draw();
  return { x, z };
}, config);

/** Iso framing at a staged point, aimed at sail height. */
const isoAt = (page: Page, point: { x: number; z: number }, zoom: number, lift = 4.6) => page.evaluate(
  ({ lift, point, zoom }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const frame = structuredClone({ ...debug.isoFrame, felling: undefined, growth: undefined });
    Object.assign(frame, { felling: debug.isoFrame.felling, growth: debug.isoFrame.growth });
    Object.assign(frame.camera, { centerX: point.x, centerZ: point.z, zoom });
    debug.frozenFrame = frame;
    debug.draw();
    const view = debug.camera.getWorldDirection(debug.camera.position.clone());
    const reach = lift / Math.max(.2, -view.y), flat = Math.hypot(view.x, view.z) || 1;
    debug.towardsCamera = { x: -view.x / flat, z: -view.z / flat };
    frame.camera.centerX += view.x * reach;
    frame.camera.centerZ += view.z * reach;
  }, { lift, point, zoom });

const saveShot = async (page: Page, name: string) => {
  await page.waitForTimeout(180);
  const file = resolve(shotsDir, `${name}.png`);
  await page.screenshot({ clip: { height: PARITY_VIEWPORT.height, width: PARITY_VIEWPORT.width, x: 0, y: 0 },
    path: file });
  console.log("shot", name);
};

const captureShip = async (page: Page, renderer: Renderer, hour: string, config: ShipConfig,
  label: string, zoom: number, lift = 4.6) => {
  await pinLight(page, hour as "day" | "dusk");
  const point = await stageShips(page, config);
  if (config.livery) for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(500);
    await stageShips(page, config);
  }
  await isoAt(page, point, zoom, lift);
  await stageShips(page, config);
  await saveShot(page, `${renderer}-${hour}-${label}`);
};

/** Sails a synthetic ship along the review course (wake history), then frames its stern. */
const captureWake = async (page: Page, renderer: Renderer) => {
  await pinLight(page, "day");
  await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.frozenFrame.environment = debug.isoFrame.environment;
    debug.shipTemplate = { cargoCount: 0, id: 905, phase: "idle", x: 0, y: 0, yaw: 0, z: 0 };
  });
  await sailShip(page, 2.5, 12);
  await page.evaluate(lift => {
    const debug = (window as any).__atmosphereLiveDebug;
    const frame = debug.frozenFrame;
    Object.assign(frame.camera, { centerX: debug.sites.deep.x, centerZ: debug.sites.deep.z, zoom: 1.8 });
    debug.draw();
    const view = debug.camera.getWorldDirection(debug.camera.position.clone());
    const reach = lift / Math.max(.2, -view.y);
    frame.camera.centerX += view.x * reach;
    frame.camera.centerZ += view.z * reach;
    debug.draw();
  }, 1.2);
  await saveShot(page, `${renderer}-day-wake`);
  if (process.env.SHIP_DEBUG === "1") console.log(await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    const spike = (window as any).__webgpuSpike;
    return { api: Object.keys(debug.api).filter(key => /wake|ship/i.test(key)), ships: debug.frozenFrame.ships,
      sites: debug.frozenFrame.shipSites?.slice(0, 2), substitutions: spike?.stats?.().substitutions };
  }));
};

const captureMotion = async (page: Page, renderer: Renderer, config: ShipConfig, label: string) => {
  await pinLight(page, "day");
  const point = await stageShips(page, config);
  await isoAt(page, point, 2.2);
  for (let step = 0; step < 3; step++) {
    await stageShips(page, { ...config, time: config.time + step * .45 });
    await saveShot(page, `${renderer}-motion-${label}-${step}`);
  }
};

const zoomForView = (view: string) => {
  if (view === "normal") return .75;
  if (view === "docked") return 1.6;
  return 2.2;
};

const capturePreset = async (page: Page, renderer: Renderer) => {
  await prepareScene(page);
  await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    const sites = debug.frozenFrame.shipSites ?? [];
    debug.realSite = structuredClone(sites.find((site: { workPier?: unknown }) => site.workPier) ?? null);
  });
  for (const hour of HOURS) {
    for (const nation of NATIONS) {
      for (const view of VIEWS) {
        const phase = view === "docked" ? "idle" : "sailing";
        await captureShip(page, renderer, hour,
          { phase, time: 12, x: 0, z: 0, yaw: 0.4, nation }, `${nation}-${view}`, zoomForView(view));
      }
    }
    await captureShip(page, renderer, hour,
      { livery: "enemy", phase: "sailing", time: 12, x: 0, z: 0, yaw: 0.4 }, "pirates", 1.4);
    await captureShip(page, renderer, hour,
      { fishing: true, phase: "idle", time: 12, x: 0, z: 0, yaw: 0.4, nation: "roman" }, "fishing", 2.4, 0.4);
    await captureShip(page, renderer, hour,
      { phase: "idle", site: true, time: 12, x: 0, z: 0, yaw: 0.4, nation: "roman" }, "shipyard", 2.2, 2);
    await captureShip(page, renderer, hour,
      { phase: "idle", site: true, siteKind: "dock", time: 12, x: 0, z: 0, yaw: 0.4, nation: "roman" },
      "gangway", 2.4, 1);
  }
  await captureMotion(page, renderer,
    { phase: "sailing", time: 12, x: 0, z: 0, yaw: 0.4, nation: "viking" }, "viking-sail");
  await captureWake(page, renderer);
};

const captureAll = async () => {
  const staged = stageReviewSave(readFileSync(sourcePath, "utf8"));
  const { server, url } = await startDevServer();
  const browser: Browser = await launchBrowser();
  const errors: string[] = [];
  try {
    for (const renderer of RENDERERS as Renderer[]) {
      const opened = await openReviewPage(browser, url, "high", staged, PARITY_VIEWPORT,
        `&renderer=${renderer}`);
      await pageHideUi(opened.page);
      await capturePreset(opened.page, renderer);
      errors.push(...opened.errors.map(error => `${renderer}: ${error}`));
      await opened.page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ errors, renderers: RENDERERS }, null, 2));
  assert.deepEqual(errors, []);
  console.log("Ship matrix:", outputDir);
};

const pageHideUi = (page: Page) => page.addStyleTag({ content:
  "#viewport > :not(#view, #webgpu-view, #loading-screen) { display: none !important; }" });

await captureAll();
