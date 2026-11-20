/**
 * Phone touch input (a 390 x 844 touch phone): a two-finger pinch zooms around the finger
 * midpoint and pans with it, the page itself never zooms, a two-finger tap fires no
 * click, a tap selects the worker, a one-finger drag pans, a long press sends the worker; the top
 * row buttons sit in one row, + / - zoom around the centre (held: on to the limit, disabled
 * there) and the map editor button opens the editor (one screenshot of the row).
 *   npx tsx tools/bench/touch-zoom.ts
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { CDPSession, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { openWorkerMap, WORKER_BENCH_OUTPUT } from "./worker-bench";

const MAP = "size=64&seed=42&cache=0&time=day";
const PHONE = { height: 844, width: 390 };
const MID = { x: 195, y: 470 };
const CENTRE = { x: PHONE.width / 2, y: PHONE.height / 2 };
const TOP_BAR_LABELS = ["Map", "Zoom in", "Zoom out", "Map editor", "Settings"];
const BUTTON_STEP = 1.25;
/** A screen point must stay this close (CSS pixels) to where the gesture keeps it. */
const ANCHOR_TOLERANCE = 4;
const STEPS = 12;

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  height: number;
  width: number;
}

type TouchType = "touchEnd" | "touchMove" | "touchStart";

const touch = (cdp: CDPSession, type: TouchType, points: readonly Point[]) =>
  cdp.send("Input.dispatchTouchEvent", {
    touchPoints: points.map((point, id) => ({ ...point, id })),
    type
  });

const settle = (page: Page) => page.waitForTimeout(250);

/** Two fingers from `from` to `to` (pairs of points) in STEPS moves, then lifted. */
const twoFingerGesture = async (
  cdp: CDPSession,
  from: readonly [Point, Point],
  to: readonly [Point, Point]
) => {
  await touch(cdp, "touchStart", from);
  for (let step = 1; step <= STEPS; step++) {
    const share = step / STEPS;
    const points = from.map((start, index) => ({
      x: start.x + (to[index]!.x - start.x) * share,
      y: start.y + (to[index]!.y - start.y) * share
    }));
    await touch(cdp, "touchMove", points);
  }
  await touch(cdp, "touchEnd", []);
};

const spread = (centre: Point, half: number): [Point, Point] => [
  { x: centre.x - half, y: centre.y },
  { x: centre.x + half, y: centre.y }
];

/** The ground under a viewport point (the renderer's own picking). */
const pickGround = async (page: Page, point: Point) => {
  const ground = await page.evaluate((p) => window.__worker!.pickGround(p.x, p.y), point);
  assert(ground, "the gesture point must be on the island");
  return ground;
};

const projectGround = (page: Page, ground: { x: number; z: number }) =>
  page.evaluate((g) => window.__worker!.projectGround(g.x, g.z), ground);

/** Screen distance of two ground points one cell apart: grows with the zoom. */
const measureScale = async (page: Page, ground: { x: number; z: number }) => {
  const a = await projectGround(page, ground);
  const b = await projectGround(page, { x: ground.x + 1, z: ground.z });
  return Math.hypot(b.x - a.x, b.y - a.y);
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const readPageScale = (page: Page) => page.evaluate(() => window.visualViewport?.scale ?? 1);

/** Pinch out around MID: zoom about 2x, the ground under MID stays there, no page zoom. */
const checkPinchZoom = async (page: Page, cdp: CDPSession) => {
  const anchor = await pickGround(page, MID);
  const scaleBefore = await measureScale(page, anchor);
  await twoFingerGesture(cdp, spread(MID, 50), spread(MID, 100));
  await settle(page);
  const zoom = (await measureScale(page, anchor)) / scaleBefore;
  const drift = distance(await projectGround(page, anchor), MID);
  assert(zoom > 1.8 && zoom < 2.2, `pinch must zoom about 2x (got ${zoom.toFixed(2)})`);
  assert(drift < ANCHOR_TOLERANCE, `the pinched ground must stay put (moved ${drift}px)`);
  assert.equal(await readPageScale(page), 1, "the page must not zoom");
  return { drift, zoom };
};

/** Two fingers moved together: pans, the ground follows the midpoint, the zoom stays. */
const checkTwoFingerPan = async (page: Page, cdp: CDPSession) => {
  const anchor = await pickGround(page, MID);
  const scaleBefore = await measureScale(page, anchor);
  const target = { x: MID.x + 40, y: MID.y - 60 };
  await twoFingerGesture(cdp, spread(MID, 60), spread(target, 60));
  await settle(page);
  const zoom = (await measureScale(page, anchor)) / scaleBefore;
  const drift = distance(await projectGround(page, anchor), target);
  assert(Math.abs(zoom - 1) < 0.02, `a two-finger pan must not zoom (got ${zoom})`);
  assert(drift < ANCHOR_TOLERANCE, `the ground must follow the fingers (off by ${drift}px)`);
  return { drift };
};

const isSelected = (page: Page) => page.evaluate(() => window.__worker!.getState().selected);

/** A tap on the worker selects it; a quick two-finger tap elsewhere is no click. */
const checkTaps = async (page: Page, cdp: CDPSession) => {
  const worker = await page.evaluate(() => window.__worker!.project());
  await touch(cdp, "touchStart", [worker]);
  await touch(cdp, "touchEnd", []);
  await page.waitForFunction(() => window.__worker!.getState().selected, undefined, {
    timeout: 2000
  });
  const empty = { x: worker.x, y: worker.y + 150 };
  await touch(cdp, "touchStart", spread(empty, 30));
  await touch(cdp, "touchEnd", []);
  await settle(page);
  assert(await isSelected(page), "a two-finger tap must not clear the selection");
};

/** One finger drag pans and keeps the selection (no tap). */
const checkOneFingerPan = async (page: Page, cdp: CDPSession) => {
  const before = await page.evaluate(() => window.__worker!.project());
  const start = { x: 120, y: 650 };
  await touch(cdp, "touchStart", [start]);
  for (let step = 1; step <= STEPS; step++) {
    await touch(cdp, "touchMove", [{ x: start.x + step * 6, y: start.y - step * 4 }]);
  }
  await touch(cdp, "touchEnd", []);
  await settle(page);
  const after = await page.evaluate(() => window.__worker!.project());
  assert(distance(before, after) > 50, "a one-finger drag must pan");
  assert(await isSelected(page), "a drag must not clear the selection");
};

/** A long press on the ground sends the selected worker there (the touch right click). */
const checkLongPress = async (page: Page, cdp: CDPSession) => {
  const state = await page.evaluate(() => window.__worker!.getState());
  for (let step = 0; step < 12; step++) {
    const angle = (step / 12) * Math.PI * 2;
    const goal = { x: state.x + Math.cos(angle) * 3, z: state.z + Math.sin(angle) * 3 };
    const point = await projectGround(page, goal);
    await touch(cdp, "touchStart", [point]);
    await page.waitForTimeout(800);
    await touch(cdp, "touchEnd", []);
    if ((await page.evaluate(() => window.__worker!.getState().target)) !== null) return step;
  }
  assert.fail("a long press must send the selected worker");
};

const tapAt = async (cdp: CDPSession, point: Point, holdMs = 0) => {
  await touch(cdp, "touchStart", [point]);
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
  await touch(cdp, "touchEnd", []);
};

/** The top row buttons in order: all visible on one row inside the phone screen. */
const readTopBar = async (page: Page) => {
  const boxes: Box[] = [];
  for (const label of TOP_BAR_LABELS) {
    const box = await page.getByRole("button", { exact: true, name: label }).boundingBox();
    assert(box, `${label} button must be visible`);
    boxes.push(box);
  }
  assert(
    boxes.every((box) => Math.abs(box.y - boxes[0]!.y) < 1),
    "the buttons share one row"
  );
  assert(
    boxes.every((box, index) => index === 0 || box.x > boxes[index - 1]!.x),
    "row order"
  );
  assert(
    boxes.every((box) => box.x >= 0 && box.x + box.width <= PHONE.width),
    "inside the screen"
  );
  const centreOf = (box: Box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  });
  return Object.fromEntries(TOP_BAR_LABELS.map((label, index) => [label, centreOf(boxes[index]!)]));
};

/** Tapping + / -: one step around the screen centre; holding +: on to the limit, disabled. */
const checkZoomButtons = async (page: Page, cdp: CDPSession, row: Record<string, Point>) => {
  const anchor = await pickGround(page, CENTRE);
  const scale = await measureScale(page, anchor);
  await tapAt(cdp, row["Zoom in"]!);
  await settle(page);
  const zoomIn = (await measureScale(page, anchor)) / scale;
  const drift = distance(await projectGround(page, anchor), CENTRE);
  assert(Math.abs(zoomIn - BUTTON_STEP) < 0.02, `+ must zoom one step (got ${zoomIn})`);
  assert(drift < ANCHOR_TOLERANCE, `+ must zoom around the centre (moved ${drift}px)`);
  await tapAt(cdp, row["Zoom out"]!);
  await settle(page);
  const zoomOut = (await measureScale(page, anchor)) / scale;
  assert(Math.abs(zoomOut - 1) < 0.02, `- must zoom one step back (got ${zoomOut})`);
  const zoomInButton = page.getByRole("button", { exact: true, name: "Zoom in" });
  await tapAt(cdp, row["Zoom in"]!, 2500);
  await settle(page);
  assert(await zoomInButton.isDisabled(), "+ must look disabled at the zoom limit");
  const held = (await measureScale(page, anchor)) / scale;
  for (let step = 0; step < 5; step++) await tapAt(cdp, row["Zoom out"]!);
  await settle(page);
  assert(await zoomInButton.isEnabled(), "+ must be enabled again below the limit");
  return { drift, held, zoomIn, zoomOut };
};

/** The map editor button opens the editor and shows pressed. */
const checkEditorButton = async (page: Page, cdp: CDPSession, row: Record<string, Point>) => {
  const button = page.getByRole("button", { exact: true, name: "Map editor" });
  const editor = page.locator(".map-editor");
  assert(await editor.isHidden(), "the editor starts hidden");
  await tapAt(cdp, row["Map editor"]!);
  await settle(page);
  assert(await editor.isVisible(), "the editor button must open the editor");
  assert.equal(await button.getAttribute("aria-pressed"), "true");
};

const closeEditor = async (page: Page, cdp: CDPSession, row: Record<string, Point>) => {
  await tapAt(cdp, row["Map editor"]!);
  await settle(page);
  assert(await page.locator(".map-editor").isHidden(), "a second tap closes the editor");
};

const checkTopBar = async (page: Page, cdp: CDPSession) => {
  const row = await readTopBar(page);
  const zoom = await checkZoomButtons(page, cdp, row);
  await checkEditorButton(page, cdp, row);
  await page.screenshot({
    clip: { height: 120, width: PHONE.width, x: 0, y: 0 },
    path: `${WORKER_BENCH_OUTPUT}/top-bar-phone.png`
  });
  await closeEditor(page, cdp, row);
  return zoom;
};

const checkTouchInput = async (page: Page, cdp: CDPSession, url: string) => {
  await openWorkerMap(page, url, MAP);
  await page.waitForTimeout(1000);
  const pinch = await checkPinchZoom(page, cdp);
  const pan = await checkTwoFingerPan(page, cdp);
  await checkTaps(page, cdp);
  await checkOneFingerPan(page, cdp);
  const longPressTries = await checkLongPress(page, cdp);
  const topBar = await checkTopBar(page, cdp);
  return { longPressTries: longPressTries + 1, pan, pinch, topBar };
};

await mkdir(WORKER_BENCH_OUTPUT, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
let result;
try {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    viewport: PHONE
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  result = await checkTouchInput(page, cdp, url);
  assert.deepEqual(errors, [], "page errors");
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
await writeFile(
  `${WORKER_BENCH_OUTPUT}/touch-zoom-validation.json`,
  JSON.stringify(result, null, 2)
);
console.log(JSON.stringify(result, null, 2));
