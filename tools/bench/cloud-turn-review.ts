/**
 * Possessed-sky cloud motion review (cloud-redo, owner captures/12.png and 17.png): radial streaks
 * when the history is kept through camera turns and wind drift, and the dusk rim halo with the sun
 * behind clouds. Real home island, possessed body, pinned cover; the eye pose is driven directly so
 * every run turns the same way. Per preset and row it saves a strip of consecutive crops, a 3x zoom
 * of the crop centre (four frames, then their |difference| x16) and full-frame shots.
 *
 * Rows: noon look-up steady, look-up continuous yaw + pitch turn, fast turn, the frames right after
 * the turn stops, possessed walk, after a tab switch (hidden HIDDEN_MS), dusk aimed at the sun
 * (steady and turning) and the sea under it (still, and right after a turn). TIMING=1 instead
 * measures the `sky` pass (cloud march + resolve + sky) with the dev profiler for SECONDS and
 * prints BENCH_JSON for tools/bench/ab-runner.ts.
 *
 * Env: OUTPUT (folder), QUALITIES (default high,minimal), FRAMES (14), STRIP (12), COVER (0.6),
 * DUSK_HOUR (17.7), DUSK_WATER_YAW (3.14), HIDDEN_MS (5000), ROWS (comma list to limit rows),
 * QUERY (extra dev switches, e.g. ao=off), TIMING=1, SECONDS (8).
 * Run from island-of-settlers-client of the checkout to review (the dev server serves the cwd).
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { emitBenchJson } from "./bench-json";
import { launchBrowser, startDevServer } from "./browser";
import {
  driveEye,
  enterPossession,
  type EyeMotion,
  exposeWeather,
  type HookWindow,
  pauseFrames,
  pinCloudCover,
  recordFrames,
  savePng,
  setHour,
  waitForIslandPage
} from "./cloud-review-page";

const output = resolve(process.env.OUTPUT ?? "cloud-turn-review");
const frameCount = Number(process.env.FRAMES ?? 14);
const stripFrames = Number(process.env.STRIP ?? 12);
const cover = Number(process.env.COVER ?? 0.6);
const duskHour = Number(process.env.DUSK_HOUR ?? 17.7);
const hiddenMs = Number(process.env.HIDDEN_MS ?? 5000);
/** Yaw of the dusk-water row from the sun (rad): where the island's sea lies on the review map. */
const duskWaterYaw = Number(process.env.DUSK_WATER_YAW ?? 3.14);
const rowFilter = process.env.ROWS?.split(",");
const timing = process.env.TIMING === "1";
const measureMs = Number(process.env.SECONDS ?? 8) * 1000;
mkdirSync(output, { recursive: true });

/** The middle of the view: the turn strips judge the whole sky band, not one corner. */
const TURN_CROP = { height: 0.5, left: 0.25, top: 0.05, width: 0.5 };
const NOON_PITCH = 0.85;
/** Dusk views: the sun centred and the cloud rims 20 degrees to either side of it. */
const DUSK_YAW_OFFSETS: [string, number][] = [["-left", -0.35], ["", 0], ["-right", 0.35]];

interface Row {
  /** Sets the scene up; the row then records right away. */
  arrange: (page: Page, context: RowContext) => Promise<void>;
  name: string;
}
interface RowContext { duskSun: { elevation: number; yaw: number }; noonYaw: number }

const settle = (page: Page, ms: number) => page.waitForTimeout(ms);
const eye = async (page: Page, motion: EyeMotion | null, settleMs = 1500) => {
  await driveEye(page, motion);
  await settle(page, settleMs);
};

const ROWS: Row[] = [
  { arrange: (page, { noonYaw }) => eye(page, { pitch: NOON_PITCH, yaw: noonYaw }), name: "noon-steady" },
  {
    arrange: (page, { noonYaw }) => eye(page, { pitch: NOON_PITCH, pitchSwing: 0.25, pitchSwingHz: 0.2,
      yaw: noonYaw, yawRate: 0.4 }, 1200),
    name: "look-up-turn"
  },
  {
    arrange: (page, { noonYaw }) => eye(page, { pitch: NOON_PITCH, yaw: noonYaw, yawRate: 1.6 }, 800),
    name: "fast-turn"
  },
  {
    arrange: async (page, { noonYaw }) => {
      await eye(page, { pitch: NOON_PITCH, pitchSwing: 0.3, pitchSwingHz: 0.25, yaw: noonYaw, yawRate: 0.8 }, 2000);
      await driveEye(page, { pitch: NOON_PITCH, yaw: noonYaw });
    },
    name: "after-turn"
  },
  {
    arrange: async (page, { noonYaw }) => {
      await page.evaluate(() => (window as unknown as HookWindow).__exploration.controller.setMovement(1, 0));
      await eye(page, { pitch: 0.45, yaw: noonYaw }, 1500);
    },
    name: "walk"
  },
  {
    arrange: async (page, { noonYaw }) => {
      await page.evaluate(() => (window as unknown as HookWindow).__exploration.controller.setMovement(0, 0));
      await eye(page, { pitch: NOON_PITCH, yaw: noonYaw }, 1000);
      await pauseFrames(page, hiddenMs, true);
      await settle(page, 300);
      await reenterIfSuspended(page);
      await driveEye(page, { pitch: NOON_PITCH, yaw: noonYaw });
    },
    name: "after-tab"
  },
  ...DUSK_YAW_OFFSETS.map(([suffix, offset]) => ({
    arrange: async (page: Page, { duskSun }: RowContext) => {
      await setHour(page, duskHour);
      await eye(page, { pitch: duskSun.elevation + 0.12, yaw: duskSun.yaw + offset }, 2500);
    },
    name: `dusk-sun${suffix}`
  })),
  {
    // Water refraction/reflection of the dusk sky: the linear capture must keep the uncapped sun and glow.
    arrange: async (page, { duskSun }) => {
      await setHour(page, duskHour);
      await eye(page, { pitch: -0.05, yaw: duskSun.yaw + duskWaterYaw }, 2500);
    },
    name: "dusk-water"
  },
  {
    // The same view right after a turn stops (history and capture edges under motion).
    arrange: async (page, { duskSun }) => {
      await eye(page, { pitch: -0.05, yaw: duskSun.yaw + duskWaterYaw - 0.8, yawRate: 0.8 }, 1000);
      await driveEye(page, { pitch: -0.05, yaw: duskSun.yaw + duskWaterYaw });
    },
    name: "dusk-water-after-turn"
  },
  {
    arrange: (page, { duskSun }) => eye(page, { pitch: duskSun.elevation + 0.15, pitchSwing: 0.1,
      pitchSwingHz: 0.3, yaw: duskSun.yaw - 0.3, yawRate: 0.3 }, 1200),
    name: "dusk-turn"
  }
];

/** A hidden tab force-exits possession: wait for idle and possess again. */
const reenterIfSuspended = async (page: Page) => {
  const phase = await page.evaluate(() => (window as unknown as HookWindow).__exploration.controller.snapshot().phase);
  if (phase === "possessed") return;
  await page.waitForFunction(() =>
    (window as unknown as HookWindow).__exploration.controller.snapshot().phase === "idle",
  null, { timeout: 30_000 });
  await enterPossession(page);
  await settle(page, 1500);
};

const openIsland = async (page: Page, url: string, quality: string) => {
  const profile = timing ? "&passes=1" : "";
  const extra = process.env.QUERY ? `&${process.env.QUERY}` : "";
  await page.goto(`${url}?quality=${quality}&size=64&seed=123&cache=0&skipLogin=1&time=day${profile}${extra}`);
  await waitForIslandPage(page);
  const noon = await setHour(page, 12);
  const duskSun = await setHour(page, duskHour);
  await setHour(page, 12);
  await enterPossession(page);
  // Look away from the noon sun so the strips show the cloud field, not the glare.
  return { duskSun, noonYaw: noon.yaw + Math.PI } satisfies RowContext;
};

const measureSkyPass = async (page: Page, context: RowContext) => {
  await eye(page, { pitch: NOON_PITCH, yaw: context.noonYaw }, 3000);
  await page.evaluate(() => (globalThis as any).__frameProfiler.resetSession());
  await settle(page, measureMs);
  return page.evaluate(() => {
    const report = (globalThis as any).__frameProfiler.sessionReport();
    const sky = report.passes.find((pass: { name: string }) => pass.name === "sky");
    return { frameGpuMs: report.frameGpuMs as number | null, frames: report.frames as number,
      skyCpuMs: sky?.cpuMs as number | undefined, skyGpuMs: sky?.gpuMs as number | null | undefined };
  });
};

const reviewQuality = async (page: Page, url: string, quality: string) => {
  const context = await openIsland(page, url, quality);
  if (timing) return { quality, timing: await measureSkyPass(page, context) };
  const rows: Record<string, unknown> = {};
  for (const row of ROWS) {
    if (rowFilter && !rowFilter.includes(row.name)) continue;
    await row.arrange(page, context);
    const { strip, zoom, ...metric } = await recordFrames(page,
      { count: frameCount, crop: TURN_CROP, stripFrames, zoomFrames: 4 });
    savePng(output, `${quality}-${row.name}-strip`, strip);
    if (zoom) savePng(output, `${quality}-${row.name}-zoom`, zoom);
    await page.screenshot({ path: resolve(output, `${quality}-${row.name}-full.png`) });
    rows[row.name] = metric;
  }
  return { quality, rows };
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const results = [];
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
    await page.addInitScript("window.__name = value => value;");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await pinCloudCover(page, cover);
    await exposeWeather(page);
    results.push({ ...(await reviewQuality(page, url, quality)), errors });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  for (const result of results)
    if ("timing" in result) emitBenchJson({ [result.quality]: result.timing });
  assert(results.every(result => result.errors.length === 0), "page errors");
} finally {
  await browser.close();
  await server.close();
}
