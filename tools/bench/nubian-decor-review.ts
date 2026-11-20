import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Nubian building decor (textiles, painted jars, hats, hide shields, skulls): triangle budget of
 * every Nubian building on High and Minimal, plus showcase views of the reviewed buildings.
 * `BUILDINGS=0,1,22` limits the views, `QUALITY=high` the quality; `VIEWS=0` measures only.
 */
const BUDGET = { high: 9800, minimal: 2300 } as const;
const VIEWS = {
  front: 0,
  threeQuarter: -Math.PI / 4,
  side: -Math.PI / 2,
  rear: Math.PI,
  left: Math.PI / 2
} as const;
/** Camera distance factors: the whole building, then a close look at the props. */
const ZOOMS = { "": 1, "-close": 0.5 } as const;
const reviewed = (process.env.BUILDINGS ?? "0,1,2,3,7,9,17,18,20,22,23,29,34,35,37,39,40")
  .split(",")
  .map(Number);
const output = resolve("../resources/settlement-previews/nubian-decor/showcase");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(),
  browser = await launchBrowser();
const budget: Record<string, Array<{ id: number; triangles: number }>> = {};
const wind: Record<string, number> = {};

/**
 * Renders the Brewery's hanging twice, 0.9 s apart, in the still showcase: High ripples the cloth
 * (pixels change), Minimal keeps it still. Returns the number of changed sampled pixels.
 */
const measureWind = async (page: import("playwright-core").Page) => {
  const capture = () =>
    page.evaluate(() => {
      const preview = (window as any).__buildingPreview;
      preview.selectBuilding(23);
      const model = preview.model();
      model.update(1.3, { construction: 1, door: 0, working: false });
      model.root.rotation.y = -Math.PI / 2;
      model.root.updateMatrixWorld(true);
      preview.renderer.render(preview.scene, preview.camera);
      const canvas = preview.renderer.domElement as HTMLCanvasElement,
        copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext("2d")!;
      context.drawImage(canvas, 0, 0);
      return Array.from(
        context
          .getImageData(0, 0, copy.width, copy.height)
          .data.filter((_value, index) => index % 16 === 0)
      );
    });
  const first = await capture();
  await page.waitForTimeout(900);
  const second = await capture();
  return first.filter((value, index) => Math.abs(value - second[index]!) > 6).length;
};
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  const qualities = (["high", "minimal"] as const).filter(
    (quality) => (process.env.QUALITY ?? quality) === quality
  );
  for (const quality of qualities) {
    await page.goto(`${url}building-showcase.html?nation=nubian&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, {
      timeout: 120000
    });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    budget[quality] = [];
    for (const definition of BUILDING_CATALOG) {
      const triangles = await page.evaluate((id) => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id);
        return preview.model().triangles(false);
      }, definition.id);
      budget[quality]!.push({ id: definition.id, triangles });
    }
    for (const id of process.env.VIEWS === "0" ? [] : reviewed)
      for (const [view, yaw] of Object.entries(VIEWS))
        for (const [suffix, zoom] of Object.entries(ZOOMS)) {
          await page.evaluate(
            async ({ id, yaw, zoom }) => {
              const preview = (window as any).__buildingPreview;
              preview.selectBuilding(id);
              const model = preview.model();
              await (window as any).__buildingResidentReady;
              model.update(1.3, { construction: 1, door: 0, working: false });
              model.root.rotation.y = yaw;
              model.root.updateMatrixWorld(true);
              const camera = preview.camera.clone(),
                target = preview.controls.target;
              camera.position.sub(target).multiplyScalar(zoom).add(target);
              camera.position.y -= (1 - zoom) * 1.2;
              camera.lookAt(target.x, target.y * zoom, target.z);
              preview.renderer.render(preview.scene, camera);
            },
            { id, yaw, zoom }
          );
          await page.screenshot({ path: resolve(output, `${quality}-${id}-${view}${suffix}.png`) });
        }
    wind[quality] = await measureWind(page);
  }
  assert.deepEqual(errors, []);
  if (wind.high !== undefined) assert(wind.high > 0, "High hangings move in the wind");
  if (wind.minimal !== undefined) assert.equal(wind.minimal, 0, "Minimal hangings stay still");
  writeFileSync(resolve(output, "budget.json"), JSON.stringify({ budget, wind }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
console.log("wind (changed pixels between two frames)", JSON.stringify(wind));
for (const [quality, rows] of Object.entries(budget)) {
  const limit = BUDGET[quality as keyof typeof BUDGET];
  console.log(
    quality,
    rows.map((row) => `${row.id}:${row.triangles}${row.triangles > limit ? "!" : ""}`).join(" ")
  );
}
