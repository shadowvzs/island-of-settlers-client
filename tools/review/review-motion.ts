import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { aimAt, type LiveWindow, settleDecorations } from "../bench/decor-review-session";
import { writeContactSheet } from "./review-contact-sheet";
import type { ReviewSite } from "./review-scenes";
import type { ReviewShot, ReviewView } from "./review-spec";

/**
 * Possessed motion views (owner review rule 2026-11-13: still frames alone are not acceptance), taken
 * from the close stand: looking up at the subject against the sky, and three six-frame strips: small
 * steps forward and back, a camera turn across the subject, and wind (0.2 s apart, standing still).
 * A strip is written as `<key>-f<n>.png` frames plus `<key>.png`, one labelled row of all frames.
 */
export const MOTION_VIEWS: readonly ReviewView[] = ["possessed-up", "possessed-walk", "possessed-turn",
  "possessed-wind"];

const FRAMES = 6;
/** Pitch (radians, up positive) of the looking-up view; the strips aim at the subject from the eye. */
const UP_PITCH = .75;
const EYE_HEIGHT = 1.2;
/** Frames of walking per step (about a quarter cell), and the yaw span (radians) of the turn strip. */
const STEP_FRAMES = 4;
const TURN_SPAN = .9;
const WIND_INTERVAL = 200;

type FramePose = (page: Page, frame: number) => Promise<void>;

const getPose = (page: Page) => page.evaluate(() =>
  (window as LiveWindow).__exploration.controller.frame().camera?.pose as { x: number; z: number });

/** Walks `frames` animation frames forward (1) or back (-1), then stops. */
const step = (page: Page, direction: number) => page.evaluate(async ({ count, move }) => {
  const controller = (window as LiveWindow).__exploration.controller;
  for (let frame = 0; frame < count; frame++) {
    controller.setMovement(move, 0);
    await new Promise(requestAnimationFrame);
  }
  controller.setMovement(0, 0);
}, { count: STEP_FRAMES, move: direction });

/** A ground point at the subject's distance, turned by `angle` about the eye. */
const turnedTarget = async (page: Page, site: ReviewSite, angle: number) => {
  const eye = await getPose(page);
  const dx = site.x - eye.x, dz = site.z - eye.z;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: eye.x + dx * cos - dz * sin, z: eye.z + dx * sin + dz * cos };
};

/** Pitch that centres the subject (its lift above the ground) from the close stand. */
const stripPitch = (site: ReviewSite) => Math.atan2(site.lift - EYE_HEIGHT, site.standDistance);

const framePoses = (site: ReviewSite): Record<string, FramePose> => ({
  "possessed-turn": async (page, frame) =>
    aimAt(page, await turnedTarget(page, site, (frame / (FRAMES - 1) - .5) * TURN_SPAN), stripPitch(site)),
  "possessed-walk": async (page, frame) => {
    if (frame > 0) await step(page, frame <= FRAMES / 2 ? 1 : -1);
    await aimAt(page, site, stripPitch(site));
  },
  "possessed-wind": async (page, frame) => {
    if (frame > 0) await page.waitForTimeout(WIND_INTERVAL);
  }
});

const STRIP_TITLES: Record<string, string> = {
  "possessed-turn": "camera turn across the subject",
  "possessed-walk": "small steps forward (1-3) and back (4-5)",
  "possessed-wind": `wind, ${WIND_INTERVAL} ms apart`
};

/** Six frames of one strip, then the labelled strip image `<key>.png`. */
const captureStrip = async (page: Page, shotsDir: string, shot: ReviewShot, site: ReviewSite) => {
  const pose = framePoses(site)[shot.view]!;
  await aimAt(page, site, stripPitch(site));
  await settleDecorations(page);
  const cells = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    await pose(page, frame);
    const path = resolve(shotsDir, `${shot.key}-f${frame}.png`);
    await page.screenshot({ path });
    cells.push({ label: `frame ${frame}`, path });
  }
  const file = resolve(shotsDir, `${shot.key}.png`);
  const browser = page.context().browser()!;
  await writeContactSheet(browser, { columns: FRAMES, rows: [{ cells, heading: STRIP_TITLES[shot.view]! }],
    title: shot.key, width: 3600 }, file);
  return file;
};

const captureUp = async (page: Page, shotsDir: string, shot: ReviewShot, site: ReviewSite) => {
  await aimAt(page, site, UP_PITCH);
  await settleDecorations(page);
  const file = resolve(shotsDir, `${shot.key}.png`);
  await page.screenshot({ path: file });
  return file;
};

/** Motion views of one subject from the current (close) stand, in MOTION_VIEWS order. */
export const motionShots = async (page: Page, shotsDir: string, shots: ReviewShot[], site: ReviewSite) => {
  const results = [];
  for (const view of MOTION_VIEWS) {
    const shot = shots.find(entry => entry.view === view);
    if (!shot) continue;
    const file = view === "possessed-up" ? await captureUp(page, shotsDir, shot, site)
      : await captureStrip(page, shotsDir, shot, site);
    results.push({ file, key: shot.key });
  }
  return results;
};
