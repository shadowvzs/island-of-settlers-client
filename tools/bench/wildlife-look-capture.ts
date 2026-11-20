import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";
import { aimEye, focusGround as focus, possessEyeAt, type Spot } from "./wildlife-capture-helpers";

/**
 * Wildlife look review: per quality and subject a fresh island with the fog lifted, the iso view at
 * normal (1) and close (3) zoom on the most crowded group of the subject, for wildlife (rabbit,
 * deer, elk) a four frame gait strip of the group fleeing, then the possessed eye and the raised
 * spyglass aimed at it. Subjects are wildlife names or critter species names ("chamois",
 * "wild boar", "red fox"). Writes PNGs and `counters.json` (animalTriangles, animalDrawCalls).
 * Environment: OUTPUT, QUALITY (comma list, default high,minimal), SPECIES (subject names,
 * default deer,rabbit,elk),
 * POSSESS=0 skips the eye views, WINTER=1 starts in the cosmetic winter (winter coats), QUERY
 * adds URL parameters (an island with the subject: `seed=7`).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITY ?? "high,minimal").split(",");
const subjects = (process.env.SPECIES ?? "deer,rabbit,elk").split(",");
const possess = process.env.POSSESS !== "0";
const winter = process.env.WINTER === "1";
const extraQuery = process.env.QUERY ? `&${process.env.QUERY}` : "";
/**
 * Every summer state of the served seasonal store: the initial snapshot and the reset on start
 * (Vite may reformat the literals).
 */
const SUMMER_STATES = [/globalWinter:\s*false/g, /winterActive:\s*false/g] as const;

/**
 * The cosmetic season on from the start: the seasonal appearance store is served starting in
 * winter, so the boot and the runtime binding agree (no refresh back to summer).
 */
const forceWinter = (page: Page) => page.route("**/seasonal-appearance/store.ts*", async route => {
  const response = await route.fetch();
  let source = await response.text();
  for (const pattern of SUMMER_STATES) {
    assert(source.match(pattern), `seasonal store anchor ${pattern} changed`);
    source = source.replace(pattern, (match) => match.replace("false", "true"));
  }
  await route.fulfill({ body: source, response });
});
const SPECIES_NAMES = ["rabbit", "deer", "elk"];
const COUNTER_KEYS = ["animalTriangles", "animalDrawCalls"];
const SETTLE_MS = 1500;
const STRIP_FRAMES = 4;
const STRIP_GAP_MS = 140;
const HIDE_OVERLAYS =
  ".stats-overlay { opacity: 0 !important; pointer-events: none; } .minimap { display: none !important; }";

const readCounters = (page: Page) => page.evaluate(keys => {
  const text = document.querySelector(".stats-overlay pre")?.textContent ?? "";
  return Object.fromEntries(keys.map(key =>
    [key, new RegExp(`${key}: (.*)`).exec(text)?.[1]?.trim() ?? null]));
}, COUNTER_KEYS);

/** Every live wildlife animal or critter of a subject name, now. */
const listSubject = (page: Page, wanted: string) => page.evaluate(name => {
  const species = ["rabbit", "deer", "elk"].indexOf(name);
  if (species >= 0) return window.__listAnimals!().filter(animal => animal.species === species);
  return (window.__listCritters?.() ?? []).filter(critter => critter.name === name);
}, wanted);

const distance = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

/** The member of a subject with the most neighbours (a group reads best), now. */
const findSubject = async (page: Page, wanted: string) => {
  const own = await listSubject(page, wanted);
  const crowd = (spot: Spot) => own.filter(other => distance(other, spot) < 4).length;
  return own.reduce<Spot | null>((best, spot) => !best || crowd(spot) > crowd(best) ? spot : best, null);
};

/** The same member again (the nearest of its subject to where it was). */
const trackSubject = async (page: Page, wanted: string, last: Spot) => {
  const own = await listSubject(page, wanted);
  return own.reduce<Spot>((best, spot) => distance(spot, last) < distance(best, last) ? spot : best,
    own[0] ?? last);
};

const isWildlife = (subject: string) => SPECIES_NAMES.includes(subject);

/**
 * Iso focus on a subject: a flying bird is drawn well above its ground point, so the view is
 * re-centred on the ground behind its drawn position (twice, as the zoom moves it).
 */
const focusSubject = async (page: Page, wanted: string, spot: Spot, zoom: number) => {
  await focus(page, spot, zoom);
  if (isWildlife(wanted)) return;
  for (let round = 0; round < 2; round += 1) {
    await page.waitForTimeout(200);
    const behind = await page.evaluate(({ name, x, z }) => {
      const near = (window.__listCritters?.() ?? []).filter(critter => critter.name === name)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      return near ? window.__worker!.pickGround(near.screenX, near.screenY) : null;
    }, { name: wanted, x: spot.x, z: spot.z });
    if (behind) await focus(page, behind, zoom);
  }
};

/** Grid the camera sweeps for a critter subject (critters only live around the view). */
const SWEEP_STEP = 20;
const SWEEP_EXTENT = 240;
const SWEEP_WAIT_MS = 700;

/** Moves the view over the island until a critter of the subject lives near it. */
const sweepForSubject = async (page: Page, wanted: string) => {
  const homes = await page.evaluate(name => window.__listCritterSites?.(name) ?? [], wanted);
  for (const home of homes) {
    await focus(page, home, 1.5);
    await page.waitForTimeout(SWEEP_WAIT_MS * 3);
    const found = await findSubject(page, wanted);
    if (found) return found;
  }
  for (let z = SWEEP_STEP / 2; z < SWEEP_EXTENT; z += SWEEP_STEP) {
    for (let x = SWEEP_STEP / 2; x < SWEEP_EXTENT; x += SWEEP_STEP) {
      await focus(page, { x, z }, 1.5);
      await page.waitForTimeout(SWEEP_WAIT_MS);
      const found = await findSubject(page, wanted);
      if (found) return found;
    }
  }
  return null;
};

const captureSpecies = async (page: Page, quality: string, species: string) => {
  const name = `${quality}-${species.replaceAll(" ", "-")}`;
  const shots: Record<string, unknown> = {};
  const sweep = () => (isWildlife(species) ? null : sweepForSubject(page, species));
  let subject = (await findSubject(page, species)) ?? (await sweep());
  if (!subject) return { missing: true };
  const shot = async (view: string, wait = SETTLE_MS) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: resolve(output, `${name}-${view}.png`) });
    shots[view] = await readCounters(page);
    console.log(name, view, JSON.stringify(shots[view]));
  };
  await focusSubject(page, species, subject, 1);
  await shot("iso-normal");
  subject = await trackSubject(page, species, subject);
  await focusSubject(page, species, subject, 3);
  await shot("iso-close");
  if (isWildlife(species)) {
    subject = await trackSubject(page, species, subject);
    await focus(page, subject, 3);
    await page.evaluate(({ x, z }) => window.__threatAnimals!(x + 2.5, z + 2.5, 1), subject);
    await page.waitForTimeout(700);
    subject = await trackSubject(page, species, subject);
    await focus(page, subject, 3);
    for (let frame = 0; frame < STRIP_FRAMES; frame += 1) await shot(`gait-${frame}`, STRIP_GAP_MS);
  }
  if (!possess) return shots;
  await page.waitForTimeout(6000);
  subject = await trackSubject(page, species, subject);
  const eye = { x: subject.x - 2, z: subject.z - 2 };
  await possessEyeAt(page, eye, subject);
  const aim = async () => {
    subject = await trackSubject(page, species, subject!);
    await aimEye(page, subject);
  };
  await aim();
  await shot("possessed");
  await page.keyboard.press("KeyZ");
  await aim();
  await shot("spyglass");
  return shots;
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
const errors: string[] = [];
try {
  for (const quality of qualities) {
    for (const species of subjects) {
      const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
      page.on("pageerror", error => errors.push(`${quality}: ${error.message}`));
      await page.addInitScript("window.__name = value => value;");
      await page.routeWebSocket("**/*", () => {});
      await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
      if (winter) await forceWinter(page);
      await page.goto(`${url}?quality=${quality}&reveal=1&time=noon${extraQuery}`);
      await waitForIsland(page);
      await page.addStyleTag({ content: HIDE_OVERLAYS });
      try {
        report[`${quality}-${species}`] = await captureSpecies(page, quality, species);
      } catch (error) {
        errors.push(`${quality}-${species}: ${(error as Error).message.slice(0, 200)}`);
      }
      await page.close();
    }
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(output, "counters.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
