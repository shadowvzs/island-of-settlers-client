/**
 * Worker walk / run check: a short trip is walked the whole way, a long trip walks off, runs
 * and walks the last cells. One close-up per gait.
 *   npx tsx tools/bench/worker-run.ts
 * WORKER_RUN_FRAMES=4 saves more frames (review only).
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { openWorkerMap, selectWorker } from "./worker-bench";

const OUTPUT = "../docs/terrain-benchmarks/worker-run-2026-10-06";
const FRAMES = Number(process.env.WORKER_RUN_FRAMES ?? "1");
const MAP = "size=64&seed=42&cache=0&time=day";
const CROP = { height: 360, width: 480 };

/** The first reachable point `from` .. `to` cells away. */
const commandTrip = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([nearest, farthest]) => {
      const worker = window.__worker!;
      const start = worker.getState();
      for (let distance = nearest!; distance <= farthest!; distance++)
        for (let step = 0; step < 32; step++) {
          const angle = (step / 32) * Math.PI * 2;
          const x = start.x + Math.cos(angle) * distance;
          const z = start.z + Math.sin(angle) * distance;
          if (worker.command(x, z)) return { x, z };
        }
      return null;
    },
    [from, to]
  );

const captureWorker = async (page: Page, name: string) => {
  for (let frame = 0; frame < FRAMES; frame++) {
    const point = await page.evaluate(() => window.__worker!.project());
    const suffix = FRAMES > 1 ? `-${frame}` : "";
    await page.screenshot({
      clip: { ...CROP, x: point.x - CROP.width / 2, y: point.y - CROP.height / 2 },
      path: `${OUTPUT}/${name}${suffix}.png`
    });
    await page.waitForTimeout(90);
  }
};

/**
 * Samples the gait until arrival: action, run weight and straight distance left to the spot the
 * worker really walks to (a command onto blocked ground goes to the nearest free spot).
 */
const recordTimeline = (page: Page, goal: { x: number; z: number }) =>
  page.evaluate(
    (commanded) =>
      new Promise<{ action: string; left: number; runBlend: number }[]>((resolve) => {
        const samples: { action: string; left: number; runBlend: number }[] = [];
        let target = window.__worker!.getState().target ?? commanded;
        const timer = setInterval(() => {
          const state = window.__worker!.getState();
          target = state.target ?? target;
          const left = Math.hypot(target.x - state.x, target.z - state.z);
          samples.push({ action: state.action, left, runBlend: state.runBlend });
          if (state.target) return;
          clearInterval(timer);
          resolve(samples);
        }, 50);
      }),
    goal
  );

const checkGaits = async (url: string, view: string) => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { height: 1000, width: 1400 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openWorkerMap(page, url, `${MAP}&view=${view}`);
    await page.waitForTimeout(1500);
    await selectWorker(page);
    const near = await commandTrip(page, 3, 5);
    assert(near, "no reachable short trip");
    const walked = recordTimeline(page, near);
    await page.waitForTimeout(1500);
    await captureWorker(page, "walk");
    assert(
      (await walked).every(({ action }) => action !== "run"),
      "ran a short trip"
    );
    const goal = await commandTrip(page, 14, 24);
    assert(goal, "no reachable long trip");
    const timeline = recordTimeline(page, goal);
    await page.waitForFunction(() => window.__worker!.getState().runBlend === 1);
    await captureWorker(page, "run");
    const samples = await timeline;
    assert(
      samples.some(({ action }) => action === "run"),
      "never ran"
    );
    const arriving = samples.filter(({ left }) => left < 1.5 && left > 0.1);
    assert(
      arriving.every(({ action }) => action !== "run"),
      "ran into the goal"
    );
    assert.deepEqual(errors, []);
    console.log("walked the short trip, ran the long one and walked its end");
  } finally {
    await browser.close();
  }
};

await mkdir(OUTPUT, { recursive: true });
const { server, url } = await startDevServer();
try {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await openWorkerMap(page, url, MAP);
  const start = await page.evaluate(() => window.__worker!.getState());
  await browser.close();
  const view = `${start.x.toFixed(2)},${start.z.toFixed(2)},2.5`;
  await checkGaits(url, view);
  console.log(`map ${MAP}, view ${view}`);
} finally {
  await server.close();
}
