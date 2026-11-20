import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "japanese-interior-floors-2026-11-04", `monument-${run}`);
assert(!existsSync(resolve(output, "report.json")), "Preserve native evidence"); mkdirSync(output, { recursive: true });
const paths = ["src/renderers/three/buildings/japanese-monument-floor.ts", "src/renderers/three/buildings/monument-building.ts",
  "src/renderers/three/buildings/nation-building.ts", "assets/monuments/japanese-high.glb",
  "assets/monuments/japanese-minimal.glb", "assets/monuments/japanese-continuous-high.glb",
  "assets/monuments/japanese-continuous-minimal.glb", "tools/bench/japanese-monument-floor-review.ts"];
const hashes = () => Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), rows: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {}); page.on("pageerror", error => errors.push(error.message));
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=japanese&quality=${quality}&building=7&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(async () => { await (window as any).__buildingResidentReady; });
    const full = await page.evaluate(() => {
      const p = (window as any).__buildingPreview; p.renderer.setAnimationLoop(null);
      const model = p.model(); model.update(0, { construction: 1, door: 0, working: false });
      let floor: any, base: any;
      model.root.traverse((object: any) => {
        if (object.userData.japaneseInteriorFloor) floor = object;
        if (object.userData.japaneseInteriorFloorBase) base = object;
      });
      if (!floor || !base || !floor.material.map) throw new Error("Actual imported Monument must contain the cedar room floor");
      const color = floor.geometry.getAttribute("color");
      if (!color || !Array.from(color.array).every(value => value === 1))
        throw new Error("Borrowed vertex-colored floor material requires neutral geometry colors");
      p.renderer.render(p.scene, p.camera);
      return { triangles: model.triangles(), floorTriangles: floor.geometry.getAttribute("position").count / 3,
        stoneTriangles: base.geometry.getAttribute("position").count / 3,
        oldStoneTriangles: base.userData.japaneseInteriorFloorBase.sourceTriangles,
        calls: p.renderer.info.render.calls, floorMapWidth: floor.material.map.image.width };
    });
    await page.screenshot({ path: resolve(output, `${quality}-full.png`) });
    const cutaway = await page.evaluate(async () => {
      const t = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const p = (window as any).__buildingPreview, model = p.model();
      let floor: any;
      model.root.traverse((object: any) => {
        if (!object.isMesh) return;
        if (object.userData.japaneseInteriorFloor) floor = object;
        object.visible = Boolean(object.userData.japaneseInteriorFloor || object.userData.japaneseInteriorFloorBase ||
          object.name.replace(/[._]/g, "") === "Foundationstone");
      });
      const box = new t.Box3().setFromObject(floor), center = box.getCenter(new t.Vector3());
      const span = Math.max(box.getSize(new t.Vector3()).x, box.getSize(new t.Vector3()).z);
      p.camera.position.copy(center).add(new t.Vector3(span * .55, span * 1.4, span)); p.camera.lookAt(center);
      p.camera.updateMatrixWorld(true);
      if (p.camera.isOrthographicCamera) {
        let extent = 0;
        for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
          const projected = new t.Vector3(x, center.y, z).project(p.camera);
          extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y));
        }
        p.camera.zoom *= .78 / extent; p.camera.updateProjectionMatrix();
      }
      p.renderer.render(p.scene, p.camera);
      return { floorBounds: { min: box.min.toArray(), max: box.max.toArray() }, calls: p.renderer.info.render.calls };
    });
    await page.screenshot({ path: resolve(output, `${quality}-cutaway.png`) });
    rows.push({ quality, full, cutaway });
    await page.evaluate(() => {
      const p = (window as any).__buildingPreview; p.model().root.removeFromParent(); p.model().dispose();
    });
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before, "Model/source/asset changed during capture");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors, sourceHashes: before,
    scope: "Actual imported Monument factory plus explicit roof/wall-hidden floor diagnostic; original four GLBs unchanged",
    visualInspectionRequired: true }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Japanese Monument room floors</title>
    <style>body{background:#252922;color:#eee;font:16px sans-serif}img{max-width:96vw;width:1000px}</style>
    <h1>Actual Japanese Monument and explicit floor cutaway</h1>${["high", "minimal"].flatMap(quality =>
    ["full", "cutaway"].map(view => `<figure><figcaption>${quality} ${view}</figcaption>
    <img src="${quality}-${view}.png"></figure>`)).join("")}`);
  console.log(`Japanese Monument floors CLOSED:4frames, ${output}`);
} finally { await browser.close(); await server.close(); }
