import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const runId = process.argv[2] ?? "ardashir-a";
assert(/^[a-z0-9-]+$/.test(runId));
const output = resourcesPath("project-reviews", "persian-civic-rebuild-2026-11-03", runId);
assert(!existsSync(resolve(output, "report.json")), "Preserve previous native evidence; use a new run id.");
mkdirSync(output, { recursive: true });
const allViews = [
  { name: "gameplay", position: [11, 8, 12], target: [0, 2.3, 0] },
  { name: "close", position: [7.5, 5.8, 8.4], target: [0, 2.8, .1] },
  { name: "facade", position: [.5, 3.2, 13], target: [0, 2.8, 0] },
  { name: "left", position: [-13, 4.8, .5], target: [0, 2.6, 0] },
  { name: "right", position: [13, 4.8, .5], target: [0, 2.6, 0] },
  { name: "rear", position: [-8, 6.5, -11], target: [0, 2.4, -.7] },
  { name: "roof", position: [-6, 11, 8], target: [0, 2, 0] },
  { name: "iwan-interior", position: [.25, 1.7, 3.60], target: [0, 2.8, -1.2] },
  { name: "dome-intrados", position: [.22, 1.75, -1.0], target: [.18, 4.8, -1.25] },
  { name: "courtyard", position: [.5, 5.3, -6.5], target: [0, 1.6, -2.9] }
];
const selected = process.argv[3]?.split(",");
const views = allViews.filter(view => !selected || selected.includes(view.name));
assert(views.length > 0, "Select at least one existing view.");
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [], errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=persian&quality=${quality}&sample=1&building=7`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    const report = await page.evaluate(async () => {
      const p = (window as any).__buildingPreview; p.renderer.setAnimationLoop(null); p.selectBuilding(7);
      const model = p.model(); model.update(0, { construction: 1, door: 0, working: false });
      model.root.rotation.y = 0; model.root.updateMatrixWorld(true);
      const { nationTriangleBudget } = await import(
        /* @vite-ignore */ String("/src/render-common/buildings/building-triangle-budgets.ts"));
      return { triangles: model.triangles(false), budgets: nationTriangleBudget("persian", 7) };
    });
    assert(report.triangles <= report.budgets[quality === "high" ? 0 : 1]);
    for (const view of views) {
      await page.evaluate(view => {
        const p = (window as any).__buildingPreview;
        p.camera.position.set(...view.position); p.camera.lookAt(...view.target);
        p.renderer.render(p.scene, p.camera);
      }, view);
      await page.screenshot({ path: resolve(output, `persian-7-${quality}-${view.name}.png`) });
    }
    reports.push({ quality, ...report });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors, views, passed: true,
    visualAcceptance: "Capture/budget receipt only; all views require actual image inspection." }, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(`Ardashir native CLOSED: ${reports.length} qualities, ${views.length * reports.length} images, ${output}`);
