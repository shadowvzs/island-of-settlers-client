import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import { type BrowserEngine, launchEngine, startDevServer } from "./browser";
import { reviewLiveSky } from "./exploration-sky-live-review";
import type { createSkyReview, SkyReviewCase } from "./exploration-sky-review-scene";
import { resourcesPath } from "./resources-path";

/** Focused visual/GPU review of the actual production sky; not full E2E. */
const output = resolve(process.env.OUTPUT ?? resourcesPath("project-reviews", "possessed-sky-2026-10-24"));
mkdirSync(output, { recursive: true });
const cases: Record<string, SkyReviewCase> = {
  "day-clouds": { cover: 0.52, daylight: 1, detail: 3, fov: 65, pitch: 0.35, sun: [0.5, 0.6, -0.5], yaw: 0 },
  "medium-clouds": { cover: 0.52, daylight: 1, detail: 2, fov: 65, pitch: 0.35, sun: [0.5, 0.6, -0.5], yaw: 0 },
  "default-clouds": { cover: 0.45, daylight: 1, detail: 3, fov: 65, pitch: 0.35, sun: [0.5, 0.6, -0.5], yaw: 0 },
  "day-zenith": { cover: 0.52, daylight: 1, detail: 3, fov: 80, pitch: Math.PI / 2, sun: [0.5, 0.6, -0.5], yaw: 0 },
  "storm-zenith": { cover: 0.92, daylight: 0.6, detail: 3, fov: 80, pitch: Math.PI / 2, sun: [0.5, 0.6, -0.5], yaw: 0 },
  "minimal-zenith": { cover: 0.52, daylight: 1, detail: 1, fov: 80, pitch: Math.PI / 2, sun: [0.5, 0.6, -0.5], yaw: 0 },
  "sun-spyglass": { cover: 0, daylight: 1, detail: 3, fov: 34, pitch: 0.6, sun: [0, Math.sin(0.6), -Math.cos(0.6)], yaw: 0 },
  "sun-clouds": { cover: 0.55, daylight: 1, detail: 3, fov: 34, pitch: 0.6, sun: [0, Math.sin(0.6), -Math.cos(0.6)], yaw: 0 },
  "sun-veil": { cover: 0.3, daylight: 1, detail: 3, fov: 34, pitch: 0.6, sun: [0, Math.sin(0.6), -Math.cos(0.6)], yaw: 0 },
  "sun-sunset": { cover: 0.2, daylight: 0.7, detail: 3, fov: 50, pitch: 0.12, sun: [0, Math.sin(0.14), -Math.cos(0.14)], yaw: 0 },
  "sun-sunset-minimal": { cover: 0.2, daylight: 0.7, detail: 1, fov: 50, pitch: 0.12, sun: [0, Math.sin(0.14), -Math.cos(0.14)], yaw: 0 },
  "sun-sunset-filmic": { cover: 0, daylight: 0.7, detail: 3, fov: 50, pitch: 0.12, sun: [0, Math.sin(0.16), -Math.cos(0.16)], tone: 1, yaw: 0 },
  "sun-morning-filmic": { cover: 0, daylight: 1, detail: 3, fov: 50, pitch: 0.3, sun: [0, Math.sin(0.38), -Math.cos(0.38)], tone: 1, yaw: 0 },
  "moon-spyglass": { cover: 0, daylight: 0, detail: 3, fov: 34, pitch: 0.6, sun: [0, Math.sin(0.6), -Math.cos(0.6)], yaw: 0 },
  "moon-detail": { cover: 0, daylight: 0, detail: 3, fov: 2, pitch: 0.6, sun: [0, Math.sin(0.6), -Math.cos(0.6)], yaw: 0 },
  "moon-overhead": { cover: 0, daylight: 0, detail: 3, fov: 4, pitch: Math.PI / 2, sun: [0, 1, 0], yaw: 0 },
  "night-clouds": { cover: 0.52, daylight: 0, detail: 3, fov: 65, pitch: 0.35, sun: [0.5, 0.6, -0.5], yaw: 0 }
};
declare global {
  interface Window { __skyReview: Awaited<ReturnType<typeof createSkyReview>> }
}
const engine = process.env.ENGINE ?? "chromium";
assert(["chromium", "firefox"].includes(engine), "ENGINE must be chromium or firefox");

const reviewShader = async (browser: Browser, url: string) => {
  const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
  await page.addInitScript("window.__name = value => value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/sky-review.html", route => route.fulfill({
    body: "<!doctype html><html><body></body></html>", contentType: "text/html"
  }));
  await page.goto(`${url}sky-review.html`);
  await page.evaluate(async () => {
    const path = "/tools/bench/exploration-sky-review-scene.ts";
    const { createSkyReview } = await import(/* @vite-ignore */ path);
    window.__skyReview = createSkyReview();
  });
  await page.evaluate(settings => window.__skyReview.set(settings), cases["moon-detail"]!);
  await page.waitForFunction(() => window.__skyReview.moonLoaded(), null, { timeout: 20_000 });
  const results: Record<string, unknown> = {};
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (const [name, settings] of Object.entries(cases)) {
    if (only && !only.test(name)) continue;
    await page.evaluate(values => window.__skyReview.set(values), settings);
    const result = await page.evaluate(samples => window.__skyReview.measure(samples), engine === "firefox" ? 0 : 12);
    if (name === "day-zenith" || name === "minimal-zenith")
      assert((result.cloudChangedFraction ?? 0) > 0.02, `${name}: cloud cover must actually affect the rendered sky`);
    results[name] = result;
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  }
  const lifecycle = await page.evaluate(() => window.__skyReview.lifecycle());
  assert.equal(lifecycle.sky.disposed, true);
  assert.equal(lifecycle.sky.extraTextures, 0);
  assert(lifecycle.released.every(value => value.geometries === 0), "sky geometries must be released each cycle");
  assert(lifecycle.released.every(value => value.textures === 1), "only the renderer's borrowed noise may remain");
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.close();
  return { errors, lifecycle, results };
};

const { server, url } = await startDevServer();
const browser = await launchEngine(engine as BrowserEngine);
try {
  const isolated = process.env.LIVE_ONLY === "1" ? null : await reviewShader(browser, url);
  const file = process.env.LIVE_ONLY === "1" ? "live-report.json" : "report.json";
  const report = { engine, ...isolated, live: [] as Awaited<ReturnType<typeof reviewLiveSky>> };
  writeFileSync(resolve(output, file), `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.LIVE !== "0") report.live = await reviewLiveSky(browser, url, output);
  writeFileSync(resolve(output, file), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
