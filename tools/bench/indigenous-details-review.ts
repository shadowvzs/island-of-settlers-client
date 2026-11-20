import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

const ids = process.argv[3] ? process.argv[3].split(",").map(Number) : [4, 3, 8, 39, 31, 35];
const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "indigenous-details-2026-11-05", run);
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard(), errors: string[] = [], reports: unknown[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on("request", request => guard.request(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=indigenous&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    for (const id of ids) {
      const facts = await page.evaluate(async id => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id, 5); await (window as any).__buildingResidentReady;
        preview.model().update(0, { construction: 1, door: 0, working: false });
        const paints: any[] = [];
        preview.model().root.traverse((mesh: any) => {
          if (!mesh.userData.visualPigment) return;
          paints.push({ vertices: mesh.geometry.attributes.position.count, transparent: mesh.material.transparent,
            map: Boolean(mesh.material.map?.image), depthWrite: mesh.material.depthWrite });
        });
        return { paints, triangles: preview.model().triangles(false) };
      }, id);
      if (id === 4) {
        assert.equal(facts.paints.length, 1, "Watchtower4 has one original owl painting");
        assert(facts.paints[0].vertices > 0 && facts.paints[0].transparent && facts.paints[0].map);
      }
      for (const [view, angle, elevation] of [["front", 0, .14], ["game", .65, .58]] as const) {
        await page.evaluate(({ angle, elevation }) => {
          const { camera, controls, framing, renderer, scene } = (window as any).__buildingPreview;
          const { centre, radius } = framing();
          const distance = radius / Math.sin(camera.fov * Math.PI / 360) * 1.03;
          camera.position.set(centre[0] + Math.sin(angle) * distance * Math.sqrt(1-elevation*elevation),
            centre[1] + distance * elevation,
            centre[2] + Math.cos(angle) * distance * Math.sqrt(1-elevation*elevation));
          controls.target.set(...centre); controls.update(); renderer.render(scene, camera);
          renderer.getContext().finish();
        }, { angle, elevation });
        await page.screenshot({ path: resolve(output, `${id}-${quality}-${view}.png`) });
      }
      reports.push({ id, quality, level: 5, ...facts });
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
const source = guard.finish();
writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports, source }, null, 2));
assert(source.stable, source.errors.join("\n"));
writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Indigenous watchtower, nearby baskets and well rear ornaments</title><style>body{background:#252921;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr)}img{width:100%}figure{margin:6px}</style><h1>Indigenous front paintings</h1><main>${ids.flatMap(id => ["high", "minimal"].flatMap(quality => ["front", "game"].map(view => `<figure><img src="${id}-${quality}-${view}.png"><figcaption>${id} · ${quality} · L5 · ${view}</figcaption></figure>`))).join("")}</main>`);
console.log(`Indigenous painting review: ${reports.length} canonical models, ${reports.length * 2} frames, stable requested sources; browser and server FULLCLOSED.`);
