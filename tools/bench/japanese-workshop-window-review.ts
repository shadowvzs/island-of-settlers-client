import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { renderGallerySheet } from "./building-gallery-render";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

const attempt = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(attempt));
const output = resourcesPath("project-reviews", "japanese-owner-windows-2026-11-05", attempt);
assert(!existsSync(output), "Keep every native attempt; use a fresh attempt ID");
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard();
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], reports: unknown[] = [];
const deadline = Date.now() + 240_000;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 1 });
  page.on("request", request => guard.request(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const quality of ["high", "minimal"] as const) {
    await page.goto(`${url}building-showcase.html?nation=japanese&quality=${quality}&sample=17`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 90_000 });
    const tiles: { encoded: string; label: string }[] = [];
    for (const id of [0, 17, 19, 20, 41, 42, 43, 53]) for (const level of [1, 5]) {
      assert(Date.now() < deadline, "Bounded four-minute native review deadline");
      const render = page.evaluate(async ({ id, level }) => {
        const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null); preview.controls.enabled = false;
        preview.selectBuilding(id, level); await (window as any).__buildingResidentReady;
        const model = preview.model(); model.update(0, { construction: 1, door: 0, working: false });
        model.root.updateMatrixWorld(true);
        const textureDeadline = performance.now() + 10_000;
        for (;;) {
          let waiting = false;
          model.root.traverse((object: any) => {
            if (!object.isMesh) return;
            for (const material of Array.isArray(object.material) ? object.material : [object.material])
              for (const map of [material.map, material.normalMap]) if (map && !map.image?.width) waiting = true;
          });
          if (!waiting) break;
          if (performance.now() > textureDeadline) throw new Error("Native texture residency deadline");
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const box = new three.Box3().setFromObject(model.root), centre = box.getCenter(new three.Vector3());
        const size = box.getSize(new three.Vector3()), camera = preview.camera.clone();
        camera.aspect = 900 / 760; camera.updateProjectionMatrix();
        const distance = size.length() / 2 / Math.sin(camera.fov * Math.PI / 360) * 1.04;
        const images: { view: string; encoded: string }[] = [];
        for (const view of ["front-close", "rear-close", "front-gameplay"]) {
          const direction = new three.Vector3(4.5, 3.2, 5.5).normalize();
          if (view === "rear-close") direction.set(-4.5, 3.2, -5.5).normalize();
          camera.position.copy(centre).addScaledVector(direction, distance * (view === "front-gameplay" ? 1.8 : 1));
          camera.lookAt(centre); camera.updateMatrixWorld(true);
          preview.renderer.render(preview.scene, camera);
          images.push({ view, encoded: preview.renderer.domElement.toDataURL("image/jpeg", .92).split(",")[1] });
        }
        return { images, triangles: model.triangles(false), parts: model.recipe.parts.length };
      }, { id, level });
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([render, new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("Thirty-second native model deadline")), 30_000);
      })]).finally(() => clearTimeout(watchdog));
      for (const image of result.images) {
        const file = `${quality}-${id}-l${level}-${image.view}.jpg`;
        writeFileSync(resolve(output, file), Buffer.from(image.encoded, "base64"));
        if (image.view === "front-close") tiles.push({ encoded: image.encoded, label: `${quality} ${id} L${level}` });
      }
      reports.push({ quality, id, level, triangles: result.triangles, parts: result.parts });
    }
    for (let offset = 0; offset < tiles.length; offset += 8) {
      const encoded = await page.evaluate(renderGallerySheet, tiles.slice(offset, offset + 8));
      writeFileSync(resolve(output, `${quality}-sheet-${offset / 8}.jpg`), Buffer.from(encoded, "base64"));
    }
  }
  assert.deepEqual(errors, []);
  const sourceManifest = guard.finish();
  assert(sourceManifest.stable, sourceManifest.errors.join("\n"));
  writeFileSync(resolve(output, "source-manifest.json"), JSON.stringify(sourceManifest, null, 2));
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports, frames: reports.length * 3,
    sourceStable: sourceManifest.stable }, null, 2));
  console.log(JSON.stringify({ output, models: reports.length, frames: reports.length * 3, errors }));
} finally { await browser?.close(); await server.close(); }
