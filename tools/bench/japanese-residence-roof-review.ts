import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { renderGalleryCase } from "./building-gallery-render";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "japanese-residence-roof-2026-11-04", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve prior evidence; choose a fresh run ID");
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard(), errors: string[] = [], results: unknown[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 768, height: 640 } });
  page.on("request", request => guard.request(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const quality of ["high", "minimal"] as const) {
    await page.goto(`${url}building-showcase.html?nation=japanese&quality=${quality}&sample=1&building=57`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120_000 });
    for (const level of [1, 5] as const) {
      const input: Parameters<typeof renderGalleryCase>[0] = {
        entry: { id: 57, level, name: "Small residence", nation: "japanese", quality }, views: ["front"]
      };
      const result = await page.evaluate(renderGalleryCase, input);
      assert(result.withinBudget, `${quality}/${level} exceeds the existing cap`);
      writeFileSync(resolve(output, `${quality}-l${level}-whole.jpg`), Buffer.from(result.images[0]!.encoded, "base64"));
      const roof = await page.evaluate(async () => {
        const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const preview = (window as any).__buildingPreview, model = preview.model();
        const box = new three.Box3().setFromObject(model.root), size = box.getSize(new three.Vector3());
        const centre = box.getCenter(new three.Vector3());
        centre.y = box.min.y + size.y * .7;
        const camera = preview.camera.clone();
        camera.aspect = 768 / 640;
        const vertical = camera.fov * Math.PI / 360;
        const distance = size.length() / 2 / Math.sin(vertical) * .78;
        camera.position.copy(centre).addScaledVector(new three.Vector3(4.5, 3.2, 5.5).normalize(), distance);
        camera.lookAt(centre); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        preview.renderer.render(preview.scene, camera);
        return preview.renderer.domElement.toDataURL("image/jpeg", .94).split(",")[1];
      });
      writeFileSync(resolve(output, `${quality}-l${level}-roof.jpg`), Buffer.from(roof, "base64"));
      const { images: _images, ...metrics } = result;
      results.push({ quality, level, ...metrics });
    }
  }
  const source = guard.finish();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    passed: errors.length === 0 && source.stable, errors, results, source,
    scope: "Actual Japanese residence57, levels1/5, High/Minimal whole and roof close; eight images."
  }, null, 2));
  assert.deepEqual(errors, []);
  assert(source.stable, "Actual source changed during capture");
} finally {
  await browser?.close();
  await server.close();
}
const files = ["high", "minimal"].flatMap(quality => [1, 5].flatMap(level =>
  ["whole", "roof"].map(view => `${quality}-l${level}-${view}.jpg`)));
writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Japanese small residence roof</title>
<style>body{background:#252c25;color:white;font-family:sans-serif}figure{display:inline-block;width:47%;margin:1%}img{width:100%}</style>
<h1>Japanese small residence — coherent kawara roof</h1>${files.map(file =>
  `<figure><img src="${file}"><figcaption>${file}</figcaption></figure>`).join("")}`);
console.log(`Japanese small residence roof review FULLY CLOSED: ${output}`);
