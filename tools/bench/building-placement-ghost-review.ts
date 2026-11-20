import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Live review of building placement (cursor ghost + faint preview ghosts on valid plots) on the
 * largest island, at High and Minimal: scan cost, preview count, triangles and frame time per
 * building, the cost of panning (repacks), the cost of hovering from plot to plot (the near-real
 * ghost with its signpost and planned road), clicking a preview to build there, the "no space"
 * notice, screenshots, and touch placement on a phone (first tap pins, second tap builds).
 * Run: npx tsx tools/bench/building-placement-ghost-review.ts
 */
/** The game repo's main checkout (also from a worktree), which contains the resources folder. */
const gameRoot = dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { encoding: "utf8" }).trim());
const output = resolve(gameRoot, "resources/settlement-previews/placement-hover");
mkdirSync(output, { recursive: true });
const ISLAND = "seed=123&size=256&reveal=1";
/** Woodcutter 4×4, Storehouse 5×5, Sawmill 6×5, Mill 5×4, Farm 6×6, Granite mine 5×4. */
const MEASURED_TYPES = [17, 29, 33, 31, 37, 10];

const openGame = async (page: Page, url: string, quality: string) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log("[pageerror]", error.message); });
  await page.addInitScript("window.__name = (value) => value;");
  await page.route("**/src/app/main.ts", async (route) => {
    const response = await route.fetch(), text = await response.text();
    await route.fulfill({ response, body: text.replace("window.__islandReady = true",
      "window.__placementReview = { buildOverlay, camera, renderer }; window.__islandReady = true") });
  });
  await page.goto(`${url}?quality=${quality}&${ISLAND}`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(3000); // Startup streaming and shader compiles settle first.
  await page.evaluate(() => {
    const settlement = (window as any).__settlement, messages: string[] = [];
    for (const name of ["message", "notice"]) {
      const original = settlement[name];
      settlement[name] = (text: string, ...rest: unknown[]) => { messages.push(text); return original(text, ...rest); };
    }
    Object.assign((window as any).__placementReview, { messages });
  });
  return errors;
};

/** Centres the camera on the headquarters at a gameplay zoom. */
const frameHeadquarters = (page: Page, zoom: number) => page.evaluate((zoom) => {
  const { camera } = (window as any).__placementReview, hq = (window as any).__settlement.simulation.headquarters;
  Object.assign(camera, { centerX: hq.x + 4, centerZ: hq.z + 6, yaw: 0, zoom });
}, zoom);

/**
 * Per building: scan frames, then 90 frames with the previews shown (count, triangles, frame
 * times), then 90 frames panning the camera (every frame repacks) against a baseline without a
 * selection.
 */
const measure = (page: Page) => page.evaluate(async (types) => {
  const { buildOverlay, camera, renderer } = (window as any).__placementReview;
  const { controls } = (window as any).__settlement;
  const nextFrame = () => new Promise<number>((done) => requestAnimationFrame(done));
  const frameTimes = async (frames: number, step?: (frame: number) => void) => {
    const times: number[] = [];
    let last = await nextFrame();
    for (let frame = 0; frame < frames; frame++) {
      step?.(frame);
      const now = await nextFrame();
      times.push(now - last); last = now;
    }
    times.sort((a, b) => a - b);
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    return { averageMs: Math.round(average * 10) / 10, p95Ms: Math.round(times[Math.floor(frames * 0.95)]! * 10) / 10 };
  };
  const startX = camera.centerX;
  const pan = (frame: number) => { camera.centerX = startX + Math.sin(frame / 12) * 12; };
  const baseline = await frameTimes(90);
  const panBaseline = await frameTimes(90, pan);
  camera.centerX = startX;
  const results = [];
  for (const typeId of types) {
    controls.selectBuilding(typeId);
    let scanFrames = 0;
    const started = performance.now();
    while (buildOverlay.isScanning() || scanFrames < 2) { await nextFrame(); scanFrames++; }
    const scanMs = Math.round(performance.now() - started);
    await nextFrame(); await nextFrame();
    const shown = await frameTimes(90);
    const previews = buildOverlay.placementPreviews()?.count ?? 0;
    const triangles = renderer.getStats().details.placementPreviewTriangles;
    const panning = await frameTimes(90, pan);
    camera.centerX = startX;
    results.push({ panning, previews, scanFrames, scanMs, shown, triangles, typeId });
  }
  controls.cancel();
  return { baseline, panBaseline, results };
}, MEASURED_TYPES);

/** A valid plot for the building near the headquarters (also centres the camera there). */
const findPlot = (page: Page, typeId: number) => page.evaluate((typeId) => {
  const settlement = (window as any).__settlement, { camera } = (window as any).__placementReview;
  const hq = settlement.simulation.headquarters;
  for (let ring = 7; ring < 40; ring++)
    for (let step = 0; step < ring * 8; step++) {
      const angle = (step / (ring * 8)) * Math.PI * 2;
      const x = Math.round(hq.x + Math.cos(angle) * ring), z = Math.round(hq.z + Math.sin(angle) * ring);
      if (settlement.simulation.validatePlacement(typeId, x, z, 0) !== null) continue;
      Object.assign(camera, { centerX: x, centerZ: z });
      return { x, z };
    }
  throw new Error("No valid plot near the headquarters");
}, typeId);

const screenPoint = (page: Page, plot: { x: number; z: number }) =>
  page.evaluate((plot) => (window as any).__settlement.projectGround(plot.x, plot.z), plot);

const ghost = (page: Page) => page.evaluate(() => (window as any).__settlement.controls.ghost());

/** Selects a building and waits until its scan finished and its previews are packed. */
const selectAndSettle = async (page: Page, typeId: number) => {
  await page.evaluate((typeId) => (window as any).__settlement.controls.selectBuilding(typeId), typeId);
  await page.waitForFunction(() => !(window as any).__placementReview.buildOverlay.isScanning());
  await page.waitForTimeout(400);
};

/** Plot centre of a preview ghost away from the cursor (the n-th of the frame). */
const previewPlot = (page: Page, index: number) => page.evaluate((index) => {
  const frame = (window as any).__placementReview.buildOverlay.placementPreviews();
  if (!frame || frame.count <= index) return null;
  return { x: frame.positions[index * 3], y: frame.positions[index * 3 + 1], z: frame.positions[index * 3 + 2] };
}, index);

/** Clicking a preview ghost's roof (not its ground) builds exactly there. */
const clickPreview = async (page: Page) => {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const target = await previewPlot(page, 3);
  assert.ok(target, "a preview ghost to click");
  const roof = await page.evaluate((target) => (window as any).__settlement.project(target.x, target.y + 2, target.z), target);
  await page.mouse.move(roof.x, roof.y);
  await page.waitForTimeout(300);
  const snapped = await ghost(page);
  assert.equal(snapped?.x, target.x, "the cursor ghost snaps onto the hovered preview");
  assert.equal(snapped?.z, target.z);
  await page.mouse.click(roof.x, roof.y);
  await page.waitForTimeout(300);
  const placed = await page.evaluate(() => (window as any).__settlement.simulation.buildings().at(-1));
  assert.equal(placed.x, target.x, "the building is placed on the clicked preview");
  assert.equal(placed.z, target.z);
};

/** A building that fits nowhere (an unsurveyed mine, or the whole territory blocked) tells once. */
const reviewNoSpace = async (page: Page) => {
  const result = await page.evaluate(async () => {
    const { buildOverlay, messages } = (window as any).__placementReview;
    const { controls, simulation } = (window as any).__settlement;
    const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
    const earlier = messages.filter((text: string) => text.startsWith("No space for"));
    const notices = () => messages.filter((text: string) => text.startsWith("No space for")).slice(earlier.length);
    const owned = simulation.territory().owned as Uint8Array, saved = owned.slice();
    owned.fill(0); // No territory: nothing can fit.
    controls.selectBuilding(29);
    for (let frame = 0; frame < 5 || buildOverlay.isScanning(); frame++) await nextFrame();
    const first = notices().length;
    for (let frame = 0; frame < 30; frame++) await nextFrame();
    const repeated = notices().length;
    controls.cancel();
    owned.set(saved);
    return { earlier, first, notice: notices().at(-1), repeated };
  });
  assert.equal(result.first, 1, "the notice shows once the scan found nothing");
  assert.equal(result.repeated, 1, "only once per selection");
  assert.equal(result.notice, "No space for Storehouse in your territory");
  return result;
};

/**
 * Hovers every preview ghost in turn (pointer moves on the canvas): the time of each move's
 * placement update (validation + road plan of a new plot) and of a repeated move on the same plot.
 */
const measureHover = (page: Page) => page.evaluate(async () => {
  const { buildOverlay } = (window as any).__placementReview;
  const settlement = (window as any).__settlement, canvas = document.querySelector("canvas")!;
  const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
  const frame = buildOverlay.placementPreviews();
  const positions = Array.from({ length: frame?.count ?? 0 }, (_, index) =>
    ({ x: frame.positions[index * 3], z: frame.positions[index * 3 + 2] }));
  const move = (point: { x: number; z: number }) => {
    const screen = settlement.projectGround(point.x, point.z), bounds = canvas.getBoundingClientRect();
    const started = performance.now();
    canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: bounds.left + screen.x,
      clientY: bounds.top + screen.y, pointerType: "mouse" }));
    return performance.now() - started;
  };
  const fresh: number[] = [], repeated: number[] = [];
  let roads = 0;
  for (const point of positions) {
    fresh.push(move(point));
    repeated.push(move(point));
    if (settlement.controls.ghost()?.road?.length) roads++;
    await nextFrame();
  }
  const stats = (times: number[]) => {
    const sorted = [...times].sort((a, b) => a - b);
    const average = sorted.reduce((sum, time) => sum + time, 0) / Math.max(1, sorted.length);
    return { averageMs: Math.round(average * 100) / 100, maxMs: Math.round((sorted.at(-1) ?? 0) * 100) / 100 };
  };
  return { fresh: stats(fresh), hovered: positions.length, repeated: stats(repeated), withRoad: roads };
});

const reviewDesktop = async (page: Page, quality: string) => {
  await frameHeadquarters(page, 1.3);
  const plot = await findPlot(page, 17);
  await selectAndSettle(page, 17);
  const point = await screenPoint(page, plot);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(500);
  const hovered = await ghost(page);
  assert.equal(hovered?.valid, true, "the cursor ghost is near real on a valid plot");
  assert.ok(Array.isArray(hovered?.road), "a valid plot plans its road connection");
  await page.screenshot({ path: resolve(output, `${quality}-woodcutter.png`) });
  await page.evaluate(() => Object.assign((window as any).__placementReview.camera, { zoom: 2.4 }));
  await page.waitForTimeout(600);
  const closePoint = await screenPoint(page, plot);
  await page.mouse.move(closePoint.x + 1, closePoint.y);
  await page.mouse.move(closePoint.x, closePoint.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, `${quality}-woodcutter-close.png`) });
  await frameHeadquarters(page, 1.3);
  await page.waitForTimeout(400);
  const hover = await measureHover(page);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(500);
  await page.keyboard.press("r");
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(output, `${quality}-woodcutter-rotated.png`) });
  await page.keyboard.press("Escape");
  await frameHeadquarters(page, 1.3);
  await selectAndSettle(page, 33);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, `${quality}-sawmill.png`) });
  await page.evaluate(() => Object.assign((window as any).__placementReview.camera, { zoom: 2.4 }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(output, `${quality}-sawmill-close.png`) });
  await page.evaluate(() => Object.assign((window as any).__placementReview.camera, { zoom: 0.8 }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(output, `${quality}-sawmill-far.png`) });
  await frameHeadquarters(page, 1.3);
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => (window as any).__settlement.simulation.buildings().length);
  await clickPreview(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, `${quality}-after-click.png`) });
  await page.keyboard.press("Escape");
  const after = await page.evaluate(() => (window as any).__settlement.simulation.buildings().length);
  assert.equal(after, before + 1);
  return { clicked: true, hover, noSpace: await reviewNoSpace(page) };
};

const reviewTouch = async (url: string) => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  try {
    const errors = await openGame(page, url, "minimal");
    await frameHeadquarters(page, 1.2);
    await selectAndSettle(page, 17);
    await page.screenshot({ path: resolve(output, "phone-previews.png") });
    const target = await previewPlot(page, 1);
    assert.ok(target, "a preview ghost on the phone");
    const point = await screenPoint(page, target);
    const count = () => page.evaluate(() => (window as any).__settlement.simulation.buildings().length);
    const before = await count();
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForTimeout(500);
    const pinned = await ghost(page);
    assert.ok(pinned?.valid, "the first tap pins the near-real ghost");
    assert.ok(Array.isArray(pinned.road), "the pinned plot plans its road connection");
    assert.equal(await count(), before, "the first tap must not build");
    await page.screenshot({ path: resolve(output, "phone-pinned.png") });
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForTimeout(500);
    assert.equal(await count(), before + 1, "the second tap on the plot builds");
    await page.screenshot({ path: resolve(output, "phone-placed.png") });
    assert.deepEqual(errors, []);
    return { before, after: await count(), pinnedRoadPoints: pinned.road.length };
  } finally {
    await browser.close();
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: Record<string, unknown> = {};
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = await openGame(page, url, quality);
    await frameHeadquarters(page, 1.3);
    const performance = await measure(page);
    const desktop = await reviewDesktop(page, quality);
    assert.deepEqual(errors, []);
    reports[quality] = { desktop, performance };
    await page.close();
  }
  reports.touch = await reviewTouch(url);
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
  await server.close();
}
