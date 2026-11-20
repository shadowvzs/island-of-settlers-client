import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type BrowserEngine, launchEngine, startDevServer } from "./browser";
import type { reviewBuildingShadows as reviewScene } from "./building-shadow-batch-scene";
import { resourcesPath } from "./resources-path";

const engine = (process.env.ENGINE ?? "chromium") as BrowserEngine;
const output = resolve(process.env.OUTPUT ?? resourcesPath("project-reviews", "building-shadow-batch-2026-10-24"));
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchEngine(engine);
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.route("**/shadow-review.html", route => route.fulfill({
    body: "<!doctype html><html><body></body></html>", contentType: "text/html"
  }));
  await page.goto(`${url}shadow-review.html`);
  const report = await page.evaluate(async () => {
    const path = "/tools/bench/building-shadow-batch-scene.ts";
    const { reviewBuildingShadows } = await import(/* @vite-ignore */ path) as {
      reviewBuildingShadows: typeof reviewScene;
    };
    return reviewBuildingShadows();
  });
  writeFileSync(resolve(output, `${engine}-report.json`), `${JSON.stringify({ engine, errors, ...report }, null, 2)}\n`);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(report.results.every(row => Number(row.changedFraction) < .002), "Depth pixels must match reference");
  assert(report.results.every(row => (row.after as { draws: number }).draws <= 1), "At most one draw per building");
  assert(report.released.every(count => count === 0), "No owned GPU geometry may survive disposal");
  console.log(JSON.stringify({ engine, output, cases: report.results.length, released: report.released }));
} finally {
  await browser.close();
  await server.close();
}
