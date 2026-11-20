import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Harbour lighters (NAV-03 barge art pass) on High and Minimal: two lighters unloading a ship lying off a
 * harbour's pier. Shots of a barge rowing (gameplay zoom, then close: three frames of the stroke) and lying
 * alongside the ship. With `passengers` the lighters ferry four settlers out (a full barge each trip): shots of
 * a full barge rowing and of a passenger climbing the ladder aboard.
 * Usage: npx tsx tools/bench/harbour-lighter-review.ts [passengers]
 */
const PASSENGERS = process.argv[2] === "passengers";
const output = resourcesPath("naval-lighters-2026-10-20", PASSENGERS ? "passengers" : "art");
mkdirSync(output, { recursive: true });

/**
 * In the page: the first lighter rowing with its share of the way in [from, to] (with passengers: a full
 * barge), or with `climbing` a passenger halfway up the ladder, as a camera target.
 */
const STAGE = `(simulation, from, to, climbing) => {
  const ship = simulation.shipFrames().find(frame => frame.lighterWork);
  const work = ship?.lighterWork, boat = work?.boats[0];
  if (!boat) return null;
  const place = window.__lighterPlaceAt(work.plan, 0, work.elapsed, work.unloading);
  if (!place) return null;
  const climb = place.riders.some(rider => rider.climb > .3 && rider.climb < .7);
  const rowing = place.rowing && place.share >= from && place.share <= to &&
    (!work.plan.passengers || place.riders.length > 1);
  if (climbing ? !climb : !rowing) return null;
  const x = boat.landing.x + (boat.alongside.x - boat.landing.x) * place.share;
  const z = boat.landing.z + (boat.alongside.z - boat.landing.z) * place.share;
  return { x, z, yaw: Math.atan2(boat.alongside.x - boat.landing.x, boat.alongside.z - boat.landing.z) + 1.2,
    elapsed: Math.round(work.elapsed), lighters: work.plan.lighters, unloading: work.unloading };
}`;

/** Runs the simulation until the stage finds its lighter, frames it and shoots `frames` frames. */
const capture = async (page: Page, name: string, from: number, to: number, zoom: number, frames = 1,
  climbing = false) => {
  const target = await page.evaluate(async ({ climb, end, source, start }) => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    // Intentional: the review passes its stage finder as source text into the page (dev tool only).
    // oxlint-disable-next-line typescript/no-implied-eval
    const find = new Function("simulation", "from", "to", "climbing",
      `return (${source})(simulation, from, to, climbing);`);
    const camera = (window as any).__harbourCamera;
    for (let tick = 0; tick < 6000; tick++) {
      const found = find(simulation, start, end, climb);
      if (found) {
        settlement.focusGround(found.x, found.z);
        camera.yaw = found.yaw;
        return found;
      }
      simulation.update(.05);
      if (tick % 200 === 0) await new Promise(next => setTimeout(next, 0));
    }
    return null;
  }, { climb: climbing, end: to, source: STAGE, start: from });
  assert(target, `No ${name} within the time limit`);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, zoom);
  await page.waitForTimeout(900);
  for (let frame = 0; frame < frames; frame++) {
    await page.screenshot({ path: resolve(output, `${name}${frames > 1 ? `-${frame + 1}` : ""}.png`) });
    await page.waitForTimeout(650);
  }
  await page.mouse.wheel(0, -zoom);
  await page.waitForTimeout(300);
  return target;
};

/**
 * Debug colony harbour; once its colony ship is under way, a laden own ship lies off the second pier and the
 * harbour's two default lighters unload it (the job set up with the game's own lighter plan and landings).
 */
const prepare = async (page: Page) => page.evaluate(async (passengers: boolean) => {
  const simulation = (window as any).__settlement.simulation;
  const started = simulation.startDebugExpedition("colony");
  if (!started.ok) return started;
  const gone = () => !simulation.saveState().naval.fleet.ships.some((ship: any) => ship.phase === "loading");
  for (let tick = 0; tick < 12000 && (tick < 100 || !gone()); tick++) simulation.update(.05);
  // The game's own modules, served by the dev server.
  const source = (name: string) => import(/* @vite-ignore */ `/src/shared/settlement/${name}.ts`);
  const { lighterPlaceAt, planLighters } = await source("harbour-lighters"), { pierLandingPlaces } = await source(
    "harbour-lighter-landings");
  (window as any).__lighterPlaceAt = lighterPlaceAt;
  const state = simulation.saveState(), harbour = state.buildings.find((building: any) => building.typeId === 39);
  const pierSite = simulation.shipSites().filter((site: any) => site.kind === "pier").at(-1);
  const pier = pierSite.workPier;
  const length = Math.hypot(pier.point.x - pier.shore.x, pier.point.z - pier.shore.z);
  const out = { x: (pier.point.x - pier.shore.x) / length, z: (pier.point.z - pier.shore.z) / length };
  const ship = { x: pier.point.x + out.x * 9, z: pier.point.z + out.z * 9 };
  const boats = pierLandingPlaces(pier, length - 1, [harbour.access], () => true).slice(0, 2)
    .map((place: any, index: number) => ({ ...place, alongside: { x: ship.x - out.x * 2.6 + out.z * (index * 2.2 - 1.1),
      z: ship.z - out.z * 2.6 - out.x * (index * 2.2 - 1.1) }, place: index }));
  const row = Math.max(...boats.map((boat: any) =>
    Math.hypot(boat.alongside.x - boat.landing.x, boat.alongside.z - boat.landing.z)));
  // Passengers: four settlers rowed out, two to a barge (the plan alone: no settlers are taken from the island).
  const plan = passengers ? planLighters(0, boats.length, row, 6, false, 1, 4) : planLighters(10, boats.length, row,
    6, true);
  const fleet = state.naval.fleet, cargo: Record<string, number> = passengers ? {} : { stone: 40 };
  fleet.ships.push({ cargo, cargoCount: passengers ? 0 : 40, cursor: 0, destinationUid: harbour.uid,
    id: fleet.nextShip, lighters: { version: 2, boats, harbourUid: harbour.uid, plan }, phase: passengers ? "loading" : "unloading",
    route: [], sourceUid: harbour.uid, speed: 0, timer: plan.seconds,
    ...(passengers ? {} : { transfer: { load: { ...cargo } } }), x: ship.x, y: pierSite.y,
    yaw: Math.atan2(out.z, -out.x), z: ship.z });
  fleet.nextShip += 1;
  const loaded = simulation.loadState(state);
  return loaded.ok ? { ok: true } : loaded;
}, PASSENGERS);

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/src/app/main.ts", async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace("window.__islandReady = true",
        "window.__harbourCamera = camera; window.__islandReady = true");
      await route.fulfill({ body, response });
    });
    await page.goto(`${url}?quality=${quality}&seed=12&size=128&mountains=0&forest=0&cache=0&skipLogin=1&unlockall=1`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const prepared = await prepare(page);
    assert(prepared.ok, JSON.stringify(prepared));
    const report: Record<string, unknown> = { quality };
    report.rowingGameplay = await capture(page, `${quality}-rowing-gameplay`, .15, .3, -150);
    report.rowingClose = await capture(page, `${quality}-rowing-close`, .4, .7, -700, 3);
    if (PASSENGERS) report.climbingClose = await capture(page, `${quality}-climbing-close`, 0, 1, -700, 2, true);
    else report.alongsideClose = await capture(page, `${quality}-alongside-close`, 1, 1.1, -700);
    assert.deepEqual(errors, []);
    reports.push(report);
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally {
  await browser.close();
  await server.close();
}
