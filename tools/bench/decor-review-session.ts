import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

/** Shared real-game decoration review plumbing (decor-game-review, bamboo-game-review). */
export type LiveWindow = Window & Record<string, any>;

export const settleDecorations = (page: Page, frames = 90) => page.evaluate(async count => {
  for (let index = 0; index < count; index++) await new Promise(requestAnimationFrame);
  await (window as LiveWindow).__decorationLayer?.ready();
}, frames);

export const decorationStats = (page: Page) => page.evaluate(() => {
  const live = window as LiveWindow, layer = live.__decorationLayer;
  const meshes = layer.root.children.filter((mesh: any) => mesh.isInstancedMesh && mesh.count > 0);
  return { renderer: live.__decorLive.renderer.getStats(), verges: live.__vergeLayer?.statistics(),
    decorationDraws: meshes.length,
    decorationTriangles: meshes.reduce((sum: number, mesh: any) => sum + mesh.count *
      (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3, 0),
    templates: layer.statistics() };
});

export const decorationShot = async (page: Page, output: string, name: string, rows: unknown[],
  extra: Record<string, unknown> = {}) => {
  await settleDecorations(page);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  rows.push({ name, ...extra, stats: await decorationStats(page) });
};

/** Exposes the caster group of the shadow scene so the review can hide it for the B frame. */
const CASTER_MODULE = "**/src/renderers/three/settlement/road-decoration-shadow-casters.ts*";
export const exposeDecorationCasters = async (page: Page) => {
  await page.route(CASTER_MODULE, async route => {
    const response = await route.fetch(), source = await response.text(), anchor = "shadowScene.add(root);";
    assert(source.includes(anchor), "Missing caster observation anchor");
    const body = source.replace(anchor, `${anchor} globalThis.__decorationSunCasters = root;`);
    await route.fulfill({ response, body });
  });
};

/** Frame profiler session over `milliseconds`: whole-frame GPU time and the sun shadow pass. */
export const measureFrames = async (page: Page, milliseconds: number) => {
  await page.evaluate(() => (globalThis as Record<string, any>).__frameProfiler.resetSession());
  await page.waitForTimeout(milliseconds);
  return page.evaluate(() => {
    const report = (globalThis as Record<string, any>).__frameProfiler.sessionReport();
    const shadow = report.passes.find((entry: { name: string }) => entry.name === "shadows");
    return { frameGpuMs: report.frameGpuMs as number, frames: report.frames as number,
      shadowDrawCalls: shadow?.drawCalls ?? null, shadowGpuMs: (shadow?.gpuMs ?? null) as number | null,
      shadowTriangles: shadow?.triangles ?? null };
  });
};

/** Lateral offsets (cells) from the road axis tried for each site; 0 last (across-road arches). */
const SIDE_OFFSETS = [1, -1, 1.4, -1.4, 1.8, -1.8, 2.2, -2.2, 0];
/** Roads off the HQ door, then each item at the first valid point beside (or across) a road, `spacing` apart. */
export const stageRoadDecorations = (page: Page, orders: readonly { id: string; offerId: string }[], spacing = 1.6) =>
  page.evaluate(async ({ items, sides, spacing: gap }: { items: { id: string; offerId: string }[];
    sides: number[]; spacing: number }) => {
  const settlement = (window as LiveWindow).__settlement, sim = settlement.simulation;
  settlement.removeFog?.();
  if (!settlement.playerSession.grantGems(20000)) throw new Error("Guest fixture cannot seed gems");
  const start = sim.headquarters.access;
  for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, 10], [10, -10], [-10, -10]])
    sim.connectRoads(start, { x: start.x + dx!, z: start.z + dz! });
  const placed: { item: string; x: number; z: number }[] = [], skipped: string[] = [];
  const sites: { heading: number; x: number; z: number }[] = [];
  for (const road of sim.roadSegments()) {
    const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = Math.hypot(dx, dz);
    if (length === 0) continue;
    for (let along = 0; along <= length; along += .5) for (const side of sides)
      sites.push({ heading: Math.atan2(dx, dz), x: road.start.x + (dx * along - dz * side) / length,
        z: road.start.z + (dz * along + dx * side) / length });
  }
  const tryPlace = (id: string) => {
    for (const { heading, x, z } of sites) {
      if (placed.some(other => Math.hypot(other.x - x, other.z - z) < gap)) continue;
      for (const turn of [0, Math.PI / 2]) {
        const order = { item: id, position: { x, z }, yaw: heading + turn };
        if (!sim.planRoadDecoration(order).ok || !sim.placeRoadDecoration(order).ok) continue;
        placed.push({ item: id, x, z });
        return true;
      }
    }
    return false;
  };
  for (const { id, offerId } of items) {
    if (await settlement.playerSession.buyGemOffer(offerId) !== true) { skipped.push(`${id}: offer`); continue; }
    if (!tryPlace(id)) skipped.push(`${id}: no site`);
  }
  if (placed.length === 0) throw new Error(`Nothing placed: ${skipped.join(", ")}`);
  const x = placed.reduce((sum, entry) => sum + entry.x, 0) / placed.length;
  const z = placed.reduce((sum, entry) => sum + entry.z, 0) / placed.length;
  // The simulation's own frames: where each decoration really stands (the review aims at these).
  const frames: { item: string; x: number; z: number }[] = sim.roadDecorations()
    .map((frame: { item: string; position: number[] }) =>
      ({ item: frame.item, x: frame.position[0]!, z: frame.position[2]! }));
  return { centre: { x, z }, placed: frames.length ? frames : placed, requested: placed, skipped };
}, { items: [...orders], sides: SIDE_OFFSETS, spacing });

/**
 * Iso focus whose subject really sits at the screen centre: the camera centre is a sea-level ground
 * point, so raised terrain shifts the subject; a few Newton steps on the projected ground point fix it.
 * `lift` centres the point that many world units above the ground instead (a building's middle).
 */
export const centreOn = (page: Page, site: { x: number; z: number }, zoom: number, lift = 0) =>
  page.evaluate(async ({ lift: height, x, z, zoom: value }) => {
  const settlement = (window as LiveWindow).__settlement;
  const frame = () => new Promise(requestAnimationFrame);
  /** Screen rise of `height` world units above the ground point (aims at a raised subject centre). */
  const rise = () => {
    if (!height) return 0;
    const low = settlement.project(x, 0, z), high = settlement.project(x, height, z);
    return low && high ? low.y - high.y : 0;
  };
  const project = async (cx: number, cz: number) => {
    settlement.focusGround(cx, cz, value); await frame(); await frame();
    const point = settlement.projectGround(x, z) as { x: number; y: number } | null;
    return point && { x: point.x, y: point.y - rise() };
  };
  let cx = x, cz = z;
  for (let step = 0; step < 4; step++) {
    const at = await project(cx, cz), alongX = await project(cx + 1, cz), alongZ = await project(cx, cz + 1);
    if (!at || !alongX || !alongZ) break;
    const ex = innerWidth / 2 - at.x, ey = innerHeight / 2 - at.y;
    const ax = alongX.x - at.x, ay = alongX.y - at.y, bx = alongZ.x - at.x, by = alongZ.y - at.y;
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-6) break;
    cx += (ex * by - ey * bx) / det; cz += (ax * ey - ay * ex) / det;
  }
  settlement.focusGround(cx, cz, value);
  }, { lift, x: site.x, z: site.z, zoom });

export type Point = { x: number; z: number };

export const middle = (sites: readonly Point[]) => ({ x: sites.reduce((sum, site) => sum + site.x, 0) / sites.length,
  z: sites.reduce((sum, site) => sum + site.z, 0) / sites.length });

/** Turns the RTS camera to the quarter that shows `site` with the HQ behind it rather than in front. */
export const yawAwayFromHeadquarters = (page: Page, site: Point) => page.evaluate(async ({ x, z }) => {
  const live = window as LiveWindow, camera = live.__decorLive.camera, settlement = live.__settlement;
  const hq = settlement.simulation.headquarters;
  let best = camera.yaw, score = -Infinity;
  for (let quarter = 0; quarter < 4; quarter++) {
    camera.yaw = quarter * Math.PI / 2;
    settlement.focusGround(x, z, 1);
    await new Promise(requestAnimationFrame);
    const subject = settlement.projectGround(x, z), headquarters = settlement.projectGround(hq.x, hq.z);
    if (subject && headquarters && subject.y - headquarters.y > score) {
      best = camera.yaw; score = subject.y - headquarters.y;
    }
  }
  camera.yaw = best;
}, site);

/** Ground point `distance` cells from `site`, turned `turn` radians from the side away from `from`. */
export const awayFromHeadquarters = (site: Point, from: Point, distance: number, turn = 0) => {
  const heading = Math.atan2(site.x - from.x, site.z - from.z) + turn;
  return { x: site.x + Math.sin(heading) * distance, z: site.z + Math.cos(heading) * distance };
};

/** Walks to the first reachable stand `distance` cells from `site` (away from `from`, then the two flanks). */
export const walkToStand = async (page: Page, site: Point, from: Point, distance = 4) => {
  let remaining = Infinity;
  for (const turn of [0, Math.PI / 2, -Math.PI / 2]) {
    remaining = await walkTowards(page, awayFromHeadquarters(site, from, distance, turn), .6);
    if (remaining < 1.5) break;
  }
  return remaining;
};

/** Turns the possessed body until the target ground point sits near the screen centre. */
export const faceGroundTarget = (page: Page, target: { x: number; z: number }) => page.evaluate(async ({ x, z }) => {
  const live = window as LiveWindow, controller = live.__exploration.controller;
  const width = innerWidth;
  for (let attempt = 0; attempt < 600; attempt++) {
    const point = live.__settlement.projectGround(x, z);
    const offset = point ? point.x - width / 2 : width;
    if (point && Math.abs(offset) < 40) break;
    controller.setLook(Math.sign(offset || 1) * Math.min(1.2, Math.max(.15, Math.abs(offset) / width * 3)), 0);
    await new Promise(requestAnimationFrame);
  }
  controller.setLook(0, 0);
}, target);

/**
 * Walks the possessed body towards a ground point until it stands `stop` cells away (or time runs out),
 * steering with the look input each frame. Returns the final distance.
 */
export const walkTowards = (page: Page, target: { x: number; z: number }, stop: number) =>
  page.evaluate(async ({ stop: limit, x, z }) => {
    const controller = (window as LiveWindow).__exploration.controller;
    let distance = Infinity;
    for (let frame = 0; frame < 1800; frame++) {
      const pose = controller.frame().camera?.pose;
      if (!pose) { await new Promise(requestAnimationFrame); continue; }
      distance = Math.hypot(x - pose.x, z - pose.z);
      if (distance <= limit) break;
      const wanted = Math.atan2(x - pose.x, z - pose.z);
      const turn = Math.atan2(Math.sin(wanted - pose.yaw), Math.cos(wanted - pose.yaw));
      controller.setLook(Math.max(-1.5, Math.min(1.5, turn * 3)), 0);
      controller.setMovement(Math.abs(turn) < .6 ? 1 : 0, 0);
      await new Promise(requestAnimationFrame);
    }
    controller.setMovement(0, 0); controller.setLook(0, 0);
    return distance;
  }, { stop, ...target });

/**
 * Turns the possessed eye (by its own pose, not the RTS projection) until it looks at `target` from
 * the given pitch. Forward is (sin yaw, cos yaw) (verified in the bamboo review captures).
 */
export const aimAt = (page: Page, target: { x: number; z: number }, pitch: number) =>
  page.evaluate(async ({ pitch: wantedPitch, x, z }) => {
    const controller = (window as LiveWindow).__exploration.controller;
    for (let frame = 0; frame < 900; frame++) {
      const pose = controller.frame().camera?.pose;
      if (!pose) { await new Promise(requestAnimationFrame); continue; }
      const wanted = Math.atan2(x - pose.x, z - pose.z);
      const turn = Math.atan2(Math.sin(wanted - pose.yaw), Math.cos(wanted - pose.yaw));
      const lift = wantedPitch - pose.pitch;
      if (Math.abs(turn) < .02 && Math.abs(lift) < .02) break;
      controller.setLook(Math.max(-2, Math.min(2, turn * 4)), Math.max(-2, Math.min(2, lift * 4)));
      await new Promise(requestAnimationFrame);
    }
    controller.setLook(0, 0);
  }, { pitch, ...target });

/** Focuses the RTS camera on a ground point, then possesses the settler nearest the camera centre. */
export const possessAt = async (page: Page, at: { x: number; z: number }) => {
  await page.evaluate(([x, z]) => (window as LiveWindow).__settlement.focusGround(x, z, 2), [at.x, at.z]);
  await settleDecorations(page, 20);
  await page.locator("[data-exploration-entry]").click();
  await page.waitForFunction(() => (window as LiveWindow).__exploration.controller.snapshot().phase === "possessed",
    null, { timeout: 120_000 });
};

const observe = async (page: Page, pattern: string, anchor: string, before: string, after = "") =>
  page.route(pattern, async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes(anchor), `Missing observation anchor for ${pattern}`);
    await route.fulfill({ response, body: source.replace(anchor, before + anchor + after) });
  });

/** A guest island with the decoration/verge layers and renderer exposed for the review. */
export const openDecorReviewPage = async (browser: Browser, url: string, quality: string, errors: string[],
  query = "size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1", prepare?: (page: Page) => Promise<void>) => {
  const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|WebGL|THREE/i.test(message.text())) errors.push(message.text());
  });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as LiveWindow).__name = (value: unknown) => value; });
  await observe(page, "**/src/app/island-runtime.ts*", "window.__islandReady = true;",
    "{ globalThis.__decorLive = { camera, renderer, world }; ", " }");
  await observe(page, "**/src/renderers/three/settlement/three-road-decorations.ts*", "const dispose = () => {",
    "globalThis.__decorationLayer = { root, ready: () => templates.ready(), " +
    "statistics: () => templates.statistics() };\n");
  await observe(page, "**/src/renderers/three/settlement/three-road-verges.ts*", "const dispose = () => {",
    "globalThis.__vergeLayer = { statistics };\n");
  await prepare?.(page);
  await page.goto(`${url}?quality=${quality}&${query}`);
  await page.waitForFunction(() => (window as LiveWindow).__islandReady === true && (window as LiveWindow).__decorLive,
    null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  return page;
};
