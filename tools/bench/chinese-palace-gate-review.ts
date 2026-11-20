import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/project-reviews/tang-palace-gate-current");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], reports = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=chinese&quality=${quality}&sample=7`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    const measured = await page.evaluate(async () => {
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null); preview.selectBuilding(7);
      await (window as any).__buildingResidentReady;
      const model = preview.model(); model.update(0, { construction: 1, door: 0, working: false });
      model.root.updateMatrixWorld(true);
      const bounds = new three.Box3().setFromObject(model.root);
      const gates = [-2.44, -1.22, 0, 1.22, 2.44].map(x => {
        const ray = new three.Raycaster(new three.Vector3(x, .8, 3), new three.Vector3(0, 0, -1), 0, 7);
        const hit = ray.intersectObject(model.root, true)[0];
        return { x, depthFromFront: hit ? 2.2 - hit.point.z : null };
      });
      return { gates, triangles: model.triangles(false), min: bounds.min.toArray(), max: bounds.max.toArray() };
    });
    assert(measured.gates.every(gate => gate.depthFromFront !== null && gate.depthFromFront > .6));
    assert(measured.min[0] >= -3.85001 && measured.max[0] <= 3.85001, "native tiles fit the original width");
    assert(measured.min[2] >= -3.38 && measured.max[2] <= 3.38, "native geometry fits the original depth");
    for (const [view, angle, eye, target, radius] of [
      ["front", .6, 7, 2.1, 13], ["back", Math.PI + .6, 7, 2.1, 13],
      ["side", Math.PI / 2, 5, 2.1, 13], ["gameplay", .6, 11, 2.1, 22],
      ["eye-front", 0, 1.05, 2.25, 10], ["eye-back", Math.PI, 1.05, 2.25, 10],
      ["eye-right", Math.PI / 2, 1.05, 2.25, 10], ["eye-left", -Math.PI / 2, 1.05, 2.25, 10],
      ["eaves", .15, 3.2, 3.4, 5.3], ["doors", .1, .95, .95, 4.7],
    ] as const) {
      await page.evaluate(({ angle, eye, radius, target }) => {
        const { camera, controls, renderer, scene } = (window as any).__buildingPreview;
        camera.position.set(Math.sin(angle) * radius, eye, Math.cos(angle) * radius);
        controls.target.set(0, target, 0); controls.update(); renderer.render(scene, camera);
      }, { angle, eye, target, radius });
      await page.screenshot({ path: resolve(output, `${quality}-${view}.png`) });
    }
    reports.push({ quality, ...measured });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ errors, reports }, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify(reports));
