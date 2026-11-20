import { writeFileSync } from "node:fs";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { launchBrowser, startDevServer } from "./browser";

/** Measures every nation building on High and lists those over the triangle budget. */
const BUDGET = 9800;
const { server, url } = await startDevServer(), browser = await launchBrowser();
const result: Record<string, Array<{ id: number; triangles: number }>> = {};
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
  await page.routeWebSocket("**/*", () => {});
  for (const nation of ["viking", "nubian", "japanese"]) {
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=high&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    result[nation] = [];
    for (const definition of BUILDING_CATALOG) {
      const triangles = await page.evaluate(id => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id);
        return preview.model().triangles(false);
      }, definition.id);
      result[nation]!.push({ id: definition.id, triangles });
    }
  }
} finally { await browser.close(); await server.close(); }
writeFileSync("/tmp/claude-1000/-home-shadowvzs-personal/61fc239c-400e-43a9-a86b-0f00b45120e3/scratchpad/budget.json", JSON.stringify(result));
for (const [nation, rows] of Object.entries(result))
  console.log(nation, rows.filter(row => row.triangles > BUDGET).map(row => `${row.id}:${row.triangles}`).join(" "));
