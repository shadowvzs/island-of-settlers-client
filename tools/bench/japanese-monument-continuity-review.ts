import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const stage = process.argv[2] ?? "after";
const output = resourcesPath("project-reviews", "japanese-monument-continuity", stage);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=japanese&quality=${quality}&sample=7`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    const measured = await page.evaluate(async () => {
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null); preview.selectBuilding(7);
      await (window as any).__buildingResidentReady;
      const model = preview.model(); model.update(0, { construction: 1, door: 0, working: false });
      model.root.updateMatrixWorld(true);
      const bounds = new three.Box3().setFromObject(model.root);
      const bands = Array.from({ length: 11 }, (_, level) => {
        const y = 1.93 + level * .785 + .67;
        const ray = new three.Raycaster(new three.Vector3(0, y, 6), new three.Vector3(0, 0, -1), 0, 12);
        return { level, y, hits: ray.intersectObject(model.root, true).length };
      });
      return { bands, triangles: model.triangles(), min: bounds.min.toArray(), max: bounds.max.toArray() };
    });
    for (const [view, angle, eye, target, radius] of [
      ["front", .65, 7.2, 5.8, 18], ["back", .65 + Math.PI, 7.2, 5.8, 18],
      ["low-front", .25, 1.65, 5.5, 13], ["low-back", Math.PI + .25, 1.65, 5.5, 13],
      ["middle-gap", .15, 4.7, 5.0, 5.4], ["upper-gap", 2.2, 8.1, 8.5, 4.5]
    ] as const) {
      await page.evaluate(({ angle, eye, radius, target }) => {
        const { camera, controls, renderer, scene } = (window as any).__buildingPreview;
        camera.position.set(Math.sin(angle) * radius, eye, Math.cos(angle) * radius);
        controls.target.set(0, target, 0); controls.update(); renderer.render(scene, camera);
      }, { angle, eye, target, radius });
      await page.screenshot({ path: resolve(output, `${quality}-${view}.png`) });
    }
    if (stage === "after") assert(measured.bands.every(band => band.hits > 0), "every storey has a continuous enclosing load path");
    reports.push({ quality, ...measured });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ stage, errors, reports }, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify(reports));
