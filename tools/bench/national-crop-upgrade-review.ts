import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "national-crop-upgrade-2026-11-03");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const nation of ["persian", "chinese", "indigenous", "maya"]) for (const quality of ["high", "minimal"]) {
    for (const id of [5, 6]) {
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1&building=${id}`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      const result = await page.evaluate(async ({ id, nation }) => {
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null);
        preview.selectBuilding(id);
        const model = preview.model();
        model.update(0, { construction: 1, door: 0, working: false });
        model.root.rotation.y = -.55;
        model.root.updateMatrixWorld(true);
        preview.renderer.render(preview.scene, preview.camera);
        const { nationTriangleBudget } = await import(
          /* @vite-ignore */ String("/src/render-common/buildings/building-triangle-budgets.ts"));
        return { triangles: model.triangles(false), budgets: nationTriangleBudget(nation, id),
          cacao: model.recipe.parts.filter((p: any) => p.shape.startsWith("cacao-")),
          jars: model.recipe.parts.filter((p: any) => p.nationDecor && p.shape === "clay-jar"),
          mechanismChildren: model.root.getObjectByName("mechanism")?.children.length };
      }, { id, nation });
      assert(result.triangles < result.budgets[quality === "high" ? 0 : 1]);
      if (id === 5 && nation === "maya") assert.equal(result.cacao.length, 6);
      if ([17, 24, 26, 31].includes(id)) assert.equal(result.jars.length, 0);
      if (id === 24) assert.equal(result.mechanismChildren, 0);
      await page.screenshot({ path: resolve(output, `${nation}-${id}-${quality}.png`) });
      reports.push({ nation, quality, id, ...result });
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ reports, errors, passed: true }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
console.log(`Building props: ${reports.length} native views, ${output}`);
