/**
 * Worker controls: select, right-click route, arrival, deselect and live fog.
 *   npx tsx tools/bench/worker-controls.ts
 */
import assert from "node:assert/strict";

import { openWorkerMap, runWorkerBench, WORKER_BENCH_OUTPUT } from "./worker-bench";

await runWorkerBench("map-controls", async ({ errors, page, url }) => {
  await openWorkerMap(page, url, "size=64&seed=42&cache=0&time=day");
  await page.waitForTimeout(1000);
  const initial = await page.evaluate(() => window.__worker!.getState());
  const viewport = await page.locator("#viewport").boundingBox();
  assert(viewport);
  const point = await page.evaluate(() => window.__worker!.project());
  await page.mouse.click(point.x + viewport.x, point.y + viewport.y);
  await page.waitForFunction(() => window.__worker!.getState().selected);
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/map-selected.png` });
  const fogBefore = await page.evaluate(() => window.__worker!.fogStats());
  let goal: { x: number; z: number } | undefined;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1]
  ]) {
    const target = { x: initial.x + dx!, z: initial.z + dz! };
    const p = await page.evaluate((t) => window.__worker!.projectGround(t.x, t.z), target);
    await page.mouse.click(p.x + viewport.x, p.y + viewport.y, { button: "right" });
    const state = await page.evaluate(() => window.__worker!.getState());
    if (state.target) {
      goal = target;
      break;
    }
  }
  assert(goal, "right-click must accept a nearby land destination");
  await page.waitForFunction(() => window.__worker!.getState().action === "walk");
  await page.waitForFunction(() => window.__worker!.getState().target === null, undefined, {
    timeout: 15000
  });
  const arrived = await page.evaluate(() => window.__worker!.getState());
  assert(
    Math.hypot(arrived.x - goal.x, arrived.z - goal.z) < 0.08,
    "must stop at the clicked ground point"
  );
  assert(arrived.selected);
  assert.equal(arrived.action, "idle_breathe");
  const fogAfter = await page.evaluate(() => window.__worker!.fogStats());
  assert(fogAfter.revision > fogBefore.revision);
  assert.equal(fogAfter.sightRadius, 12);
  assert.equal(
    await page.evaluate(() => {
      const s = window.__worker!.getState();
      return window.__worker!.fogAt(s.x, s.z);
    }),
    2
  );
  const blank = await page.evaluate(() => {
    const p = window.__worker!.project();
    return { x: p.x + 170, y: p.y + 100 };
  });
  await page.mouse.click(blank.x + viewport.x, blank.y + viewport.y);
  assert.equal((await page.evaluate(() => window.__worker!.getState())).selected, false);
  await page.mouse.click(blank.x + viewport.x, blank.y + viewport.y, { button: "right" });
  assert.equal((await page.evaluate(() => window.__worker!.getState())).target, null);
  assert.deepEqual(errors, []);
  console.log("select, highlight, right-click route, arrival, deselect and live fog passed");
  return { arrived, errors, fogAfter, fogBefore, initial };
});
