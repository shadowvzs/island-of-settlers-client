import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/project-reviews/road-decoration-prototypes-2026-11-03/actual-actor-clearance");
mkdirSync(output, { recursive: true });
const errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/wisteria-clearance.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
  await page.goto(`${url}wisteria-clearance.html`);
  const result = await page.evaluate(async () => {
    const { measureWisteriaActorClearance } = await import(/* @vite-ignore */ String("/tools/bench/wisteria-clearance-scene.ts"));
    return measureWisteriaActorClearance();
  });
  const { pictures, ...report } = result;
  for (const picture of pictures)
    writeFileSync(resolve(output, `${picture.name}.png`), Buffer.from(picture.image, "base64"));
  const status = { ...report, errors,
    allMountedCenterClear: report.mounted.every((entry: any) => entry.centerClear),
    allMountedLanesClear: report.mounted.every((entry: any) => entry.laneClear),
    allLoadedCartLanesClear: report.carts.every((entry: any) => entry.lanesClear) };
  writeFileSync(resolve(output, "report.json"), JSON.stringify(status, null, 2));
  console.log(JSON.stringify({ mountedSamples: report.mounted.length, cartSamples: report.carts.length,
    allMountedCenterClear: status.allMountedCenterClear, allMountedLanesClear: status.allMountedLanesClear,
    allLoadedCartLanesClear: status.allLoadedCartLanesClear, errors }));
  assert.deepEqual(errors, []);
  assert(status.allMountedCenterClear, "An actual commander cannot pass the arch center");
  assert(status.allLoadedCartLanesClear, "An actual loaded cart cannot pass its canonical lane");
  await page.close();
} finally { await browser.close(); await server.close(); }
