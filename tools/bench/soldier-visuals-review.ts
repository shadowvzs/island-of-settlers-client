import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Soldier visuals review (tools/bench/soldier-visuals-scene.ts): every nation's foot soldiers and
 * rider next to an enemy army of another nation in its own gear, close and at gameplay distance,
 * the rider's parry and cut, a High rider's near / far detail at the switch size, forty riders
 * at gameplay distance and the triangle counts, on High and Minimal.
 * `npx tsx tools/bench/soldier-visuals-review.ts [label]` (QUALITIES=high limits the detail levels).
 */
const label = process.argv[2] ?? "current";
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const output = resourcesPath("settlement-previews", "soldier-visuals");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
const reports: Record<string, unknown> = {};
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/soldier-visuals.html", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><meta charset='utf-8'><body style='margin:0;background:#9aa391'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}soldier-visuals.html`);
    const result = await page.evaluate(async quality => {
      const { runSoldierVisualsReview } = await import(
        /* @vite-ignore */ String("/tools/bench/soldier-visuals-scene.ts"));
      return runSoldierVisualsReview(quality);
    }, quality as "high" | "minimal");
    for (const sheet of result.sheets)
      writeFileSync(resolve(output, `${label}-${sheet.name}.png`), Buffer.from(sheet.png, "base64"));
    reports[quality] = { errors, triangles: result.triangles };
    await page.close();
  }
  writeFileSync(resolve(output, `${label}-report.json`), JSON.stringify(reports, null, 1));
  console.log(JSON.stringify(reports, null, 1));
} finally { await browser.close(); await server.close(); }
