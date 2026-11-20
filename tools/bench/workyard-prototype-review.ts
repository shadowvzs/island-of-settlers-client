import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { nationTriangleBudget } from "../../src/render-common/buildings/building-triangle-budgets";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const sample = process.env.REVIEW_SAMPLE === "1";
const output = resourcesPath("project-reviews", "roof-workyard-candidates-2026-11-02",
  sample ? "sample-v2" : "native");
mkdirSync(output, { recursive: true });
const nations: readonly WorkerNation[] = sample ? ["roman", "japanese", "maya", "indigenous"]
  : ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"];
const qualities = sample ? ["high"] : ["high", "minimal"];
const ids = [17, 20, 33, 61, 32, 8];
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], reports: Array<{ triangles: number; budget: number; withinBudget: boolean } &
  Record<string, unknown>> = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 720 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const nation of nations) for (const quality of qualities) {
    for (const variant of ["old", "new"]) {
      const query = variant === "new" ? "&workyardReview=1" : "";
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1${query}`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
      for (const id of ids) {
        const report = await page.evaluate(async ({ id, variant }) => {
          const preview = (window as any).__buildingPreview;
          preview.selectBuilding(id, 1); await (window as any).__buildingResidentReady;
          const model = preview.model();
          model.update(0, { construction: 1, door: 0, working: true,
            inputStock: { logs: 3, flax: 3, flour: 3, water: 3 }, outputStock: { cloth: 3, planks: 3, bread: 3 } });
          const scale = model.root.userData.modelScale;
          const [width, depth] = model.root.userData.gridFootprint;
          const distance = Math.max(width + 1, depth) / scale * 2.6;
          preview.camera.position.set(distance * .65, distance * .65, distance * .85);
          preview.controls.target.set(.25 / scale, .6 / scale, 0);
          preview.controls.update(); preview.renderer.render(preview.scene, preview.camera);
          return { id, variant, gridFootprint: [width, depth], scale,
            triangles: model.triangles(), profile: model.root.userData.workyardReview };
        }, { id, variant });
        const filename = `${nation}-${quality}-${id}-${variant}.png`;
        await page.screenshot({ path: resolve(output, filename) });
        const budget = nationTriangleBudget(nation, id)[quality === "high" ? 0 : 1];
        reports.push({ ...report, budget, filename, nation, quality, withinBudget: report.triangles <= budget });
      }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ errors, reports,
    budgetViolations: reports.filter(report => !report.withinBudget),
    coverage: `${nations.length} nations, ${qualities.join("/")}, level 1, default rotation, stocked/working. Remaining review: levels 2-5, other rotations, stock-state images, mixed district and real worker/carrier routes.` }, null, 2));
  const rows = nations.flatMap(nation => qualities.flatMap(quality => ids.map(id => {
    const name = `${nation}-${quality}-${id}`;
    return `<article><h2>${nation} ${quality} type ${id}</h2><div><figure><img src="${name}-old.png"><figcaption>Existing</figcaption></figure><figure><img src="${name}-new.png"><figcaption>Prototype</figcaption></figure></div></article>`;
  })));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Roof and workyard candidate review</title><style>body{font:16px system-ui;background:#242923;color:#fff}article{margin:2rem auto;max-width:1400px}article div{display:flex}figure{margin:0;width:50%}img{width:100%}figcaption{text-align:center}</style><h1>Roof and workyard candidates — approval pending</h1><p>Five integrated national roof monitors/cowls plus east-side work strips; compact Tannery control. Original shells, doors, stock and all production art remain available. Candidate materials reuse authored runtime packs; owner reference images are not runtime textures. Level 1, stocked, fixed shared camera. Production recipes and plots are unchanged.</p>${rows.join("\n")}`);
} finally { await browser.close(); await server.close(); }
console.log(`Workyard review: ${reports.length} captures; ${errors.length} page errors`);
