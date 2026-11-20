import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("scout-spyglass-animation-current");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { height: 640, width: 640 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/scout-animation.html", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><body style='margin:0'>" }));
    await page.goto(`${url}scout-animation.html`);
    const result = await page.evaluate(async detailed => {
      const { runScoutAnimationReview } = await import(
        /* @vite-ignore */ String("/tools/bench/scout-animation-scene.ts"));
      return runScoutAnimationReview(detailed);
    }, quality === "high");
    writeFileSync(resolve(output, `${quality}.png`), Buffer.from(result.png, "base64"));
    reports.push({ errors, metrics: result.metrics, quality });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ output, reports }));
} finally { await browser.close(); await server.close(); }
