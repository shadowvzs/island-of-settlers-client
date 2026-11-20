import { writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import type { runTslParity, TslParityResult } from "./tsl-parity-scene";

/**
 * WG-FIX-C (D): evaluates the shared TSL graphs (colour output, noise, wind, fog, lighting) on the
 * GPU and compares every sample with its CPU reference (tolerance 1e-4). Vitest's Node runner has
 * no WebGPU/WebGL device, so this runs in the bench Chrome through the Vite dev server. Run it from
 * island-of-settlers-client through the browser slot:
 *
 *   <captures>/browser-slot.sh npx tsx tools/bench/tsl-parity.ts
 *
 * TSL_PARITY_BACKEND=webgpu (with WEBGPU=1, e.g. in a `npx tsx --env-file=<file>` env file) uses
 * the native WebGPU backend instead of WebGPURenderer's forced WebGL2 backend. TSL_PARITY_OUTPUT
 * writes the full sample table as JSON. Exit code 1 when any sample differs by more than 1e-4.
 */
declare global {
  interface Window { __tslParity: typeof runTslParity }
}

const TOLERANCE = 1e-4;
const forceWebGL = process.env.TSL_PARITY_BACKEND !== "webgpu";

const { server, url } = await startDevServer();
const browser = await launchBrowser();
let result: TslParityResult;
try {
  const page = await browser.newPage({ viewport: { height: 64, width: 256 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/tsl-parity.html", route => route.fulfill({
    body: "<!doctype html><body></body>", contentType: "text/html"
  }));
  await page.goto(`${url}tsl-parity.html`);
  await page.evaluate(async () => {
    const path = "/tools/bench/tsl-parity-scene.ts";
    window.__tslParity = (await import(/* @vite-ignore */ path)).runTslParity;
  });
  result = await page.evaluate(force => window.__tslParity(force), forceWebGL);
  if (errors.length) console.warn(`browser errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await server.close();
}

if (process.env.TSL_PARITY_OUTPUT)
  writeFileSync(process.env.TSL_PARITY_OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
const failed = result.cases.filter(parityCase => !(parityCase.maxError <= TOLERANCE));
console.log(`TSL parity on ${result.backend} (tolerance ${TOLERANCE})`);
for (const parityCase of result.cases) {
  const status = failed.includes(parityCase) ? "FAIL" : "ok";
  console.log(`${status.padEnd(4)} ${parityCase.name.padEnd(28)} ${parityCase.samples.length} samples, ` +
    `max error ${parityCase.maxError.toExponential(2)}`);
}
for (const parityCase of failed) {
  parityCase.samples.forEach((sample, index) =>
    console.log(`  ${parityCase.name}[${index}] cpu ${sample.cpu.map(value => value.toFixed(6)).join(",")} ` +
      `gpu ${sample.gpu.map(value => value.toFixed(6)).join(",")}`));
}
console.log(`${result.cases.length - failed.length}/${result.cases.length} cases pass`);
process.exitCode = failed.length ? 1 : 0;
