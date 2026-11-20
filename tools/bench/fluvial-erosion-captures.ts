import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BLOCKING, type WorldData } from "../../src/shared/world/world-data";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Relief comparison captures (M03 erosion, MC mountains and cliffs): the same seeds per variant
 * query, isometric views of the island and of its highest massif, and possessed views at the foot
 * of the tallest walkable cliff, towards the summit and through the spyglass, on High and Minimal.
 * The fog is lifted (?reveal=1) so every massif shows. Run from `island-of-settlers-client/`:
 *   OUT_DIR=<dir> SEEDS=1234,42 SIZE=256 npx tsx tools/bench/fluvial-erosion-captures.ts
 * VARIANTS=name=query;name=query (default `plain=;eroded=&fluvialErosion=1`), PREFIX names a run.
 */
const outDir = process.env.OUT_DIR ?? "/tmp/fluvial-erosion-captures";
const seeds = (process.env.SEEDS ?? "1234,42,7").split(",").map(Number);
const size = Number(process.env.SIZE ?? 256);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const prefix = process.env.PREFIX ? `${process.env.PREFIX}-` : "";
const variants = (process.env.VARIANTS ?? "plain=;eroded=&fluvialErosion=1").split(";")
  .map(entry => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)] as const);
const READY_TIMEOUT = 600_000;
/** A High 256² frame can take long on a loaded machine; the default 30 s screenshot timeout is too short. */
const SHOT_TIMEOUT = 180_000;
/** Possessed summit view: stand about this far (cells) from the summit. */
const SUMMIT_VIEW_DISTANCE = 34;
const EYE_HEIGHT = 1.7;

type Point = { x: number; z: number };
interface Pose extends Point { pitch: number; yaw: number }

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(outDir, `${prefix}${name}.png`), timeout: SHOT_TIMEOUT });

/** The world the island page generates for the query (the same choice parsing as the game). */
const generateFor = (seed: number, query: string) => {
  const choice = readIslandChoice(new URLSearchParams(`size=${size}${query}`), DEFAULT_ISLAND_CHOICE);
  return generateWorld({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice), seed });
};

const heightAt = (world: WorldData, x: number, z: number) =>
  world.heights[Math.round(z) * (world.cellsX + 1) + Math.round(x)] ?? 0;

const isWalkable = (world: WorldData, x: number, z: number) => {
  const cellX = Math.floor(x), cellZ = Math.floor(z);
  if (cellX < 1 || cellZ < 1 || cellX >= world.cellsX - 1 || cellZ >= world.cellsZ - 1) return false;
  return world.blocking[cellZ * world.cellsX + cellX] === BLOCKING.free;
};

const lookAt = (from: Point, to: Point, rise: number): Pose => {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  return { ...from, pitch: Math.atan2(rise, distance), yaw: Math.atan2(to.x - from.x, to.z - from.z) };
};

/** Free cell with the tallest rise within four cells in one direction: the foot of a real face. */
const findCliffFoot = (world: WorldData): Pose => {
  let best = { pose: lookAt(world.start, world.start, 0), rise: 0 };
  for (let z = 4; z < world.cellsZ - 4; z += 1) for (let x = 4; x < world.cellsX - 4; x += 1) {
    if (!isWalkable(world, x + .5, z + .5)) continue;
    const here = heightAt(world, x, z);
    for (let direction = 0; direction < 8; direction += 1) {
      const angle = direction * Math.PI / 4, dx = Math.cos(angle), dz = Math.sin(angle);
      const rise = heightAt(world, x + dx * 4, z + dz * 4) - here;
      if (rise <= best.rise) continue;
      const stand = { x: x + .5 - dx * 2.5, z: z + .5 - dz * 2.5 };
      if (!isWalkable(world, stand.x, stand.z)) continue;
      const face = { x: x + .5 + dx * 4, z: z + .5 + dz * 4 };
      best = { pose: lookAt(stand, face, rise * .6), rise };
    }
  }
  return best.pose;
};

/** A free spot about SUMMIT_VIEW_DISTANCE from the summit on the way to the start, looking up at it. */
const findSummitView = (world: WorldData, summit: Point): Pose => {
  const length = Math.hypot(world.start.x - summit.x, world.start.z - summit.z) || 1;
  const along = { x: (world.start.x - summit.x) / length, z: (world.start.z - summit.z) / length };
  for (let distance = SUMMIT_VIEW_DISTANCE; distance < length; distance += 1) {
    const stand = { x: summit.x + along.x * distance, z: summit.z + along.z * distance };
    if (!isWalkable(world, stand.x, stand.z)) continue;
    const rise = heightAt(world, summit.x, summit.z) - heightAt(world, stand.x, stand.z) - EYE_HEIGHT;
    return lookAt(stand, summit, rise);
  }
  return lookAt(world.start, summit, 0);
};

/** Camera targets from the generated world: the highest summit, the start and the possessed poses. */
const findTargets = (seed: number, query: string) => {
  const world = generateFor(seed, query);
  let top = 0;
  for (let index = 1; index < world.heights.length; index++) if (world.heights[index]! > world.heights[top]!) top = index;
  const stride = world.cellsX + 1;
  const summit = { x: top % stride, z: Math.floor(top / stride) };
  console.log(`seed ${seed}${query}: summit ${world.heights[top]!.toFixed(2)} at ${summit.x},${summit.z}`);
  return { cliff: findCliffFoot(world), summit, summitView: findSummitView(world, summit) };
};

const waitReady = async (page: Page) => {
  await page.waitForFunction(() => (window as unknown as { __islandReady?: boolean }).__islandReady === true, null,
    { timeout: READY_TIMEOUT });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
};

const waitPhase = (page: Page, phase: string) => page.waitForFunction(wanted => (window as unknown as {
  __exploration?: { controller: { phase: () => string } };
}).__exploration?.controller.phase() === wanted, phase, { timeout: READY_TIMEOUT });

/** Places the possessed body (the session's own body state; a bench-only shortcut) and waits a few frames. */
const placeBody = async (page: Page, pose: Pose) => {
  await page.evaluate(wanted => {
    const session = (window as unknown as { __exploration: { controller: { state: { body: Pose } } } })
      .__exploration.controller;
    session.state.body = { ...session.state.body, ...wanted };
  }, pose);
  await page.waitForTimeout(1200);
};

const capturePossessed = async (page: Page, name: string, targets: ReturnType<typeof findTargets>) => {
  const entered = await page.evaluate(() => (window as unknown as {
    __exploration?: { controller: { enter: () => Promise<{ ok: boolean; reason?: string }> } };
  }).__exploration?.controller.enter() ?? { ok: false, reason: "not wired" });
  if (!entered.ok) {
    console.log(`${name}: possessed view skipped (${entered.reason ?? "entry refused"})`);
    return;
  }
  await waitPhase(page, "possessed");
  await placeBody(page, targets.cliff);
  await shot(page, `${name}-possessed-cliff`);
  await placeBody(page, targets.summitView);
  await shot(page, `${name}-possessed-summit`);
  await page.locator('[data-exploration-control="spyglass"]').click();
  await page.waitForTimeout(1000);
  await shot(page, `${name}-possessed-spyglass`);
};

const captureVariant = async (page: Page, url: string, seed: number, quality: string, variant: string, query: string) => {
  const targets = findTargets(seed, query);
  const base = `${url}?seed=${seed}&size=${size}&quality=${quality}&cache=0&time=day&reveal=1${query}`;
  const name = `${seed}-${quality}-${variant}`;
  const views = [["iso-overview", size / 2, size / 2, 0.18], ["iso-massif", targets.summit.x, targets.summit.z, 0.6],
    ["iso-massif-close", targets.summit.x, targets.summit.z, 1.4]] as const;
  for (const [view, x, z, zoom] of views) {
    await page.goto(`${base}&view=${x},${z},${zoom}`);
    await waitReady(page);
    await shot(page, `${name}-${view}`);
  }
  await page.goto(base);
  await waitReady(page);
  await capturePossessed(page, name, targets);
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
  await page.addInitScript("window.__name=value=>value;");
  page.on("pageerror", error => console.log("[pageerror]", error.message));
  page.on("console", message => {
    if (message.type() === "error" || /shader|program/i.test(message.text())) console.log("[console]", message.text().slice(0, 400));
  });
  try {
    for (const seed of seeds) for (const quality of qualities) for (const [variant, query] of variants) {
      await captureVariant(page, url, seed, quality, variant, query);
      console.log(`captured ${seed} ${quality} ${variant}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

await main();
