import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { neutralBuildingTriangleLimit } from "../../tests/helpers/neutral-building-budgets";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";
/** Bandit site code and the military building type whose model slot it is drawn in. */
const BANDIT_SITE_TYPES = [[0, 2], [1, 4], [2, 9]] as const;
const buildings = process.argv.includes("--buildings");
const family = buildings ? "neutral-outposts" : "neutral-camps";
const output = resourcesPath("settlement-previews", buildings ? "themed-neutral-outposts" : "themed-neutral-buildings");
const assets = process.argv.includes("--assets");
const libraries = resourcesPath("building-previews", "nations", family);
if (assets) {
  mkdirSync(libraries, { recursive: true });
  mkdirSync(resolve("assets/building-icons"), { recursive: true });
}
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(),
  browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"] as const) {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } }),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/themed-building-review.html", (route) =>
      route.fulfill({ contentType: "text/html", body: "<body></body>" })
    );
    await page.goto(`${url}themed-building-review.html`);
    await page.evaluate(async (quality) => {
      const { themedNeutralBuildingScene } = await import(
        /* @vite-ignore */ String("/tools/bench/themed-neutral-building-scene.ts")
      );
      (window as any).__themedBuildings = themedNeutralBuildingScene(quality === "high");
    }, quality);
    for (const theme of ["forest", "tropical", "winter", "desert", "swamp", "pirate"]) {
      for (const model of [0, 1, 2])
        for (const [code, id] of BANDIT_SITE_TYPES)
          for (const view of ["front", "rear", "side", "threeQuarter", "gameplay"]) {
            const style = {
              bandit: { code, layout: model },
              ...(buildings && { enclosure: "building" }),
              theme: theme === "pirate" ? "tropical" : theme,
              variant: theme === "pirate" ? "pirate" : "bandit"
            };
            const result = await page.evaluate(
              ({ id, style, view }) => (window as any).__themedBuildings.shot(id, style, view),
              { id, style, view }
            );
            assert.equal(result.style, `${style.theme}:${style.variant}`);
            assert(
              result.triangles <= neutralBuildingTriangleLimit(id, quality === "high", 3500),
              `${theme}/${id}/${quality}: ${result.triangles}`
            );
            reports.push({ theme, quality, view, model, ...result });
            await page.screenshot({
              path: resolve(
                output,
                `${theme}-${id}-${quality}-${view}${model ? `-model-${model}` : ""}.png`
              )
            });
            if (assets && view === "front") {
              const bytes = await page.evaluate(() =>
                (window as any).__themedBuildings.exportCurrent()
              );
              writeFileSync(
                resolve(libraries, `${theme}-${id}-${model}-${quality}.glb`),
                Buffer.from(bytes, "base64")
              );
              if (quality === "high") {
                await page.setViewportSize({ width: 240, height: 180 });
                await page.evaluate(
                  ({ id, style }) =>
                    (window as any).__themedBuildings.shot(id, style, "threeQuarter"),
                  { id, style }
                );
                await page.screenshot({
                  path: resolve("assets/building-icons", `${buildings ? "outpost" : "camp"}-${theme}-${code}-${model}.png`)
                });
                await page.setViewportSize({ width: 900, height: 900 });
              }
            }
          }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
  await server.close();
}
console.log(
  JSON.stringify({
    captures: reports.length,
    assets,
    output,
    libraries: assets ? libraries : undefined
  })
);
