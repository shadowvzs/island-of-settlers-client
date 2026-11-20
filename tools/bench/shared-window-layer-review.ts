import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentAction } from "./development-ui-helpers";
import { openFreshIsland } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "codex-2026-10-15", "shared-window-layer");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openFreshIsland(page, url, quality);
    await (await openDevelopmentAction(page, "Show info")).click();
    await page.getByRole("button", { name: "Build", exact: true }).click();
    await page.evaluate(() => {
      const info = document.querySelector<HTMLElement>(".stats-overlay")!;
      const build = document.getElementById("settlement-panel-title")!.closest<HTMLElement>(".settlement-ui__panel")!;
      Object.assign(info.style, { left: "40px", top: "50px", bottom: "auto", width: "360px", height: "400px" });
      Object.assign(build.style, { left: "200px", top: "180px", bottom: "auto", width: "500px", height: "450px" });
    });
    const top = () => page.evaluate(() => document.elementFromPoint(250, 200)?.closest(".settlement-ui__panel")?.querySelector("h2")?.id);
    assert.equal(await top(), "settlement-panel-title");
    await page.screenshot({ path: resolve(output, `${quality}-building-active.png`) });
    await page.mouse.click(80, 70);
    assert.equal(await top(), "stats-overlay-title");
    await page.screenshot({ path: resolve(output, `${quality}-info-active.png`) });
    await page.mouse.click(580, 200);
    assert.equal(await top(), "settlement-panel-title");
    assert.equal(await page.locator(".app-window-layer").count(), 1);
    assert.deepEqual(errors, []);
    reports.push({ quality, errors, pointerOrder: "passed" });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify({ output, reports }));
