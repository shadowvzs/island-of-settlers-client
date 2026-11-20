import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gameErrors, openFreshIsland, trackPageErrors } from "./expedition-review-helpers";
import { openColony, stageRaidShip } from "./raid-ship-stage";

/**
 * Live pirate raid landing review (docs/plans/pirate-landing-2026-11-17.md): a real hard-colony raid ship,
 * captured through the whole sequence on the real renderer. Per preset and pirate hull: the first raider
 * frame (galley fallback while the lazy pack loads), the approach with the raiders on deck, the gangway
 * deploying at anchor, the anchored ship at close / normal / mid / far zoom (LOD switching), the raiders walking
 * down and ashore, and the gangway running in as the ship leaves. Each raid launches one ship; the
 * second raid of a preset sails the other hull. Also probes picking over the hull.
 *
 * ISLAND_SEED picks the colony (default 3: open water ahead of the anchorage, so the ship sails away;
 * on seed 1234 it has none and is gone at once).
 *
 *   OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [LAUNCHES=0,1] [ISLAND_SEED=3]
 */
type Page = import("playwright-core").Page;
type Point = { x: number; z: number };

const output = process.env.OUTPUT_DIR;
assert(output, "Set OUTPUT_DIR");
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const launchCounts = (process.env.LAUNCHES ?? "0,1").split(",").map(Number);
const islandSeed = Number(process.env.ISLAND_SEED ?? 3);
const ZOOM = { close: 2.4, far: .45, mid: .7, normal: 1 };
const report: Record<string, unknown> = {};
let stage = "start";

/** Stops (or resumes) the simulation clock while the renderer keeps drawing. */
const freeze = (page: Page, frozen: boolean) => page.evaluate(frozen => {
  const simulation = (window as any).__settlement.simulation;
  simulation.__update ??= simulation.update;
  simulation.update = frozen ? () => undefined : simulation.__update;
}, frozen);
const tick = (page: Page, seconds: number) => page.evaluate(seconds => {
  const simulation = (window as any).__settlement.simulation;
  for (let step = 0; step < seconds * 20; step++) simulation.__update(.05);
}, seconds);
const view = (page: Page, point: Point, zoom: number) => page.evaluate(({ point, zoom }) =>
  (window as any).__settlement.focusGround(point.x, point.z, zoom), { point, zoom });
const shot = async (page: Page, name: string, settle = 900) => {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  console.log("shot", name);
};

/** The live raid: ship frame, gangway site and the raiders by phase. */
const raidState = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const ship = simulation.shipFrames().find((frame: any) => frame.livery === "enemy");
  const site = ship && simulation.shipSites().find((entry: any) => entry.id === ship.id);
  const phases: Record<string, number> = {};
  for (const actor of simulation.frames())
    if (String(actor.phase).startsWith("adventure")) phases[actor.phase] = (phases[actor.phase] ?? 0) + 1;
  const deck = simulation.frames().filter((actor: any) => actor.phase === "adventureAboard" && actor.visible)
    .map((actor: any) => ({ uid: actor.uid, x: +actor.x.toFixed(2), y: +actor.y.toFixed(2), z: +actor.z.toFixed(2) }));
  const pack = performance.getEntriesByType("resource").filter(entry => entry.name.includes("pirate-ships"))
    .map(entry => ({ name: entry.name.split("/").pop(), ms: Math.round(entry.duration) }));
  return { deck, pack, phases, ship: ship && { id: ship.id, phase: ship.phase, x: ship.x, yaw: ship.yaw, z: ship.z },
    work: site?.workPier };
});
/** Ticks until `done` holds for the raid state (simulation seconds, 20 Hz). */
const until = async (page: Page, seconds: number, done: (state: Awaited<ReturnType<typeof raidState>>) => boolean) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += .5) {
    const state = await raidState(page);
    if (done(state)) return state;
    await tick(page, .5);
  }
  throw new Error(`${stage}: timed out`);
};

/** Close, normal, mid and far iso views of `point` (the far ones show the LOD switch). */
const zoomSet = async (page: Page, name: string, point: Point, zooms: readonly (keyof typeof ZOOM)[]) => {
  for (const zoom of zooms) { await view(page, point, ZOOM[zoom]); await shot(page, `${name}-${zoom}`); }
};

/** Orbits the camera by holding the rotate key (1.4 rad/s): a half turn views the gangway from the shore. */
const turnCamera = async (page: Page, radians: number) => {
  await page.keyboard.down("KeyQ");
  await page.waitForTimeout(radians / 1.4 * 1000);
  await page.keyboard.up("KeyQ");
};
/** Hover over the hull centre: picking draws the ship's hover outline. */
const hoverShot = async (page: Page, name: string, ship: Point) => {
  await view(page, ship, ZOOM.normal);
  await page.mouse.move(640, 430);
  await page.mouse.move(641, 431);
  await shot(page, name);
  await page.mouse.move(5, 5);
};

const reviewRaid = async (page: Page, quality: string, launches: number) => {
  const tag = `${quality}-raid${launches + 1}`;
  stage = `${tag} stage`;
  const failed = await stageRaidShip(page, launches || undefined);
  assert(!failed, `${tag}: ${failed}`);
  await freeze(page, true);
  stage = `${tag} launch`;
  const first = await until(page, 10, state => Boolean(state.ship));
  // First raider frame: the pack request starts now, the galley stands in meanwhile.
  await view(page, first.ship!, ZOOM.normal);
  await shot(page, `${tag}-0-first-frame`, 60);
  stage = `${tag} approach`;
  const approach = await until(page, 60, state => state.ship?.phase === "sailing" && Boolean(state.deck.length) &&
    Math.hypot(state.ship!.x - first.ship!.x, state.ship!.z - first.ship!.z) >= 1.5);
  await zoomSet(page, `${tag}-1-approach`, approach.ship!, ["close", "normal"]);
  // The deploy burst from the shore side (the iso view looks at the gangway over the hull).
  await turnCamera(page, Math.PI);
  stage = `${tag} anchor`;
  const anchored = await until(page, 60, state => Boolean(state.work));
  const work = anchored.work!;
  const middle = { x: (anchored.ship!.x + work.shore.x) / 2, z: (anchored.ship!.z + work.shore.z) / 2 };
  await view(page, middle, ZOOM.close);
  for (const [index, wait] of [60, 250, 300, 600].entries()) await shot(page, `${tag}-2-deploy-shore-${index}`, wait);
  await shot(page, `${tag}-3-anchored-shore-close`);
  await view(page, middle, ZOOM.normal);
  await shot(page, `${tag}-3-anchored-shore-normal`);
  await turnCamera(page, Math.PI);
  await zoomSet(page, `${tag}-3-anchored`, middle, ["close", "normal", "mid", "far"]);
  await hoverShot(page, `${tag}-3-anchored-hover-pick`, anchored.ship!);
  stage = `${tag} landing`;
  const walking = await until(page, 30, state => (state.phases.adventureGangway ?? 0) > 0);
  await view(page, middle, ZOOM.close);
  await shot(page, `${tag}-4-gangway-walk`);
  await turnCamera(page, Math.PI);
  await shot(page, `${tag}-4-gangway-walk-shore`);
  await tick(page, 2);
  await shot(page, `${tag}-5-gangway-walk-later-shore`);
  await turnCamera(page, Math.PI);
  await shot(page, `${tag}-5-gangway-walk-later`);
  await view(page, middle, ZOOM.normal);
  await shot(page, `${tag}-6-landing-normal`);
  stage = `${tag} leaving`;
  const ashore = await until(page, 120, state => !state.phases.adventureAboard && !state.phases.adventureGangway);
  await view(page, middle, ZOOM.normal);
  await shot(page, `${tag}-7-all-ashore`);
  // Weighing anchor: the gangway runs in, the ship gathers way and sails off (or is gone at once).
  const leaving = await until(page, 60, state => state.ship?.phase !== "idle");
  for (const [index, wait] of [60, 300, 500].entries()) await shot(page, `${tag}-8-leaving-${index}`, wait);
  for (const index of [3, 4, 5]) { await tick(page, 4); await shot(page, `${tag}-8-leaving-${index}`); }
  const gone = await until(page, 60, state => !state.ship);
  await shot(page, `${tag}-9-gone`);
  await freeze(page, false);
  report[tag] = { anchored, approach, ashore: ashore.phases, first, gone: gone.pack, leaving: leaving.ship,
    walking: walking.phases };
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => stage);
    page.on("console", message => { if (message.type() === "warning" && message.text().includes("Pirate"))
      errors.push(`${stage}: ${message.text()}`); });
    await page.addInitScript("performance.setResourceTimingBufferSize(20000);");
    await openFreshIsland(page, url, quality);
    await openColony(page, url, quality, "hard", islandSeed);
    for (const launches of launchCounts) await reviewRaid(page, quality, launches);
    report[`${quality}-errors`] = gameErrors(errors);
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log("done", output);
