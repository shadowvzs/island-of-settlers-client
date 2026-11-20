import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a", quarryOnly = run.startsWith("quarry-");
const narrowProof = run === "quarry-f-proof";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "indigenous-resource-workshops-2026-11-05", run);
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard(), errors: string[] = [], reports: unknown[] = [];
let frames = 0;
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on("request", request => guard.request(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  const qualities = run.endsWith("-minimal") ? ["minimal"] : ["high", "minimal"];
  for (const quality of qualities) {
    await page.goto(`${url}building-showcase.html?nation=indigenous&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    let ids = quarryOnly ? [19, 43, 47, 51, 55] : [19, 20, 41, 43, 45, 47, 49, 51, 53, 55];
    if (narrowProof) ids = [19, 51];
    for (const id of ids) {
      let levels = id < 21 ? [1, 2, 3, 4, 5] : [5];
      if (quarryOnly && id === 19) levels = [1, 5];
      if (run.endsWith("-full")) levels = [1, 2, 3, 4, 5];
      if (narrowProof && id === 19) levels = [1, 2, 3, 4, 5];
      for (const level of levels) {
        const facts = await page.evaluate(async ({ id, level }) => {
          const preview = (window as any).__buildingPreview;
          preview.selectBuilding(id, level); await (window as any).__buildingResidentReady;
          preview.model().update(0, { construction: 1, door: 1, working: true });
          const stone: { width: number; height: number; normal: boolean }[] = [];
          let paintings = 0;
          preview.model().root.traverse((object: any) => {
            if (object.userData.visualPigment) paintings++;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) {
              if (material?.name !== "indigenous_quarry_stone") continue;
              stone.push({ width: material.map.image.width, height: material.map.image.height,
                normal: Boolean(material.normalMap) });
            }
          });
          return { paintings, stone, triangles: preview.model().triangles(false) };
        }, { id, level });
        if ([19, 43, 47, 51, 55].includes(id)) {
          assert.equal(facts.stone.length, 1, "one private quarry mineral batch");
          assert.equal(facts.stone[0]!.width, quality === "high" ? 256 : 128);
          assert.equal(facts.stone[0]!.normal, quality === "high");
          assert.equal(facts.paintings, 1, "one complete wall-conforming occupation painting");
        }
        const standardViews = [
          ["front", .30, .30, 1.04], ["back", Math.PI + .55, .45, 1.04], ["game", .65, .62, 1.85]
        ] as const;
        let views: readonly (readonly [string, number, number, number])[] = standardViews;
        if (narrowProof && id === 19) {
          views = [["front-closed", .30, .30, 1.04]];
          if (level === 5) views = [...views, ...standardViews];
        }
        for (const [view, angle, elevation, zoom] of views) {
          await page.evaluate(({ angle, closed, elevation, zoom }) => {
            const { camera, controls, framing, renderer, scene } = (window as any).__buildingPreview;
            (window as any).__buildingPreview.model().update(0,
              { construction: 1, door: closed ? 0 : 1, working: !closed });
            const { centre, radius } = framing();
            const distance = radius / Math.sin(camera.fov * Math.PI / 360) * zoom;
            camera.position.set(centre[0] + Math.sin(angle) * distance * Math.sqrt(1 - elevation * elevation),
              centre[1] + distance * elevation,
              centre[2] + Math.cos(angle) * distance * Math.sqrt(1 - elevation * elevation));
            controls.target.set(...centre); controls.update(); renderer.render(scene, camera);
            renderer.getContext().finish();
          }, { angle, closed: view === "front-closed", elevation, zoom });
          await page.screenshot({ path: resolve(output, `${id}-L${level}-${quality}-${view}.png`) });
          frames++;
          if (run.endsWith("-full") && id === 19 && [1, 5].includes(level) && view === "front") {
            await page.evaluate(() => {
              const preview = (window as any).__buildingPreview;
              preview.model().update(0, { construction: 1, door: 0, working: false });
              preview.renderer.render(preview.scene, preview.camera); preview.renderer.getContext().finish();
            });
            await page.screenshot({ path: resolve(output, `${id}-L${level}-${quality}-front-closed.png`) });
            frames++;
            await page.evaluate(() => {
              const preview = (window as any).__buildingPreview;
              preview.model().update(0, { construction: 1, door: 1, working: true });
            });
          }
        }
        reports.push({ id, quality, level, ...facts });
      }
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
const source = guard.finish();
writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, frames, reports, source }, null, 2));
assert(source.stable, source.errors.join("\n"));
console.log(`Resource workshops: ${reports.length} models / ${frames} frames; browser and server FULLCLOSED.`);
