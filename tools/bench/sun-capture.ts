import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { Matrix4, Vector3 } from "three";

import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";

/**
 * Possessed-view sun and moon review: real home-island entry, then the eye is aimed at the light
 * (sun by day, moon by night). Default views: morning, noon, sunset, the lowest sun (18:00, about
 * 7 degrees), rain at noon and spyglass variants, plus an iso view for parity. `VIEWS=moon` (or
 * moon view names) captures the lunar phases at night and the low twilight moon; `VIEWS=stars`
 * the night stars (new and full moon, cloudy, zenith, spyglass, dusk) and the morning birds.
 * Writes PNGs and `report.json` (statistics overlay draw counters). Environment: OUTPUT (required), QUALITY and
 * VIEWS (comma lists).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITY ?? "high,minimal").split(",");
const SETTLE_MS = 2500;
interface CaptureView {
  hour: number;
  /** Fixed look instead of aiming at the light: pitch and yaw (rad; yaw as atan2(x, z)). */
  look?: { pitch: number; yaw: number };
  /** Aims along the Milky Way band (exploration-stars-glsl.ts) where it stands highest. */
  milkyWay?: boolean;
  /** Lunar phase (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter); sets the day. */
  moonPhase?: number;
  name: string;
  rain: number;
  spyglass?: boolean;
}
const SUN_VIEWS: CaptureView[] = [
  { hour: 7.2, name: "morning", rain: 0 },
  { hour: 12, name: "noon", rain: 0 },
  { hour: 17.6, name: "sunset", rain: 0 },
  { hour: 18, name: "lowest", rain: 0 },
  { hour: 12, name: "noon-rain", rain: 1 },
  { hour: 12, name: "noon-spyglass", rain: 0, spyglass: true },
  { hour: 17.6, name: "sunset-spyglass", rain: 0, spyglass: true },
  { hour: 18, name: "lowest-spyglass", rain: 0, spyglass: true }
];
const MOON_PHASES = [["new", 0.02], ["crescent", 0.12], ["first-quarter", 0.25],
  ["waxing-gibbous", 0.38], ["full", 0.5], ["waning-gibbous", 0.62], ["last-quarter", 0.75],
  ["waning-crescent", 0.88]] as const;
const MOON_VIEWS: CaptureView[] = [
  ...MOON_PHASES.map(([name, moonPhase]) =>
    ({ hour: 22.5, moonPhase, name: `moon-${name}`, rain: 0, spyglass: true })),
  { hour: 22.5, moonPhase: 0.25, name: "moon-night", rain: 0 },
  { hour: 18.3, moonPhase: 0.62, name: "moon-twilight", rain: 0 },
  { hour: 18.3, moonPhase: 0.62, name: "moon-twilight-spyglass", rain: 0, spyglass: true }
];
/** Over the open sea west of the home island (the sunset view), away from buildings. */
const SEA_YAW = -0.673;
const STAR_LOOK = { pitch: 0.3, yaw: SEA_YAW };
const STAR_VIEWS: CaptureView[] = [
  { hour: 23, look: STAR_LOOK, moonPhase: 0.02, name: "stars-new-moon", rain: 0 },
  { hour: 23, look: STAR_LOOK, moonPhase: 0.5, name: "stars-full-moon", rain: 0 },
  { hour: 23, look: STAR_LOOK, moonPhase: 0.02, name: "stars-cloudy", rain: 0.3 },
  { hour: 23, look: { pitch: 1.25, yaw: SEA_YAW }, moonPhase: 0.02, name: "stars-zenith", rain: 0 },
  { hour: 23, milkyWay: true, moonPhase: 0.02, name: "stars-milky-way", rain: 0 },
  { hour: 23, look: STAR_LOOK, moonPhase: 0.02, name: "stars-spyglass", rain: 0, spyglass: true },
  { hour: 18.75, look: STAR_LOOK, moonPhase: 0.02, name: "stars-dusk", rain: 0 },
  SUN_VIEWS[0]!
];
const viewFilter = process.env.VIEWS?.split(",");
const VIEW_SETS: Record<string, CaptureView[]> = { moon: MOON_VIEWS, stars: STAR_VIEWS };
const VIEWS = viewFilter
  ? [...new Set([...SUN_VIEWS, ...MOON_VIEWS, ...STAR_VIEWS])].filter(view =>
    viewFilter.includes(view.name) || viewFilter.some(set => VIEW_SETS[set]?.includes(view)))
  : SUN_VIEWS;
const LUNAR_CYCLE_DAYS = 29.530588;
/** The integer day whose phase at `hour` is closest to `phase` (environment.ts moonPhaseForDay). */
const dayForPhase = (phase: number, hour: number) => {
  const raw = phase * LUNAR_CYCLE_DAYS - LUNAR_CYCLE_DAYS / 2 - hour / 24;
  return Math.round(((raw % LUNAR_CYCLE_DAYS) + LUNAR_CYCLE_DAYS) % LUNAR_CYCLE_DAYS);
};

/** Sets the clock, day and rain at once (no glide, no fade) through the saved-state path. */
const setWeather = (page: Page, view: CaptureView) => page.evaluate(({ day, hour, rain }) => {
  const { controller } = (window as any).__weather;
  const saved = controller.saveState();
  controller.loadState({ ...saved, cycling: false, day: day ?? saved.day, hour, rain, snow: 0,
    targetHour: hour, targetRain: rain, targetSnow: 0 });
  const { moonPhase, starPole, starRotation, sun } = controller.update(0);
  return { elevation: sun.elevation, moonPhase, starPole, starRotation, x: sun.azimuthX, z: sun.azimuthZ };
}, { day: view.moonPhase === undefined ? undefined
  : dayForPhase(view.moonPhase, view.hour), hour: view.hour, rain: view.rain });

/** The galactic pole in star-sphere coordinates (exploration-stars-glsl.ts starMilkyWay). */
const GALACTIC_POLE = new Vector3(0.32, 0.55, 0.77).normalize();

/** Highest point of the Milky Way band in the world sky: perpendicular to the turned galactic pole. */
const milkyWayLook = (sun: Awaited<ReturnType<typeof setWeather>>) => {
  const pole = sun.starPole, cosine = Math.cos(pole.elevation);
  const axis = new Vector3(pole.azimuthX * cosine, Math.sin(pole.elevation), pole.azimuthZ * cosine);
  const galactic = GALACTIC_POLE.clone().applyMatrix4(new Matrix4().makeRotationAxis(axis, sun.starRotation));
  const up = new Vector3(0, 1, 0);
  const look = up.sub(galactic.clone().multiplyScalar(galactic.y)).normalize();
  return { pitch: Math.min(0.9, Math.asin(look.y)), yaw: Math.atan2(look.x, look.z) };
};

/** Raises or lowers the spyglass to match the view (the controller toggles it). */
const setSpyglass = (page: Page, raised: boolean) => page.evaluate(wanted => {
  const { controller } = (window as any).__exploration;
  if (Boolean(controller.snapshot().spyglass) !== wanted) controller.toggleSpyglass();
}, raised);

/** Aims every published pose at the sun; the body and the saved RTS camera stay unchanged. */
const aimEye = (page: Page, pitch: number, yaw: number) =>
  page.evaluate(({ pitch, yaw }) => {
    const camera = (window as any).__exploration.camera;
    camera.__originalSetPose ??= camera.setPose;
    camera.setPose = (pose: any, blend: number) =>
      camera.__originalSetPose(pose ? { ...pose, pitch, yaw } : null, blend);
  }, { pitch, yaw });

const readCounters = (page: Page) => page.evaluate(() => {
  const text = document.querySelector(".stats-overlay pre")?.textContent ?? "";
  return Object.fromEntries(["drawCalls", "triangles", "fps", "frameMs"].map(key =>
    [key, new RegExp(`${key}: (.*)`).exec(text)?.[1]?.trim() ?? null]));
});

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
const errors: string[] = [];
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    page.on("pageerror", error => errors.push(`${quality}: ${error.message}`));
    page.on("console", message => {
      if (message.type() === "error") errors.push(`${quality}: ${message.text().slice(0, 300)}`);
    });
    await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__weather = weather; window.__islandReady = true") });
    });
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&cache=0`);
    await waitForIsland(page);
    await page.addStyleTag({ content: ".stats-overlay { opacity: 0 !important; pointer-events: none; }" });
    const shots: Record<string, unknown> = {};
    report[quality] = shots;
    await setWeather(page, { hour: 12, name: "iso-noon", rain: 0 });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: resolve(output, `${quality}-iso-noon.png`) });
    await page.locator("[data-exploration-entry]").click();
    await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().phase === "possessed",
      null, { timeout: 60_000 });
    for (const view of VIEWS) {
      const sun = await setWeather(page, view);
      await setSpyglass(page, Boolean(view.spyglass));
      // The noon sun sits high: tilt the eye 0.25 rad below it so some horizon stays in frame.
      const look = view.milkyWay ? milkyWayLook(sun) : view.look;
      const yaw = look?.yaw ?? Math.atan2(sun.x, sun.z);
      const pitchOffset = view.spyglass ? 0.02 : view.hour === 12 ? 0.25 : 0.08;
      await aimEye(page, look?.pitch ?? sun.elevation - pitchOffset, yaw);
      await page.waitForTimeout(SETTLE_MS);
      await page.screenshot({ path: resolve(output, `${quality}-${view.name}.png`) });
      shots[view.name] = { sun, ...await readCounters(page) };
      console.log(quality, view.name, JSON.stringify(shots[view.name]));
    }
    await page.close();
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
