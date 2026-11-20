import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AtmosphereReviewCase, createAtmosphereReview } from "./atmosphere-review-scene";
import { type BrowserEngine, launchEngine, startDevServer } from "./browser";
import { reviewLiveSky } from "./exploration-sky-live-review";
import { resourcesPath } from "./resources-path";

declare global {
  interface Window { __atmosphereReview: ReturnType<typeof createAtmosphereReview> }
}

/** Run through the coordinator's single GPU queue, with writers paused for this source hash. */
const output = resolve(process.env.OUTPUT ?? resourcesPath("project-reviews", "atmosphere-2026-10-24"));
mkdirSync(output, { recursive: true });
const engine = (process.env.ENGINE ?? "chromium") as BrowserEngine;
const sourceHash = () => {
  const hash = createHash("sha256");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src"],
    { encoding: "utf8" }).trim().split("\n").sort();
  for (const file of files) {
    hash.update(file);
    if (existsSync(file)) hash.update(readFileSync(file));
  }
  return hash.digest("hex");
};
const checkpoint = sourceHash();
const progress: Record<string, unknown> = { checkpoint, engine, status: "running" };
const saveProgress = () => writeFileSync(resolve(output, `${engine}-report.json`),
  `${JSON.stringify(progress, null, 2)}\n`);
const { server, url } = await startDevServer();
const browser = await launchEngine(engine);
try {
  const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
  const errors: string[] = [];
  progress.errors = errors;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/atmosphere-review.html", route => route.fulfill({
    body: "<!doctype html><body></body>", contentType: "text/html"
  }));
  await page.goto(`${url}atmosphere-review.html`);
  await page.evaluate(async () => {
    const path = "/tools/bench/atmosphere-review-scene.ts";
    const { createAtmosphereReview } = await import(/* @vite-ignore */ path);
    window.__atmosphereReview = createAtmosphereReview();
  });
  progress.device = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2")!;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dpr: devicePixelRatio,
      renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
      timerAvailable: Boolean(gl.getExtension("EXT_disjoint_timer_query_webgl2")),
      userAgent: navigator.userAgent,
      vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)
    };
  });
  const math = await page.evaluate(() => window.__atmosphereReview.math());
  progress.math = math;
  saveProgress();
  const failedMath = math.cases.filter(result => !result.passed);
  assert.deepEqual(failedMath, [], `native float32 mismatch: ${JSON.stringify(failedMath)}`);
  if (!math.skipped) {
    const first = math.cases.find(result => result.name === "surface-ortho600")!;
    const second = math.cases.find(result => result.name === "surface-ortho1200")!;
    assert.equal(first.measured, second.measured, "native ortho math must ignore artificial camera distance");
  }
  const zeroParity: Record<string, unknown> = {};
  const visibleEffect: Record<string, unknown> = {};
  progress.zeroParity = zeroParity;
  progress.visibleEffect = visibleEffect;
  for (const family of ["raw", "standard"] as const) {
    const comparison = await page.evaluate(family => {
      const base = { camera: "perspective", density: 0, family } as const;
      return window.__atmosphereReview.compare({ ...base, reference: true }, base);
    }, family);
    zeroParity[family] = comparison;
    assert.equal(comparison.maximum, 0, `${family}: zero density changes output`);
    const effect = await page.evaluate(family => {
      const base = { camera: "perspective", density: 0, family } as const;
      return window.__atmosphereReview.compare(base, { ...base, density: .035 });
    }, family);
    visibleEffect[family] = effect;
    assert(effect.meanAbsolute > 5, `${family}: enabled atmosphere must affect visible geometry`);
  }
  const ortho = await page.evaluate(() => {
    const base = { camera: "orthographic", density: .012, family: "mixed" } as const;
    return window.__atmosphereReview.compare({ ...base, offset: 600 }, { ...base, offset: 1200 });
  });
  progress.ortho = ortho;
  saveProgress();
  // Rasterization roundoff may move an edge by one pixel: record the full diff and bound its mean.
  assert(ortho.meanAbsolute < .05, `orthographic camera offset changes fog: ${JSON.stringify(ortho)}`);
  const viewLimit: Record<string, unknown> = {};
  progress.viewLimit = viewLimit;
  for (const family of ["raw", "standard"] as const) {
    const result = await page.evaluate(family => window.__atmosphereReview.viewLimit(family), family);
    viewLimit[family] = result;
    assert(result.meanAbsolute > 1, `${family}: view boundary must obscure distant geometry`);
    assert.equal(result.nearMaximum, 0, `${family}: view boundary must preserve nearby ground`);
  }
  const skyLimit = await page.evaluate(() => {
    const base = { camera: "perspective", density: 0, family: "mixed", pitch: 1.55, sky: true } as const;
    return window.__atmosphereReview.compare({ ...base, viewFar: 0 }, { ...base, viewFar: 100 });
  });
  viewLimit.sky = skyLimit;
  saveProgress();
  assert.equal(skyLimit.maximum, 0, "render boundary must not alter the physical sky");
  const cases: Record<string, AtmosphereReviewCase> = {
    "fps-clear": { camera: "perspective", density: 0, family: "mixed", sky: true },
    "fps-light": { camera: "perspective", density: .006, family: "mixed", sky: true },
    "fps-dense": { camera: "perspective", density: .035, family: "mixed", sky: true },
    "fps-zenith": { camera: "perspective", density: .035, family: "mixed", pitch: 1.55, sky: true },
    "iso-clear": { camera: "orthographic", density: 0, family: "mixed" },
    "iso-light": { camera: "orthographic", density: .002, family: "mixed" }
  };
  const results: Record<string, unknown> = {};
  progress.results = results;
  let resources: unknown;
  const draws: Record<string, number> = {};
  for (const [name, settings] of Object.entries(cases)) {
    if (process.env.PARITY_ONLY === "1") break;
    await page.evaluate(settings => window.__atmosphereReview.set(settings), settings);
    const result = await page.evaluate(async () => ({
      ...window.__atmosphereReview.inspect(), timing: await window.__atmosphereReview.measure()
    }));
    if (resources === undefined) resources = result.resources;
    assert.deepEqual(result.resources, resources, "fog must not allocate textures or geometries per profile");
    const family = `${settings.camera}-${Boolean(settings.sky)}-${settings.pitch ?? 0}`;
    if (draws[family] === undefined) draws[family] = result.draws;
    assert.equal(result.draws, draws[family], "fog must not add draws");
    results[name] = result;
    saveProgress();
    await page.screenshot({ path: resolve(output, `${engine}-${name}.png`) });
  }
  const water: Record<string, unknown> = {};
  progress.water = water;
  for (const refraction of [false, true]) {
    const result = await page.evaluate(refraction => window.__atmosphereReview.water(refraction), refraction);
    water[String(refraction)] = result;
    saveProgress();
    assert.equal(result.captureParity.maximum, 0, "refraction bed must exclude camera air");
    assert(result.effect.meanAbsolute > 5, "enabled atmosphere must affect production water shaders");
    await page.screenshot({ path: resolve(output, `${engine}-water-refraction-${refraction}.png`) });
  }
  const custom: Record<string, unknown> = {};
  progress.custom = custom;
  for (const kind of ["paddy-high", "paddy-minimal", "bees", "flame", "smoke", "ember"] as const) {
    if (process.env.PARITY_ONLY === "1") break;
    const result = await page.evaluate(kind => window.__atmosphereReview.custom(kind), kind);
    custom[kind] = result;
    saveProgress();
    assert(result.effect.maximum > 5 && result.effect.changedChannels > 20,
      `${kind}: enabled atmosphere must visibly affect the real custom shader`);
    await page.screenshot({ path: resolve(output, `${engine}-custom-${kind}.png`) });
  }
  const lifecycle = await page.evaluate(() => window.__atmosphereReview.dispose());
  assert.equal(lifecycle.geometries, 0);
  assert.equal(lifecycle.programs, 0);
  assert.deepEqual(errors, []);
  await page.close();
  const live = process.env.LIVE === "1" ? await reviewLiveSky(browser, url, output) : null;
  assert.equal(sourceHash(), checkpoint, "Source changed during GPU capture: rerun on a frozen candidate");
  const report = {
    ...progress, custom, lifecycle, live, status: "passed",
    note: "Synthetic production-shader coverage; full-game acceptance is separate. 1920x1080 DPR1."
  };
  writeFileSync(resolve(output, `${engine}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ checkpoint, engine, lifecycle, ortho, output, zeroParity }));
} catch (error) {
  progress.status = "failed";
  progress.failure = error instanceof Error ? error.stack : String(error);
  saveProgress();
  throw error;
} finally {
  await browser.close();
  await server.close();
}
