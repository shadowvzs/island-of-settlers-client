import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { MONUMENT_ASSETS } from "../../src/render-common/buildings/monument-definition";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "monument-assets");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
await server.warmupRequest("/src/building-showcase/main.ts");
await server.waitForRequestsIdle();
const reports: unknown[] = [], errors: string[] = [];
let phase = "launch";
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.routeWebSocket("**/*", () => {});
  for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
    const specification = MONUMENT_ASSETS[nation];
    for (const quality of ["high", "minimal"] as const) {
      phase = `${nation}/${quality}`;
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&building=7&sample=1`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 90_000 });
      await page.evaluate(async () => { await (window as any).__buildingResidentReady; });
      const measured = await page.evaluate(async () => {
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null);
        const model = preview.model(); model.update(0, { construction: 1, door: 0, working: false });
        preview.renderer.render(preview.scene, preview.camera);
        const { monumentAssetStats } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/monument-building.ts"));
        const maps: { role: string; colorSpace: string; width: number; height: number }[] = [], materials = new Set<any>();
        model.root.traverse((object: any) => {
          if (!object.isMesh) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        });
        for (const material of materials) for (const role of ["map", "normalMap", "roughnessMap", "metalnessMap"]) {
          const texture = material[role];
          if (texture) maps.push({ role, colorSpace: texture.colorSpace, width: texture.image.width, height: texture.image.height });
        }
        const { buildingAssetReady, createMonumentBuilding } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/monument-building.ts"));
        let floorMaterial: any;
        model.root.traverse((object: any) => {
          if (object.userData.japaneseInteriorFloor) floorMaterial = object.material;
        });
        const second = createMonumentBuilding(model.root.userData.nation, !location.search.includes("quality=minimal"), floorMaterial);
        await buildingAssetReady(second.root);
        const firstMeshes: any[] = [], secondMeshes: any[] = [];
        model.root.traverse((object: any) => { if (object.isMesh) firstMeshes.push(object); });
        second.root.traverse((object: any) => { if (object.isMesh) secondMeshes.push(object); });
        let floorTriangleDelta = 0;
        for (const mesh of firstMeshes) {
          const count = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
          if (mesh.userData.japaneseInteriorFloor) floorTriangleDelta += count;
          if (mesh.userData.japaneseInteriorFloorBase)
            floorTriangleDelta += count - mesh.userData.japaneseInteriorFloorBase.sourceTriangles;
        }
        const shared = { geometry: firstMeshes.every((mesh, index) =>
          mesh.userData.japaneseInteriorFloor || mesh.userData.japaneseInteriorFloorBase
            ? mesh.geometry !== secondMeshes[index].geometry : mesh.geometry === secondMeshes[index].geometry),
          textures: firstMeshes.every((mesh, index) => mesh.material.map === secondMeshes[index].material.map),
          separateMaterials: firstMeshes.every((mesh, index) => mesh.material !== secondMeshes[index].material),
          during: monumentAssetStats() };
        second.dispose();
        return { shared, floorTriangleDelta, triangles: model.triangles(), maps, sources: monumentAssetStats(), calls: preview.renderer.info.render.calls,
          drawTriangles: preview.renderer.info.render.triangles, memory: { ...preview.renderer.info.memory } };
      });
      assert.equal(measured.triangles, specification[quality] + measured.floorTriangleDelta);
      assert.deepEqual({ geometry: measured.shared.geometry, textures: measured.shared.textures, separateMaterials: measured.shared.separateMaterials },
        { geometry: true, textures: true, separateMaterials: true });
      assert.equal(measured.shared.during.references, 2);
      assert.equal(measured.sources.assets, 1); assert.equal(measured.sources.references, 1);
      assert(measured.maps.length > 0);
      for (const map of measured.maps) assert.equal(map.colorSpace, map.role === "map" ? "srgb" : "");
      await page.screenshot({ path: resolve(output, `${nation}-${quality}.png`) });
      if (quality === "high") {
        await page.setViewportSize({ width: 240, height: 180 });
        await page.evaluate(() => { const preview = (window as any).__buildingPreview;
          preview.selectBuilding(7); });
        await page.evaluate(async () => { await (window as any).__buildingResidentReady;
          const preview = (window as any).__buildingPreview; preview.renderer.render(preview.scene, preview.camera); });
        await page.screenshot({ path: resolve(`assets/building-icons/${nation}-7.png`) });
        await page.setViewportSize({ width: 1000, height: 1000 });
      }
      const released = await page.evaluate(async () => {
        (window as any).__buildingPreview.selectBuilding(20);
        await (window as any).__buildingResidentReady;
        const { monumentAssetStats } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/monument-building.ts"));
        return monumentAssetStats();
      });
      assert.deepEqual(released, { assets: 0, pending: 0, references: 0 });
      reports.push({ nation, quality, measured, released });
      writeFileSync(resolve(output, "review.json"), JSON.stringify({ reports, errors }, null, 2));
    }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  writeFileSync(resolve(output, "failure.json"), JSON.stringify({ phase, errors, error: String(error),
    url: page.url(), body: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2));
  throw error;
} finally { await browser.close(); await server.close(); }
console.log(`Monument asset review: ${reports.length} native assets, correct PBR maps and exact lease release`);
