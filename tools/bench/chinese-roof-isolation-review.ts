import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "building-art-completion-2026-11-03", process.argv[2] ?? "roof-isolation-a");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  await page.routeWebSocket("**/*", () => {}); await page.addInitScript("window.__name=value=>value;");
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=chinese&quality=${quality}&sample=1&building=0`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    const report = await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path), p = (window as any).__buildingPreview;
      const three = await imp("/node_modules/three/build/three.module.js");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { leveledBuildingRecipe } = await imp("/src/render-common/buildings/levels/leveled-building-recipe.ts");
      const { chineseRoofBeddingCells } = await imp("/src/render-common/buildings/chinese-roof-bedding.ts");
      const { createRomanPartGeometry } = await imp("/src/renderers/three/buildings/roman-building.ts");
      const recipe = leveledBuildingRecipe(getBuildingDefinition(0), "chinese", detailed, 1);
      const roof = recipe.parts.filter((part: any) => part.shape === "occupation-roof")
        .sort((a: any, b: any) => b.position[1] - a.position[1])[0];
      let material: any; p.model().root.traverse((node: any) => {
        if (!material && node.userData.buildingSurface === "roof") material = node.material;
      });
      const geometry = createRomanPartGeometry(roof, detailed), mesh = new three.Mesh(geometry, material);
      p.model().root.visible = false; p.scene.add(mesh); p.renderer.setAnimationLoop(null);
      const box = new three.Box3().setFromObject(mesh), centre = box.getCenter(new three.Vector3());
      const size = box.getSize(new three.Vector3()), reach = Math.max(size.x, size.z);
      p.camera.position.set(centre.x + reach * .8, centre.y + size.y * .4, box.max.z + reach * 1.05);
      p.camera.lookAt(centre); p.renderer.render(p.scene, p.camera);
      const triangle = (a: number[], b: number[], c: number[]) => {
        const ab = new three.Vector3(...b).sub(new three.Vector3(...a));
        const ac = new three.Vector3(...c).sub(new three.Vector3(...a));
        return ab.cross(ac).lengthSq() >= 1e-16 ? 3 : 0;
      };
      const quad = (a: number[], b: number[], c: number[], d: number[]) => triangle(a, b, c) + triangle(a, c, d);
      let count = 0;
      for (const cell of chineseRoofBeddingCells(roof, detailed)) {
        const points = cell.points, low = points.map((point: number[]) => [point[0]!, Math.max(-.5, point[1]! - .07), point[2]!]);
        count += quad(points[0]!, points[1]!, points[2]!, points[3]!) + quad(low[0]!, low[1]!, low[2]!, low[3]!);
        for (const edge of cell.outside) {
          const next = (edge + 1) % 4; count += quad(points[edge]!, points[next]!, low[next]!, low[edge]!);
        }
      }
      (window as any).__roofIsolation = { geometry, p, count };
      return { coreIndices: count, fullIndices: geometry.index?.count ?? geometry.getAttribute("position").count };
    }, quality === "high");
    await page.screenshot({ path: resolve(output, `${quality}-full-roof.png`) });
    await page.evaluate(() => { const { count, geometry, p } = (window as any).__roofIsolation;
      geometry.setDrawRange(0, count); p.renderer.render(p.scene, p.camera); });
    await page.screenshot({ path: resolve(output, `${quality}-bedding-only.png`) }); reports.push({ quality, ...report });
  }
  assert(reports.length === 2); writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(`Chinese roof isolation CLOSED: ${output}`);
