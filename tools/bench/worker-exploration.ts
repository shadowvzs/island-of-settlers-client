/**
 * Worker exploration: walking into fogged ground reveals it.
 *   npx tsx tools/bench/worker-exploration.ts
 */
import assert from "node:assert/strict";

import { openWorkerMap, runWorkerBench, WORKER_BENCH_OUTPUT } from "./worker-bench";

/** Fog of war is off by default (Settings, stored): this check needs it on. */
const FOG_OF_WAR_KEY = "island-of-settlers.fog-of-war";

await runWorkerBench("map-exploration", async ({ errors, page, url }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), FOG_OF_WAR_KEY);
  await openWorkerMap(
    page,
    url,
    "size=128&seed=42&landform=peninsula&forest=0&mountains=0&rivers=0&cache=0&time=day"
  );
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".stats-overlay");
    if (overlay) overlay.hidden = true;
  });
  const viewport = await page.locator("#viewport").boundingBox();
  assert(viewport);
  const point = await page.evaluate(() => window.__worker!.project());
  await page.mouse.click(point.x + viewport.x, point.y + viewport.y);
  assert((await page.evaluate(() => window.__worker!.getState())).selected);
  const before = await page.evaluate(() => window.__worker!.fogStats());
  console.log("initial sight", before);
  // Mouse commands are covered by worker-controls. Here use the same command
  // path to find the nearest reachable destination outside initial visibility.
  const goal = await page.evaluate(() => {
    const worker = window.__worker!,
      initial = worker.getState();
    for (let distance = 2; distance <= 24; distance += 1) {
      for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        const x = initial.x + Math.cos(angle) * distance;
        const z = initial.z + Math.sin(angle) * distance;
        const fog = worker.fogAt(x, z);
        if (fog < 2 && worker.command(x, z)) return { x, z, fog, distance };
      }
    }
    return null;
  });
  assert(goal, "the test island must have reachable fogged ground");
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/map-exploration-before.png` });
  await page.waitForFunction(() => window.__worker!.getState().target === null, undefined, {
    timeout: 60000
  });
  const after = await page.evaluate(() => window.__worker!.fogStats());
  const fogAtGoal = await page.evaluate((g) => window.__worker!.fogAt(g.x, g.z), goal);
  assert.equal(fogAtGoal, 2, "arriving must reveal previously fogged ground");
  assert(after.visible > before.visible, "exploration must expand visible terrain");
  assert(after.revision > before.revision);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/map-exploration-after.png` });
  console.log("moved into fogged ground and revealed it");
  return { after, before, errors, fogAtGoal, goal };
});
