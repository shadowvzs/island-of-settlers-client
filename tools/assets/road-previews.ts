import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { PIXELS_PER_UNIT } from "../../src/render-common/iso-projection";
import { ROAD_TIERS, type RoadTier } from "../../src/shared/settlement/road-types";
import { launchBrowser, startDevServer } from "../bench/browser";

/**
 * Road-tab thumbnails rendered on a real generated island with the shipped ground, grass, water
 * and daylight rather than a flat backdrop. One island page renders every road tier from the same
 * meadow patch and camera; both bridge kinds share one real river crossing and camera.
 * Run: npx tsx tools/assets/road-previews.ts
 *      [--bridges | --verges | --road-tab | --sheet | --minimal]
 */

const screenshotSize = { height: 256, width: 384 };
/** The bridge camera width: close enough that the deck and both grassy banks fill the card. */
const bridgeZoom = 1;
/** The original flat-backdrop icons framed 3.3 world units across their 384 px. */
const originalIconWidth = 3.3;
/** Owner 2026-11-08: the road camera shows 1.4x the original framing, the same for every tier. */
const roadFrameWidth = originalIconWidth * 1.4;
const roadZoom = screenshotSize.width / (roadFrameWidth * PIXELS_PER_UNIT);
/** Half-cell steps per road arm: a 2.5 unit L at the same camera for every tier. */
const roadArmSteps = 5;
const roadStep = 0.5;
const roadArmLength = roadArmSteps * roadStep;
const captures = resolve(process.env.ROAD_PREVIEW_CAPTURES ?? "../../captures/road-icons");
const outputArgument = process.argv.find(value => value.startsWith("--output="))?.slice("--output=".length);
const output = resolve(outputArgument ?? process.env.ROAD_PREVIEW_OUTPUT ?? "assets/road-previews");
const quality = process.argv.includes("--minimal") || process.env.ROAD_PREVIEW_QUALITY === "minimal"
  ? "minimal"
  : "high";
const bridgesOnly = process.argv.includes("--bridges");
const vergesOnly = process.argv.includes("--verges");
const roadTabOnly = process.argv.includes("--road-tab");
const sheetOnly = process.argv.includes("--sheet");
const beforeFolder = resolve(process.env.ROAD_PREVIEW_BEFORE ?? resolve(captures, "before"));
const sheetRows = ["dirt", "stone", "limestone", "granite", "basalt", "marble",
  "bridge-wood", "bridge-stone", "verge-flowers"];
mkdirSync(output, { recursive: true });
if (roadTabOnly || sheetOnly) mkdirSync(captures, { recursive: true });

/** The review patches: only this tool sees them, the normal island path is untouched. */
const ISLAND_RUNTIME_HOOK = "profileFirstFrame(renderer, () => {";
const SETTLEMENT_RENDERER_HOOK = "const syncRoads = (frame) => {";

interface PreviewPoint {
  x: number;
  z: number;
}

interface RoadPlanRow {
  end: PreviewPoint;
  segments: unknown[];
  start: PreviewPoint;
  tiles: number;
}

const frames = (page: Page, count = 3) => page.evaluate(async total => {
  for (let index = 0; index < total; index += 1)
    await new Promise(done => requestAnimationFrame(done));
}, count);

/** The game window overlays are DOM siblings of the canvas; the icon is the rendered world only. */
const hideOverlays = (page: Page) => page.addStyleTag({ content: `
  #viewport > *:not(#view), body > *:not(#viewport) { display: none !important; }
` });

/** Exposes the live camera/world and the shared road layers to this tool only. */
const installPreviewHooks = async (page: Page) => {
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    if (!source.includes(ISLAND_RUNTIME_HOOK))
      throw new Error("island-runtime preview marker missing");
    await route.fulfill({ response, body: source.replace(ISLAND_RUNTIME_HOOK,
      `window.__roadPreviewWorld = { camera, renderer, world };${ISLAND_RUNTIME_HOOK}`) });
  });
  await page.route("**/src/renderers/three/three-renderer-settlement.ts*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    if (!source.includes(SETTLEMENT_RENDERER_HOOK))
      throw new Error("three-renderer-settlement preview marker missing");
    await route.fulfill({ response, body: source.replace(SETTLEMENT_RENDERER_HOOK,
      `window.__roadPreviewLayers = { bridges, roadVerges, roads };\n${SETTLEMENT_RENDERER_HOOK}`) });
  });
};

const openIsland = async (
  browser: Browser, url: string, extraQuery: string,
  { hideUi = true, viewport = screenshotSize } = {}
) => {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value;");
  await installPreviewHooks(page);
  await page.goto(`${url}admin.html?quality=${quality}&cache=0&time=day&reveal=1${extraQuery}`,
    { timeout: 120_000 });
  await page.waitForFunction(() => Boolean(
    (window as any).__islandReady && (window as any).__settlement &&
    (window as any).__roadPreviewWorld && (window as any).__roadPreviewLayers
  ), null, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  if (hideUi) await hideOverlays(page);
  return { errors, page };
};

/**
 * Finds a flat, open meadow square for the whole icon frame: dry ground well above the sea, grass
 * splat, no blocking cell, prop, road, building or map edge in view. Returns the L's apex.
 */
const findMeadowPatch = (page: Page) => page.evaluate(({ armLength, reach }) => {
  const live = (window as any).__settlement;
  const world = (window as any).__roadPreviewWorld.world;
  const simulation = live.simulation;
  const headquarters = simulation.headquarters;
  const stride = world.cellsX + 1;
  const roads = live.roads.segments();
  const buildings = simulation.buildings();
  const deposits = simulation.marbleDeposits();
  const props = world.props;
  /** Trees, shrubs and rocks break the clean meadow; flowers, mushrooms and pebbles are scenery. */
  const coarseProps = new Set([0, 1, 2, 3, 4, 5, 10, 11, 13, 15, 16, 17, 18, 21, 22, 23, 24]);
  const coarsePropWithin = (x: number, z: number, radius: number) => {
    for (let index = 0; index < props.count; index += 1)
      if (coarseProps.has(props.types[index]!) && Math.hypot(props.x[index]! - x, props.z[index]! - z) < radius)
        return true;
    return false;
  };
  const occupied = (x: number, z: number) =>
    roads.some((segment: any) => Math.hypot(segment.start.x - x, segment.start.z - z) < reach + 1) ||
    buildings.some((building: any) => Math.hypot(building.x - x, building.z - z) < reach + 2) ||
    deposits.some((deposit: any) => Math.hypot(deposit.x - x, deposit.z - z) < reach + 1);
  const nearWater = (x: number, z: number, radius: number) => {
    for (let sz = Math.floor(z - radius); sz <= Math.ceil(z + radius); sz += 1)
      for (let sx = Math.floor(x - radius); sx <= Math.ceil(x + radius); sx += 1)
        if (world.blocking[sz * world.cellsX + sx] === 1) return true;
    return false;
  };
  let best: any = null;
  const rejected = { cellBlocked: 0, foreign: 0, grass: 0, height: 0, occupied: 0, props: 0,
    total: 0, water: 0 };
  for (let cornerZ = 10; cornerZ < world.cellsZ - 10; cornerZ += 1)
    for (let cornerX = 10; cornerX < world.cellsX - 10; cornerX += 1) {
      rejected.total += 1;
      const centreX = cornerX - armLength / 2, centreZ = cornerZ - armLength / 2;
      if (Math.hypot(centreX - headquarters.x, centreZ - headquarters.z) < 16) continue;
      if (occupied(centreX, centreZ)) { rejected.occupied += 1; continue; }
      // Reeds and cattails grow on the wet coastal fringe and read as dark stalks in the frame.
      if (nearWater(centreX, centreZ, 13)) { rejected.water += 1; continue; }
      let blocked = false, cellBlocked = false, foreign = 0, grass = 0, maximum = -Infinity,
        minimum = Infinity, samples = 0;
      for (let z = Math.floor(centreZ - reach); z <= Math.ceil(centreZ + reach) && !blocked; z += 1)
        for (let x = Math.floor(centreX - reach); x <= Math.ceil(centreX + reach) && !blocked; x += 1) {
          const vertex = z * stride + x, height = world.heights[vertex];
          if (height <= world.seaLevel + .4) { blocked = true; break; }
          const cellBlocking = world.blocking[z * world.cellsX + x]!;
          if (cellBlocking === 1 || cellBlocking === 2) { blocked = true; cellBlocked = true; break; }
          const weights = world.splat, offset = vertex * 9;
          const grassWeight = weights[offset]! + weights[offset + 1]! + weights[offset + 2]!;
          // A natural dirt/rock/sand patch in frame reads as a second path; a few speckles are fine.
          if (grassWeight < 150 || weights[offset + 3]! > 64 || weights[offset + 4]! > 64 ||
            weights[offset + 5]! > 64) foreign += 1;
          maximum = Math.max(maximum, height);
          minimum = Math.min(minimum, height);
          grass += grassWeight;
          samples += 1;
        }
      if (blocked) {
        if (cellBlocked) rejected.cellBlocked += 1; else rejected.water += 1;
        continue;
      }
      const roadHalf = armLength / 2 + .6;
      for (let z = Math.floor(centreZ - roadHalf); z <= Math.ceil(centreZ + roadHalf) && !blocked; z += 1)
        for (let x = Math.floor(centreX - roadHalf); x <= Math.ceil(centreX + roadHalf) && !blocked; x += 1)
          if (world.blocking[z * world.cellsX + x] !== 0) blocked = true;
      if (blocked) { rejected.cellBlocked += 1; continue; }
      const foreignShare = foreign / samples;
      if (foreignShare > .18) { rejected.foreign += 1; continue; }
      const grassShare = grass / samples / 255;
      if (grassShare < .7) { rejected.grass += 1; continue; }
      if (maximum - minimum > .42) { rejected.height += 1; continue; }
      let propPenalty = 0;
      if (coarsePropWithin(centreX, centreZ, reach)) propPenalty = 4;
      else if (coarsePropWithin(centreX, centreZ, reach + 2)) propPenalty = .5;
      const score = (maximum - minimum) * 2 + Math.max(0, .9 - grassShare) * 6 + foreignShare * 30 +
        propPenalty;
      if (!best || score < best.score) best = { corner: { x: cornerX, z: cornerZ }, score };
    }
  if (!best) throw new Error(`No flat open meadow patch for the road preview: ${JSON.stringify({
    ...rejected, cells: [world.cellsX, world.cellsZ], seaLevel: world.seaLevel
  })}`);
  return best.corner;
}, { armLength: roadArmLength, reach: 6 }) as Promise<PreviewPoint>;

/** Freezes the simulation and shows one L-shaped road tier (optionally flower-verged) at the patch. */
const placeRoad = (
  page: Page, corner: PreviewPoint, tier: RoadTier, verges: boolean
) => page.evaluate(({ armSteps, corner, step, tier, verges, zoom }) => {
  const live = (window as any).__settlement;
  if (!(window as any).__roadPreviewFrozen) {
    live.realUpdate = live.simulation.update;
    live.simulation.update = () => {};
    (window as any).__roadPreviewFrozen = true;
  }
  const segments: any[] = [];
  const run = (dx: number, dz: number) => {
    let at = { x: corner.x, z: corner.z };
    for (let index = 0; index < armSteps; index += 1) {
      const next = { x: at.x + dx * step, z: at.z + dz * step };
      segments.push({ end: next, start: at, tier, ...(verges ? { verge: "flowers" } : {}) });
      at = next;
    }
  };
  run(-1, 0);
  run(0, -1);
  if (!live.roads.replaceSegments(segments)) throw new Error(`Road segments refused for ${tier}`);
  const camera = (window as any).__roadPreviewWorld.camera;
  camera.tilt = 0;
  camera.yaw = 0;
  live.focusGround(corner.x - armSteps * step / 2, corner.z - armSteps * step / 2, zoom);
}, { armSteps: roadArmSteps, corner, step: roadStep, tier, verges, zoom: roadZoom });

/** Waits for the dirt soil WebP to replace its baked fallback before the first shot. */
const waitForRoadMaterials = async (page: Page) => {
  await page.waitForFunction(() => {
    const dirt = (window as any).__roadPreviewLayers?.roads.root.getObjectByName("dirt_roads");
    if (!dirt) return false;
    const loaded = (texture: any) => texture?.image instanceof HTMLImageElement &&
      texture.image.complete && texture.image.naturalWidth > 0;
    const bump = dirt.material.bumpMap;
    return loaded(dirt.material.map) && (!bump || loaded(bump));
  }, null, { timeout: 60_000 });
};

const captureRoad = async (
  page: Page, corner: PreviewPoint, file: string, tier: RoadTier, verges = false
) => {
  await placeRoad(page, corner, tier, verges);
  await frames(page, 8);
  if (tier === "dirt") await waitForRoadMaterials(page);
  if (verges) {
    await page.waitForFunction(() => {
      const statistics = (window as any).__roadPreviewLayers?.roadVerges.statistics();
      return Boolean(statistics?.ready && statistics.placements > 0);
    }, null, { timeout: 30_000 });
    await frames(page, 3);
  }
  await page.locator("#view").screenshot({ path: resolve(output, `${file}.png`) });
};

const exportRoads = async (page: Page) => {
  const corner = await findMeadowPatch(page);
  const jobs = vergesOnly
    ? [{ file: "verge-flowers", tier: "dirt" as const, verges: true }]
    : ROAD_TIERS.map(tier => ({ file: tier, tier, verges: false }));
  for (const job of jobs) {
    await captureRoad(page, corner, job.file, job.tier, job.verges);
    await frames(page, 4);
  }
  return jobs.length;
};

/**
 * Chooses a downstream crossing on a mature stretch of river: green banks with no sand or rock,
 * no trees, boulders or animals in the frame, and one span that both bridge kinds plan identically.
 * Source springs and estuary mouths are skipped; the middle course scores best.
 */
const findBridgePlans = (page: Page) => page.evaluate(() => {
  const live = (window as any).__settlement;
  const world = (window as any).__roadPreviewWorld.world;
  const summary = (plan: any) => ({
    end: { x: plan.end.x, z: plan.end.z },
    segments: plan.segments,
    start: { x: plan.start.x, z: plan.start.z },
    tiles: plan.tiles
  });
  const rivers = world.generatedRivers ?? [];
  /** The closest river sample: how far down its course the cell lies and the local bed radius. */
  const courseAt = (x: number, z: number) => {
    let best: any = null;
    for (const river of rivers)
      for (let step = 0; step < river.points.length; step += 1) {
        const point = river.points[step]!;
        const distance = Math.hypot(point.x - x, point.z - z);
        if (best && distance >= best.distance) continue;
        best = { distance, fraction: step / river.mouthStep, radius: river.radius[step]!, step };
      }
    return best;
  };
  const stride = world.cellsX + 1;
  const isWaterCell = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ &&
    world.blocking[z * world.cellsX + x] === 1;
  /** Sea water (farther than 2.5 cells from a river bed) within the frame: the icon stays inland. */
  const seaWithin = (x: number, z: number, radius: number) => {
    for (let cz = Math.floor(z - radius); cz <= Math.ceil(z + radius); cz += 1)
      for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx += 1) {
        if (cx < 0 || cz < 0 || cx >= world.cellsX || cz >= world.cellsZ) continue;
        if (world.blocking[cz * world.cellsX + cx] !== 1) continue;
        if ((world.riverDistance[cz * stride + cx] ?? 0) > 2.5) return true;
      }
    return false;
  };
  /** Ground material shares on the dry banks around a crossing; water cells are skipped. */
  const bankGround = (x: number, z: number, radius: number) => {
    let dirt = 0, grass = 0, rock = 0, samples = 0, sand = 0;
    for (let vz = Math.floor(z - radius); vz <= Math.ceil(z + radius); vz += 1)
      for (let vx = Math.floor(x - radius); vx <= Math.ceil(x + radius); vx += 1) {
        if (vx < 0 || vz < 0 || vx > world.cellsX || vz > world.cellsZ) continue;
        if (Math.hypot(vx - x, vz - z) > radius) continue;
        if (isWaterCell(Math.min(world.cellsX - 1, vx), Math.min(world.cellsZ - 1, vz))) continue;
        const offset = (vz * stride + vx) * 9, weights = world.splat;
        grass += weights[offset]! + weights[offset + 1]! + weights[offset + 2]!;
        dirt += weights[offset + 3]!;
        sand += weights[offset + 4]!;
        rock += weights[offset + 5]!;
        samples += 1;
      }
    return samples ? {
      dirt: dirt / samples / 255, grass: grass / samples / 255,
      rock: rock / samples / 255, sand: sand / samples / 255
    } : null;
  };
  /** Trees and boulders crowd the frame; shrubs, flowers, reeds and pebbles are bank scenery. */
  const coarseProps = new Set([0, 1, 2, 4, 5, 18, 21, 22, 23, 24]);
  const coarsePropWithin = (x: number, z: number, radius: number) => {
    const props = world.props;
    for (let index = 0; index < props.count; index += 1)
      if (coarseProps.has(props.types[index]!) &&
        Math.hypot(props.x[index]! - x, props.z[index]! - z) < radius) return true;
    return false;
  };
  const living = live.animals?.manager?.listLiving?.() ?? [];
  const animalWithin = (x: number, z: number, radius: number) =>
    living.some((animal: any) => Math.hypot(animal.x - x, animal.z - z) < radius);
  const candidates: any[] = [];
  const rejected = { animals: 0, banks: 0, course: 0, props: 0, sea: 0, source: 0, span: 0, water: 0 };
  for (let z = 4; z < world.cellsZ - 4; z += 1)
    for (let x = 4; x < world.cellsX - 4; x += 1) {
      if (!isWaterCell(x, z)) continue;
      rejected.water += 1;
      const course = courseAt(x + .5, z + .5);
      if (!course || course.distance > 2.5) { rejected.course += 1; continue; }
      // The source spring and the estuary flare are not "a proper river" for the card.
      if (course.fraction < .4 || course.fraction > .8) { rejected.source += 1; continue; }
      // The local bed width estimates the deck span the planner will need.
      const span = Math.round(course.radius * 2);
      if (span < 2 || span > 10) { rejected.span += 1; continue; }
      const pointer = { x: x + .5, z: z + .5 };
      if (seaWithin(pointer.x, pointer.z, 12)) { rejected.sea += 1; continue; }
      const banks = bankGround(pointer.x, pointer.z, 8);
      if (!banks || banks.dirt > .32 || banks.grass < .66 || banks.sand > .05 || banks.rock > .05) {
        rejected.banks += 1;
        continue;
      }
      if (coarsePropWithin(pointer.x, pointer.z, 9)) { rejected.props += 1; continue; }
      if (animalWithin(pointer.x, pointer.z, 11)) { rejected.animals += 1; continue; }
      const score = Math.abs(course.fraction - .6) * 8 + (1 - banks.grass) * 3 +
        (banks.dirt + banks.sand + banks.rock) * 8 + Math.abs(span - 5) * .1;
      candidates.push({ banks, course, pointer, score, span });
    }
  candidates.sort((left, right) => left.score - right.score);
  const attempts: any[] = [];
  const solutions: any[] = [];
  const sameSpan = (a: any, b: any) =>
    (a.start.x === b.start.x && a.start.z === b.start.z &&
      a.end.x === b.end.x && a.end.z === b.end.z) ||
    (a.start.x === b.end.x && a.start.z === b.end.z &&
      a.end.x === b.start.x && a.end.z === b.start.z);
  for (const candidate of candidates.slice(0, 40)) {
    const pointer = candidate.pointer;
    const wood = live.simulation.previewBridge(pointer, "wood");
    attempts.push({ fraction: Number(candidate.course.fraction.toFixed(2)), pointer,
      span: candidate.span, tiles: wood.plan?.tiles, wood: wood.plan ? "plan" : wood.reason });
    if (!wood.plan || wood.plan.tiles < 3 || wood.plan.tiles > 12) continue;
    const stone = live.simulation.previewBridge(pointer, "stone");
    if (!stone.plan || stone.plan.tiles !== wood.plan.tiles) continue;
    if (!sameSpan(stone.plan, wood.plan)) continue;
    // Prefer a short, straight span over the score's favourite if it is a long skewed bend.
    const penalty = Math.max(0, wood.plan.tiles - 6) * .9 + Math.max(0, 4 - wood.plan.tiles) * .25;
    solutions.push({ candidate, cost: candidate.score + penalty, stone, wood });
  }
  solutions.sort((left, right) => left.cost - right.cost);
  if (!solutions.length) {
    (window as any).__bridgeReasons = { attempts: attempts.slice(0, 20), candidates: candidates.length,
      rejected, rivers: rivers.map((river: any) => ({ id: river.id, mouthStep: river.mouthStep,
        points: river.points.length })) };
    return null;
  }
  const best = solutions[0]!;
  const chosen = best.candidate;
  return {
    chosen: { banks: chosen.banks, fraction: chosen.course.fraction, pointer: chosen.pointer },
    stone: summary(best.stone.plan), wood: summary(best.wood.plan)
  };
});

/** Puts one bridge span and short bank roads into the road network, centred in the icon camera. */
const placeBridge = (page: Page, plan: RoadPlanRow) => page.evaluate(({ plan, step, zoom }) => {
  const live = (window as any).__settlement;
  if (!(window as any).__roadPreviewFrozen) {
    live.realUpdate = live.simulation.update;
    live.simulation.update = () => {};
    (window as any).__roadPreviewFrozen = true;
  }
  const world = (window as any).__roadPreviewWorld.world;
  const spanX = plan.end.x - plan.start.x, spanZ = plan.end.z - plan.start.z;
  const tier = (plan.segments[0] as any)?.tier ?? "stone";
  /** Dry half-cell steps ahead along an axis: bank roads stay on the grid and off the water. */
  const drySteps = (anchor: any, delta: any) => {
    let cells = 0;
    for (let index = 1; index <= 8; index += 1) {
      const x = anchor.x + delta.x * index, z = anchor.z + delta.z * index;
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) break;
      if (world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)] !== 0) break;
      cells += 1;
    }
    return cells;
  };
  const bankRoad = (anchor: any, outward: number) => {
    const alongX = { x: (spanX >= 0 ? 1 : -1) * outward * step, z: 0 };
    const alongZ = { x: 0, z: (spanZ >= 0 ? 1 : -1) * outward * step };
    const delta = drySteps(anchor, alongX) >= drySteps(anchor, alongZ) ? alongX : alongZ;
    const segments = [];
    let at = { x: anchor.x, z: anchor.z };
    for (let index = 0; index < 8; index += 1) {
      const next = { x: at.x + delta.x, z: at.z + delta.z };
      segments.push({ end: next, start: at, tier });
      at = next;
    }
    return segments;
  };
  const segments = [...plan.segments, ...bankRoad(plan.start, -1), ...bankRoad(plan.end, 1)];
  if (!live.roads.replaceSegments(segments)) throw new Error("Bridge segments refused");
  const camera = (window as any).__roadPreviewWorld.camera;
  camera.tilt = 0;
  camera.yaw = 0;
  live.focusGround((plan.start.x + plan.end.x) / 2, (plan.start.z + plan.end.z) / 2, zoom);
}, { plan, step: roadStep, zoom: bridgeZoom });

const waitForBridge = async (page: Page) => {
  await frames(page, 12);
  await page.waitForFunction(() =>
    Boolean((window as any).__roadPreviewLayers?.bridges.root.children.length),
  null, { timeout: 30_000 });
  await page.waitForTimeout(400);
};

const exportBridges = async (page: Page) => {
  const plans = await findBridgePlans(page);
  if (!plans) console.log("bridge scan", JSON.stringify(await page.evaluate(() =>
    (window as any).__bridgeReasons)));
  assert(plans, "No river crossing accepted for both bridge kinds");
  const chosen = plans.chosen;
  console.log("bridge crossing", JSON.stringify({ banks: chosen.banks, fraction: chosen.fraction,
    pointer: chosen.pointer, tiles: plans.wood.tiles }));
  for (const kind of ["wood", "stone"] as const) {
    await placeBridge(page, plans[kind]);
    await waitForBridge(page);
    await page.locator("#view").screenshot({ path: resolve(output, `bridge-${kind}.png`) });
  }
  return 2;
};

/** The before | after sheet of all nine images, each column at its shipped size. */
const exportSheet = async (browser: Browser) => {
  const source = (folder: string, name: string) =>
    `data:image/png;base64,${readFileSync(resolve(folder, `${name}.png`)).toString("base64")}`;
  const rows = sheetRows.map(name => `<tr><td class="name">${name}</td>` +
    `<td><img src="${source(beforeFolder, name)}"></td>` +
    `<td><img src="${source(output, name)}"></td></tr>`).join("");
  const page = await browser.newPage({ viewport: { height: 900, width: 1000 } });
  try {
    await page.setContent(`<!doctype html><html><head><style>
      body { background: #151815; color: #e7e3d4; font: 13px system-ui, sans-serif; margin: 0; padding: 18px; }
      h1 { font-size: 17px; margin: 0 0 14px; }
      table { border-collapse: collapse; }
      th { color: #c9d2bd; font-weight: 600; padding: 4px 10px 8px; }
      td { padding: 5px 10px; vertical-align: middle; }
      td.name { font-family: ui-monospace, monospace; text-align: right; white-space: nowrap; }
      img { border-radius: 4px; display: block; height: 256px; width: 384px; }
    </style></head><body>
      <h1>Road-tab previews — before | after (real island render)</h1>
      <table><tr><th></th><th>Before</th><th>After</th></tr>${rows}</table>
    </body></html>`, { waitUntil: "load" });
    await page.locator("img").last().waitFor({ state: "visible" });
    await page.screenshot({ fullPage: true, path: resolve(captures, "sheet-v2.png") });
  } finally {
    await page.close();
  }
};

/** The Road tab itself at desktop and 400 px phone widths, showing the regenerated cards. */
const exportRoadTab = async (browser: Browser, url: string) => {
  for (const [label, viewport] of [
    ["desktop", { height: 900, width: 1400 }],
    ["phone", { height: 800, width: 400 }]
  ] as const) {
    const { errors, page } = await openIsland(browser, url, "&size=96&rivers=2&forest=0",
      { hideUi: false, viewport });
    try {
      await page.click("[data-launcher-id=\"build\"]");
      const tab = page.locator("#settlement-buildings-tab-roads");
      await tab.waitFor({ state: "visible", timeout: 60_000 });
      await tab.click();
      const card = page.locator("[data-road=\"verge-flowers\"]");
      await card.waitFor({ state: "visible", timeout: 60_000 });
      await card.scrollIntoViewIfNeeded();
      await frames(page, 12);
      await page.locator(".settlement-ui__picker").screenshot({
        path: resolve(captures, `road-tab-${label}.png`)
      });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
};

const browser = await launchBrowser();
try {
  if (sheetOnly) {
    await exportSheet(browser);
    console.log(`Exported the before/after contact sheet to ${resolve(captures, "sheet-v2.png")}`);
  } else {
    const { server, url } = await startDevServer();
    try {
      if (roadTabOnly) {
        await exportRoadTab(browser, url);
        console.log(`Exported the Road tab captures to ${captures}`);
      } else if (bridgesOnly) {
        const { errors, page } = await openIsland(browser, url,
          "&size=160&rivers=2&forest=0&mountains=2");
        try {
          const count = await exportBridges(page);
          assert.deepEqual(errors, []);
          console.log(`Exported ${count} native bridge previews to ${output}`);
        } finally {
          await page.close();
        }
      } else {
        const { errors, page } = await openIsland(browser, url,
          "&size=96&rivers=0&forest=0&mountains=0");
        try {
          await frames(page, 6);
          const count = await exportRoads(page);
          assert.deepEqual(errors, []);
          console.log(`Exported ${count} native road previews to ${output}`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await server.close();
    }
  }
} finally {
  await browser.close();
}
