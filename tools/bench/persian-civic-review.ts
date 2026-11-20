import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "persian-civic-rebuild-2026-11-03", process.env.RUN_ID ?? "arcade-d");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [], errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const quality of ["high", "minimal"]) for (const id of [0, 7]) {
    await page.goto(`${url}building-showcase.html?nation=persian&quality=${quality}&sample=1&building=${id}`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    const result = await page.evaluate(async id => {
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null); preview.selectBuilding(id);
      const model = preview.model(); model.update(0, { construction: 1, door: 0, working: false });
      model.root.rotation.y = -.45; model.root.updateMatrixWorld(true);
      preview.renderer.render(preview.scene, preview.camera);
      const { nationTriangleBudget } = await import(
        /* @vite-ignore */ String("/src/render-common/buildings/building-triangle-budgets.ts"));
      return { triangles: model.triangles(false), budgets: nationTriangleBudget("persian", id) };
    }, id);
    assert(result.triangles <= result.budgets[quality === "high" ? 0 : 1]);
    await page.screenshot({ path: resolve(output, `persian-${id}-${quality}-gameplay.png`) });
    await page.evaluate(() => {
      const p = (window as any).__buildingPreview, target = p.controls.target.clone();
      p.camera.position.copy(target).add(p.camera.position.clone().sub(target).multiplyScalar(.65));
      p.controls.update(); p.renderer.render(p.scene, p.camera);
    });
    await page.screenshot({ path: resolve(output, `persian-${id}-${quality}-close.png`) });
    await page.evaluate(async () => {
      const p = (window as any).__buildingPreview, model = p.model(); model.root.rotation.y = 0;
      model.root.updateMatrixWorld(true);
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const bounds = new three.Box3().setFromObject(model.root), size = bounds.getSize(new three.Vector3());
      const centre = bounds.getCenter(new three.Vector3());
      p.camera.position.set(centre.x + size.y * .04, bounds.min.y + size.y * .48, bounds.max.z + size.y * 1.75);
      p.controls.target.set(centre.x, bounds.min.y + size.y * .48, centre.z);
      p.controls.update(); p.renderer.render(p.scene, p.camera);
    });
    await page.screenshot({ path: resolve(output, `persian-${id}-${quality}-facade.png`) });
    reports.push({ quality, id, ...result });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors,
    passed: true, visualAcceptance: "Requires actual image inspection; this receipt proves capture and budget only." }, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(`Persian civic capture completed: ${reports.length} cases, ${output}`);
