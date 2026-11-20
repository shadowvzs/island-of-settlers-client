import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "nation-expansion-current", "maya", "summit-portal");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=maya&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    const record = await page.evaluate(async () => {
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null); preview.selectBuilding(7, 1);
      await (window as any).__buildingResidentReady;
      preview.camera.position.set(.28, 4.79, 6.5); preview.controls.target.set(0, 4.72, -.1);
      preview.controls.update(); preview.renderer.render(preview.scene, preview.camera);
      return { triangles: preview.model().triangles(false), parts: preview.model().recipe.parts.filter((part: any) => part.surface === "dark") };
    });
    await page.screenshot({ path: resolve(output, `${quality}-front.png`) });
    records.push({ quality, ...record });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ errors, records }, null, 2));
} finally { await browser.close(); await server.close(); }
