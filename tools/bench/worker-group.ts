/**
 * Worker group: Shift + drag box-selects the starting group without panning,
 * right click sends it in a loose formation, a plain drag still pans, Shift + click toggles.
 * Screenshots: the box, the walking group and the group after arrival.
 *   npx tsx tools/bench/worker-group.ts
 */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { openWorkerMap, runWorkerBench, WORKER_BENCH_OUTPUT } from "./worker-bench";

const MAP = "size=64&seed=42&cache=0&time=day";
const BOX_MARGIN = 45;
const ZOOM_WHEEL = -600;

const readStates = (page: Page) => page.evaluate(() => window.__workers!.getStates());

const projectAll = (page: Page) =>
  page.evaluate(() =>
    window.__workers!.getStates().map((_, index) => window.__workers!.project(index))
  );

/** Screen box around every worker of the group, with a margin. */
const boxAroundGroup = async (page: Page) => {
  const points = await projectAll(page);
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    bottom: Math.max(...ys) + BOX_MARGIN,
    left: Math.min(...xs) - BOX_MARGIN,
    right: Math.max(...xs) + BOX_MARGIN,
    top: Math.min(...ys) - BOX_MARGIN
  };
};

const zoomOnGroup = async (page: Page) => {
  const box = await boxAroundGroup(page);
  await page.mouse.move((box.left + box.right) / 2, (box.top + box.bottom) / 2);
  await page.mouse.wheel(0, ZOOM_WHEEL);
  await page.waitForTimeout(600);
};

/** Shift + drag over the group; screenshot while the box is drawn. */
const boxSelectGroup = async (page: Page) => {
  const box = await boxAroundGroup(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.mouse.move(box.right, box.bottom, { steps: 10 });
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/group-box.png` });
  await page.mouse.up();
  await page.keyboard.up("Shift");
};

/** Right clicks ground points around the group until the group accepts one. */
const commandGroup = async (page: Page) => {
  const states = await readStates(page);
  const centerX = states.reduce((sum, state) => sum + state.x, 0) / states.length;
  const centerZ = states.reduce((sum, state) => sum + state.z, 0) / states.length;
  for (let step = 0; step < 16; step++) {
    const angle = (step / 16) * Math.PI * 2;
    const goal = { x: centerX + Math.cos(angle) * 5, z: centerZ + Math.sin(angle) * 5 };
    const point = await page.evaluate((g) => window.__worker!.projectGround(g.x, g.z), goal);
    await page.mouse.click(point.x, point.y, { button: "right" });
    const moving = (await readStates(page)).filter((state) => state.target);
    if (moving.length > 0) return goal;
  }
  return null;
};

const minimumSpacing = (points: readonly { x: number; z: number }[]) => {
  let minimum = Infinity;
  points.forEach((a, index) =>
    points.slice(index + 1).forEach((b) => {
      minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.z - b.z));
    })
  );
  return minimum;
};

/** A plain left drag pans the camera and keeps the selection. */
const checkPlainDragPans = async (page: Page) => {
  const before = (await projectAll(page))[0]!;
  await page.mouse.move(200, 800);
  await page.mouse.down();
  await page.mouse.move(320, 760, { steps: 6 });
  await page.mouse.up();
  const after = (await projectAll(page))[0]!;
  assert(Math.hypot(after.x - before.x, after.y - before.y) > 50, "drag must pan");
  assert((await readStates(page)).every((state) => state.selected));
};

await runWorkerBench("map-group", async ({ errors, page, url }) => {
  await openWorkerMap(page, url, MAP);
  await page.waitForTimeout(1000);
  const initial = await readStates(page);
  assert.equal(initial.length, 5, "five workers at the start");
  assert.equal(new Set(initial.map(({ nation }) => nation)).size, 1, "one nation");
  await zoomOnGroup(page);
  const anchor = (await projectAll(page))[0]!;
  await boxSelectGroup(page);
  const anchorAfter = (await projectAll(page))[0]!;
  assert(Math.hypot(anchorAfter.x - anchor.x, anchorAfter.y - anchor.y) < 1, "Shift drag panned");
  assert(
    (await readStates(page)).every((state) => state.selected),
    "box selects all"
  );
  const goal = await commandGroup(page);
  assert(goal, "the group must accept a nearby destination");
  const targets = (await readStates(page)).map((state) => state.target!);
  assert(targets.every(Boolean), "every selected worker moves");
  assert(minimumSpacing(targets) > 0.7, "formation slots are spread");
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/group-walking.png` });
  await page.waitForFunction(
    () => window.__workers!.getStates().every((state) => state.target === null),
    undefined,
    { timeout: 30000 }
  );
  const arrived = await readStates(page);
  assert(minimumSpacing(arrived) > 0.6, "the group arrives spread out");
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/group-arrived.png` });
  await checkPlainDragPans(page);
  await page.mouse.click(60, 960);
  assert(
    (await readStates(page)).every((state) => !state.selected),
    "empty click deselects"
  );
  const first = (await projectAll(page))[0]!;
  await page.keyboard.down("Shift");
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up("Shift");
  const toggled = (await readStates(page)).map((state) => state.selected);
  assert.equal(toggled.filter(Boolean).length, 1, "Shift click toggles one worker");
  assert.deepEqual(errors, []);
  console.log("box select, formation command, drag pan and Shift click passed");
  return { arrived, errors, goal, initial, targets };
});
