import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { buildingFamilyId, buildingTriangleBudget } from "../../src/render-common/buildings/building-triangle-budgets";
import { BUILDING_LEVELS } from "../../src/render-common/buildings/levels/building-level";
import { launchBrowser, startDevServer } from "./browser";
import { checkTriangleBudget } from "./triangle-budget";

/** Every catalog type, nation, level and detail using the native showcase's real mesh counts.
 * Same caps as the existing asset export; levels receive no implicit budget increase.
 * Live residents are excluded. Writes failures to a JSON report before exiting nonzero.
 */
const nativeBudgets: Record<string, Record<number, readonly [number, number]>> = {
  japanese: { 0: [26000, 4500], 29: [14000, 2850], 34: [26000, 4500],
    15: [12000, 2300], 42: [11800, 2700], 44: [11000, 2900] },
  nubian: { 15: [12000, 2300], 44: [11000, 3200] },
  viking: { 0: [17000, 4000], 15: [12000, 2300] }
};
const output = resolve(process.env.OUT ?? "../resources/building-level-budget-review");
const ids = new Set((process.env.IDS ?? "").split(",").filter(Boolean).map(Number));
const reports: unknown[] = [];
let failures = 0, warnings = 0;
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
    for (const quality of ["high", "minimal"] as const) {
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
      for (const definition of BUILDING_CATALOG.filter(entry => !ids.size || ids.has(entry.id))) {
        let baseline = 0;
        for (const level of BUILDING_LEVELS) {
          const triangles = await page.evaluate(async ({ id, level }) => {
            const preview = (window as any).__buildingPreview;
            preview.selectBuilding(id, level);
            await (window as any).__buildingResidentReady;
            return preview.model().triangles(false) as number;
          }, { id: definition.id, level });
          if (level === 1) baseline = triangles;
          const family = buildingFamilyId(definition.id);
          const budgets = nativeBudgets[nation]?.[family] ?? buildingTriangleBudget(definition.id);
          // Roman's existing export uses 10000 for ordinary buildings at either detail.
          const specialist = family >= 41 && family <= 44;
          const budget = nation === "roman" && !specialist ? 10000 : budgets[quality === "high" ? 0 : 1]!;
          const status = checkTriangleBudget(triangles, budget);
          if (status === "fail") failures++;
          if (status === "warn") warnings++;
          reports.push({ nation, quality, id: definition.id, name: definition.name, level,
            triangles, addedTriangles: triangles - baseline, budget, status });
        }
      }
    }
    console.log(`${nation}: mesh counts collected`);
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "budget-review.json"), JSON.stringify({
    note: "Native mesh budget audit; no visual or gameplay acceptance performed.", failures, warnings, errors, reports
  }, null, 2));
  console.log(`${reports.length} variants; ${failures} failures; ${warnings} warnings. ${output}/budget-review.json`);
  if (failures || errors.length) process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
