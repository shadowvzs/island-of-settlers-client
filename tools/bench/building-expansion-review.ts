import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../../src/render-common/buildings/building-triangle-budgets";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";
import { triangleBudgetFails } from "./triangle-budget";

const nation = (process.argv[2] ?? "indigenous") as WorkerNation;
assert(["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"].includes(nation));
const pilot = process.argv.includes("--pilot");
const pilotIds = new Set([0, 4, 17, 18, 25, 31, 35, 57, 7]);
const selectedIds = process.argv.find(value => value.startsWith("--ids="))?.slice(6).split(",").map(Number);
const definitions = BUILDING_CATALOG.filter(definition => selectedIds
  ? selectedIds.includes(definition.id) : !pilot || pilotIds.has(definition.id));
const output = resourcesPath("project-reviews", "nation-expansion-current", nation);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [], failures: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"] as const) {
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1`,
      { timeout: 120000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    for (const definition of definitions) {
      const metrics = await page.evaluate(async id => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id, 1);
        await (window as any).__buildingResidentReady;
        const model = preview.model();
        model.update(0, { construction: 1, door: 1, working: false });
        preview.renderer.render(preview.scene, preview.camera);
        return { nation: model.root.userData.nation, triangles: model.triangles(false),
          meshes: preview.renderer.info.render.calls, framing: preview.framing() };
      }, definition.id);
      assert.equal(metrics.nation, nation);
      assert(Number.isFinite(metrics.framing.radius) && metrics.framing.radius > 0);
      const budget = nationTriangleBudget(nation, definition.id)[quality === "high" ? 0 : 1];
      if (triangleBudgetFails(`${nation}/${quality}/${definition.id}`, metrics.triangles, budget))
        failures.push(`${quality}/${definition.id}: ${metrics.triangles}/${budget}`);
      for (const [view, angle, scale] of [
        ["front", .65, 1], ["back", .65 + Math.PI, 1], ["side", -.9, 1], ["gameplay", .65, 1.65]
      ] as const) {
        await page.evaluate(({ angle, scale }) => {
          const preview = (window as any).__buildingPreview, { camera, controls, renderer, scene } = preview;
          const { centre, radius } = preview.framing();
          const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 1.15 * scale;
          camera.position.set(centre[0] + Math.sin(angle) * distance * .82,
            centre[1] + distance * .58, centre[2] + Math.cos(angle) * distance * .82);
          controls.target.set(...centre); controls.update(); renderer.render(scene, camera);
        }, { angle, scale });
        await page.screenshot({ path: resolve(output, `${definition.id}-${quality}-${view}.png`) });
      }
      reports.push({ id: definition.id, name: definition.name, quality, budget, ...metrics });
    }
    console.log(`${nation}/${quality}: ${definitions.length} buildings, four views each`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, pilot ? "pilot.json" : "review.json"),
    JSON.stringify({ nation, errors, failures, reports }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close(); await server.close();
}
