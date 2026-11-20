import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { writeContactSheet } from "../review/review-contact-sheet";
import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";
import { aimEye, focusGround, possessEyeAt, type Spot } from "./wildlife-capture-helpers";

/**
 * Lying-to-moving review of wildlife (elk-motion lane, 2026-11-13): an animal is bedded, its region
 * left to go dormant, and its routine drawing is shot from the moment it sleeps (rising) until it
 * walks its first leg. The bug this guards: a dormant animal walked its routine in the bedded pose.
 * Per quality and view (iso close, possessed eye) a frame strip, plus `sheet.png` and `frames.json`
 * (time, drawn rest fold, walking). Environment: OUTPUT, LABEL (before / after, file prefix),
 * QUALITY (default high,minimal), VIEWS (iso-close, iso-normal, possessed; default all three),
 * SPECIES (wildlife id, default 2 elk).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const label = process.env.LABEL ?? "after";
const qualities = (process.env.QUALITY ?? "high,minimal").split(",");
const views = (process.env.VIEWS ?? "iso-close,iso-normal,possessed").split(",");
/** Iso zoom per view (the TOOL-3 close and normal gameplay distances). */
const ISO_ZOOM: Record<string, number> = { "iso-close": 3, "iso-normal": 1.2 };
const species = Number(process.env.SPECIES ?? 2);
const HIDE_OVERLAYS =
  ".stats-overlay { opacity: 0 !important; pointer-events: none; } .minimap { display: none !important; }";
/** Seconds after the region sleeps at which the rising is shot. */
const RISE_TIMES = [0.3, 1.2, 2.4];
/** Seconds after the routine starts walking at which the walk is shot. */
const WALK_TIMES = [0, 0.6, 1.2];
const SLEEP_TIMEOUT_MS = 120_000;
const WALK_TIMEOUT_MS = 30_000;

interface Frame { file: string; rest: number; seconds: number; walking: boolean }

/** The subject: the species member farthest from the view centre (away from the settlers). */
const pickSubject = (page: Page) => page.evaluate(wanted => {
  const settlement = (window as any).__settlement;
  const centre = settlement?.camera ?? { centerX: 0, centerZ: 0 };
  const own = window.__wildlife!.listLiving().filter(animal => animal.species === wanted);
  const away = (animal: { x: number; z: number }) =>
    Math.hypot(animal.x - centre.centerX, animal.z - centre.centerZ);
  return own.sort((a, b) => away(b) - away(a))[0] ?? null;
}, species);

/** Wakes the subject's region, beds it at once and keeps it bedded until the region sleeps. */
const bedSubject = (page: Page, id: number) => page.evaluate(slot => {
  const manager = window.__wildlife!;
  manager.ensureSimulated(slot);
  const { motion, pool } = manager.debug;
  pool.state[slot] = 8;
  pool.stateTime[slot] = 0;
  pool.stateLength[slot] = 1e9;
  pool.speed[slot] = 0;
  pool.pathCount[slot] = 0;
  motion.rest[slot] = 1;
}, id);

const readSubject = (page: Page, id: number) => page.evaluate(slot => {
  const { debug } = window.__wildlife!;
  const { identity, motion, pool } = debug;
  return {
    dormant: identity.dormant[slot] === 1,
    rest: motion.rest[slot]!,
    walking: pool.velocityX[slot] !== 0 || pool.velocityZ[slot] !== 0,
    x: pool.x[slot]!,
    z: pool.z[slot]!
  };
}, id);

const waitFor = async (page: Page, id: number, done: (state: Awaited<ReturnType<typeof readSubject>>) => boolean,
  timeout: number) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await readSubject(page, id);
    if (done(state)) return Date.now();
    await page.waitForTimeout(100);
  }
  throw new Error("timed out waiting for the subject");
};

const captureStrip = async (page: Page, quality: string, view: string) => {
  const subject = await pickSubject(page);
  if (!subject) throw new Error("no subject of the species");
  const { id } = subject;
  await bedSubject(page, id);
  if (view === "possessed") await possessEyeAt(page, { x: subject.x - 2.5, z: subject.z - 2.5 }, subject);
  else await focusGround(page, subject, ISO_ZOOM[view]!);
  const slept = await waitFor(page, id, state => state.dormant, SLEEP_TIMEOUT_MS);
  const frames: Frame[] = [];
  const shoot = async (name: string, since: number) => {
    const state = await readSubject(page, id);
    const spot: Spot = { x: state.x, z: state.z };
    if (view === "possessed") await aimEye(page, spot);
    else await focusGround(page, spot, ISO_ZOOM[view]!);
    await page.waitForTimeout(120);
    const file = resolve(output, `${label}-${quality}-${view}-${name}.png`);
    await page.screenshot({ path: file });
    const after = await readSubject(page, id);
    frames.push({ file, rest: after.rest, seconds: (Date.now() - since) / 1000, walking: after.walking });
  };
  for (const [index, seconds] of RISE_TIMES.entries()) {
    await page.waitForTimeout(Math.max(0, slept + seconds * 1000 - Date.now()));
    await shoot(`rise-${index}`, slept);
  }
  const walked = await waitFor(page, id, state => state.walking, WALK_TIMEOUT_MS);
  for (const [index, seconds] of WALK_TIMES.entries()) {
    await page.waitForTimeout(Math.max(0, walked + seconds * 1000 - Date.now()));
    await shoot(`walk-${index}`, slept);
  }
  return frames;
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, Frame[]> = {};
const errors: string[] = [];
try {
  for (const quality of qualities) {
    for (const view of views) {
      const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
      page.on("pageerror", error => errors.push(`${quality}: ${error.message}`));
      await page.addInitScript("window.__name = value => value;");
      await page.routeWebSocket("**/*", () => {});
      await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
      await page.goto(`${url}?quality=${quality}&reveal=1&time=noon`);
      await waitForIsland(page);
      await page.addStyleTag({ content: HIDE_OVERLAYS });
      try {
        report[`${quality}-${view}`] = await captureStrip(page, quality, view);
        console.log(quality, view, JSON.stringify(report[`${quality}-${view}`]?.map(frame => frame.rest)));
      } catch (error) {
        errors.push(`${quality}-${view}: ${(error as Error).message.slice(0, 200)}`);
      }
      await page.close();
    }
  }
  const rows = Object.entries(report).map(([key, frames]) => ({
    cells: frames.map(frame => ({ label: `${frame.seconds.toFixed(1)} s · rest ${frame.rest.toFixed(2)}` +
      (frame.walking ? " · walking" : ""), path: frame.file })),
    heading: `${label} · ${key}`
  }));
  await writeContactSheet(browser, { columns: 6, rows, title: `Wildlife lying to moving (${label})` },
    resolve(output, `${label}-sheet.png`));
} finally {
  writeFileSync(resolve(output, `${label}-frames.json`), JSON.stringify({ errors, report }, null, 2));
  await browser.close();
  await server.close();
}
