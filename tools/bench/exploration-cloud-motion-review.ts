import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type BrowserEngine, launchEngine, startDevServer } from "./browser";
import type { createSkyReview as SkyReviewFactory } from "./exploration-sky-review-scene";
import { resourcesPath } from "./resources-path";

const output = resolve(process.env.OUTPUT ?? resourcesPath("project-reviews", "cloud-motion-2026-10-24"));
mkdirSync(output, { recursive: true });
const engine = (process.env.ENGINE ?? "chromium") as BrowserEngine;
const { server, url } = await startDevServer();
const browser = await launchEngine(engine);
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/cloud-motion.html", route => route.fulfill({
    body: "<!doctype html><html><body></body></html>", contentType: "text/html"
  }));
  await page.goto(`${url}cloud-motion.html`);
  const report = await page.evaluate(async () => {
    const path = "/tools/bench/exploration-sky-review-scene.ts";
    const { createSkyReview } = await import(/* @vite-ignore */ path) as { createSkyReview: typeof SkyReviewFactory };
    const review = createSkyReview();
    const results = [];
    for (const detail of [3, 1]) {
      review.set({ cover: .52, daylight: 1, detail, fov: 80, pitch: Math.PI / 2,
        sun: [.5, .6, -.5], yaw: 0 });
      const steady = review.motion([0, 1, 2, 3, 4, 5].map(time => ({ time, windX: .8, windZ: .35 })));
      // A changing wind that cancels wind*time exactly. Both wind components remain positive.
      const cancelling = review.motion([1000, 1001, 1002, 1003, 1004].map(time => ({
        time, windX: 1.2 * 1000 / time, windZ: .525 * 1000 / time
      })));
      results.push({ detail, steady, cancelling });
    }
    return { results, lifecycle: review.lifecycle() };
  });
  writeFileSync(resolve(output, `${engine}-report.json`), `${JSON.stringify({ engine, errors, ...report }, null, 2)}\n`);
  assert.equal(errors.length, 0, errors.join("\n"));
  if (process.env.BASELINE !== "1")
    assert(report.results.every(row => row.cancelling.slice(1).every(sample => sample.changedFraction > .001)),
      "Wind changes must not cancel cloud advection");
  console.log(JSON.stringify({ engine, output, ...report }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
