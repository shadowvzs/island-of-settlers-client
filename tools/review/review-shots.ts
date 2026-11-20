import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { aimAt, awayFromHeadquarters, centreOn, type LiveWindow, possessAt, settleDecorations, walkTowards,
  walkToStand, yawAwayFromHeadquarters } from "../bench/decor-review-session";
import { MOTION_VIEWS, motionShots } from "./review-motion";
import type { ReviewSite } from "./review-scenes";
import { isIsoView, type ReviewShot, type ReviewSpec, type ReviewView } from "./review-spec";

/** One written capture with what the manifest records about it. */
export interface ShotResult {
  file: string;
  key: string;
  /** Possessed views: cells left to the planned stand (a blocked walk shows here). */
  remaining?: number;
}

/** Possessed normal stand distance (cells). */
const NORMAL_STAND = 10;

/** Settles LOD/decoration work, then writes the viewport as `<shotsDir>/<key>.png`. */
const capture = async (page: Page, shotsDir: string, shot: ReviewShot, remaining?: number): Promise<ShotResult> => {
  await settleDecorations(page);
  await page.waitForTimeout(300);
  const file = resolve(shotsDir, `${shot.key}.png`);
  await page.screenshot({ path: file });
  return { file, key: shot.key, remaining };
};

const setYaw = (page: Page, quarter: number) => page.evaluate(value => {
  (window as LiveWindow).__decorLive.camera.yaw = value * Math.PI / 2;
}, quarter);

const isoZoom = (spec: ReviewSpec, view: ReviewView) => {
  if (view === "iso-close") return spec.zoom.close;
  return view === "iso-far" ? spec.zoom.far : spec.zoom.normal;
};

const isoShot = async (page: Page, spec: ReviewSpec, shotsDir: string, shot: ReviewShot, site: ReviewSite) => {
  if (shot.yaw === null) await yawAwayFromHeadquarters(page, site);
  else await setYaw(page, shot.yaw);
  await centreOn(page, site, isoZoom(spec, shot.view), site.lift);
  return capture(page, shotsDir, shot);
};

const exploration = (page: Page, action: "exit" | "spyglass") => page.evaluate(name => {
  const controller = (window as LiveWindow).__exploration.controller;
  if (name === "exit") controller.forceExit("session-replacement");
  else controller.toggleSpyglass();
}, action);

const pitchTowards = (site: ReviewSite, distance: number, base: number) => base + Math.atan2(site.lift, distance);

/** Spyglass from a far stand on the open side: walked to, toggled on, aimed, captured, toggled off. */
const spyglassShot = async (page: Page, shotsDir: string, shot: ReviewShot, site: ReviewSite) => {
  const distance = site.spyglassDistance;
  const left = await walkTowards(page, awayFromHeadquarters(site, site.from, distance), .8);
  await exploration(page, "spyglass");
  await aimAt(page, site, pitchTowards(site, distance, .02));
  const result = await capture(page, shotsDir, shot, left);
  await exploration(page, "spyglass");
  return result;
};

/**
 * Possessed views of one subject: possess a settler, walk to the normal stand on the subject's open
 * side, then the close stand (with the motion views), then the far spyglass stand. Exits possession at the end.
 */
const possessedShots = async (page: Page, shotsDir: string, shots: ReviewShot[], site: ReviewSite) => {
  const results: ShotResult[] = [];
  const normalStand = awayFromHeadquarters(site, site.from, NORMAL_STAND + site.standDistance - 4);
  await possessAt(page, normalStand);
  const remaining = await walkTowards(page, normalStand, .8);
  const byView = (view: ReviewView) => shots.find(shot => shot.view === view);
  const normal = byView("possessed-normal"), spyglass = byView("spyglass"), close = byView("possessed-close");
  if (normal) {
    await aimAt(page, site, pitchTowards(site, NORMAL_STAND, .05));
    results.push(await capture(page, shotsDir, normal, remaining));
  }
  const motion = shots.filter(shot => MOTION_VIEWS.includes(shot.view));
  if (close || motion.length) {
    const left = await walkToStand(page, site, site.from, site.standDistance);
    await aimAt(page, site, pitchTowards(site, site.standDistance, .1));
    if (close) results.push(await capture(page, shotsDir, close, left));
    results.push(...await motionShots(page, shotsDir, motion, site));
  }
  if (spyglass) results.push(await spyglassShot(page, shotsDir, spyglass, site));
  await exploration(page, "exit");
  return results;
};

/** Every shot of one subject in one preset: iso views first, then the possessed sequence. */
export const captureSubject = async (page: Page, spec: ReviewSpec, shotsDir: string, shots: ReviewShot[],
  site: ReviewSite) => {
  const results: ShotResult[] = [];
  for (const shot of shots.filter(entry => isIsoView(entry.view)))
    results.push(await isoShot(page, spec, shotsDir, shot, site));
  const possessed = shots.filter(entry => !isIsoView(entry.view));
  if (possessed.length) results.push(...await possessedShots(page, shotsDir, possessed, site));
  return results;
};
