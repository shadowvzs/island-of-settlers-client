import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Viking ornaments in the building showcase: Thor on the HQ tower and the flag, gable dragons, wall
 * trophies and the longship carving, High and Minimal, at the normal preview and close views.
 * VIEWS (optional JSON) overrides the list: [{ id, name, target?: [x,y,z], offset?: [x,y,z] }].
 */
interface View { id: number; name: string; offset?: [number, number, number]; target?: [number, number, number] }

const DEFAULT_VIEWS: View[] = [
  { id: 0, name: "hq" },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(step => {
    // Close turnaround of Thor on the HQ tower (centre 0, 3.95, 0), every 45 degrees from his front.
    const angle = .3 + step * Math.PI / 4;
    const offset = [Math.sin(angle) * 1.8, .25, Math.cos(angle) * 1.8] as View["offset"];
    return { id: 0, name: `thor-turn-${step}`, offset,
      target: [0, 3.95, 0] as View["target"] };
  }),
  { id: 0, name: "thor-hammer", offset: [-.3, 0, .8], target: [-.09, 4.25, .08] },
  { id: 0, name: "thor-face", offset: [.13, .02, .42], target: [.01, 3.95, .04] },
  { id: 0, name: "thor-tower", offset: [1.2, .4, 2.2], target: [0, 3, 0] },
  { id: 0, name: "hq-flag", offset: [1.6, .5, 2.4], target: [0, 2.1, 1.3] },
  { id: 0, name: "hq-back", offset: [-3.2, 2.6, -4.2], target: [0, 1.4, 0] },
  { id: 1, name: "barracks" }, { id: 2, name: "guardhouse" }, { id: 24, name: "armory" },
  { id: 36, name: "shipyard" }, { id: 39, name: "harbor" }, { id: 40, name: "tavern" },
  { id: 17, name: "woodcutter" }, { id: 20, name: "forester" }
];

const output = resolve(process.env.OUT ?? "../resources/settlement-previews/viking-decor-2026-10-13/showcase");
mkdirSync(output, { recursive: true });
const views: View[] = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : DEFAULT_VIEWS;
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const quality of qualities) {
    await page.goto(`${url}building-showcase.html?nation=viking&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    for (const view of views) {
      const triangles = await page.evaluate(async view => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(view.id);
        const model = preview.model();
        await (window as any).__buildingResidentReady;
        model.update(0, { construction: 1, door: 0, working: false, windStrength: .8, windDirection: .4 });
        const camera = preview.camera.clone();
        if (view.target && view.offset) {
          camera.position.set(view.target[0] + view.offset[0], view.target[1] + view.offset[1],
            view.target[2] + view.offset[2]);
          camera.lookAt(...view.target);
        }
        preview.renderer.render(preview.scene, camera);
        return model.triangles(false);
      }, view);
      reports.push({ name: view.name, quality, triangles });
      await page.screenshot({ path: resolve(output, `${view.name}-${quality}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify(reports));
