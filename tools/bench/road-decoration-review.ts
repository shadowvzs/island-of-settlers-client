import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { roadDecorationModelReady } from "../../src/render-common/road-decoration-models";
import { ROAD_DECORATIONS } from "../../src/shared/settlement/road-decoration-catalog";
import { launchBrowser, startDevServer } from "./browser";

/** Staged original roadside art, real nation maps and roads; no app/UI/economy entry point is loaded. */
const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6);
const remaining = process.argv.includes("--remaining");
const ids = process.argv.find(argument => argument.startsWith("--ids="))?.slice(6).split(",");
const finishes = process.argv.includes("--finishes");
if (ids?.some(id => !ROAD_DECORATIONS.some(definition => definition.id === id))) throw new Error("Unknown review model ID");
const firstBatch = new Set(["roman-arch", "torii", "stone-lantern", "maya-portal"]);
if (run && !/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid road-decoration review run name");
const output = resolve("../resources/project-reviews/road-decoration-prototypes-2026-11-03", run ?? ".");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const detailed of [true, false]) {
    const quality = detailed ? "high" : "minimal";
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/road-decoration-prototype.html", route => route.fulfill({
      body: "<body style='margin:0'></body>", contentType: "text/html" }));
    await page.goto(`${url}road-decoration-prototype.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createRoadDecorationRecipe } = await imp("/src/render-common/road-decoration-models.ts");
      const { createRoadDecorationModel } = await imp("/src/renderers/three/road-decoration-model.ts");
      const { getRoadDecoration } = await imp("/src/shared/settlement/road-decoration-catalog.ts");
      const { planRoadDecorationPlacement } = await imp("/src/shared/settlement/road-decoration-placement.ts");
      const { createThreeRoads } = await imp("/src/renderers/three/settlement/three-roads.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(1000, 760);
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = detailed;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c1c9b1");
      scene.add(new t.HemisphereLight("#fff2d8", "#6b785c", 2.2));
      const sun = new t.DirectionalLight("#fff0d6", 2.6); sun.position.set(-3, 7, 5);
      sun.castShadow = detailed; sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4, near: .1, far: 20 });
      sun.shadow.normalBias = .012; scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(40, 40), new t.MeshStandardMaterial({
        color: "#8d9970", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.012; ground.receiveShadow = true; scene.add(ground);
      const world = { cellsX: 16, cellsZ: 16, heights: new Float32Array(17 ** 2), blocking: new Uint8Array(16 ** 2),
        buildRevision: 0, terrainRevision: 0 };
      const roads = createThreeRoads(world, detailed ? "high" : "minimal");
      roads.update([{ start: { x: 8, z: 0 }, end: { x: 8, z: 16 }, tier: "stone" }]);
      roads.root.position.set(-8, 0, -8);
      roads.root.children.filter((child: any) => child.isLight).forEach((child: any) => child.removeFromParent());
      scene.add(roads.root);
      const base = createRomanMaterials(detailed), packs = new Map<string, any>();
      const camera = new t.PerspectiveCamera(35, 1000 / 760, .05, 60);
      let model: any = null, height = 1, centerX = 0;
      const api = {
        select: ({ id, stoneFamily }: { id: string; stoneFamily?: string }) => {
          model?.dispose();
          const definition = getRoadDecoration(id);
          let pack = base;
          if (definition.nation !== "roman") {
            if (!packs.has(definition.nation)) packs.set(definition.nation,
              createNationBuildingMaterials(base.materials, definition.nation, detailed));
            pack = packs.get(definition.nation);
          }
          model = createRoadDecorationModel(createRoadDecorationRecipe(definition, detailed, stoneFamily), pack.materials, detailed);
          const edge = { start: { x: 0, z: -4 }, end: { x: 0, z: 4 }, tier: "stone" };
          const placement = planRoadDecorationPlacement({ decoration: id,
            position: { x: definition.opening ? 0 : 1, z: 0 }, yaw: 0 },
            { nation: definition.nation, roads: [edge], heightAt: () => 0, isOwned: () => true,
              isFree: () => true });
          if (!placement.ok) throw new Error(`Invalid road decoration fixture: ${placement.reason}`);
          model.root.position.set(...placement.position); model.root.rotation.y = placement.yaw;
          centerX = placement.position[0];
          scene.add(model.root);
          const bounds = new t.Box3().setFromObject(model.root); height = bounds.max.y;
          return { id, stoneFamily: stoneFamily ?? definition.stone?.defaultFamily,
            triangles: model.triangles, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
        },
        draw: (view: string) => {
          const roadside = height < 1.5, distance = roadside ? 2.3 : 7.4, x = centerX;
          camera.position.set(x + (view === "oblique" ? distance * .64 : 0),
            height * .55 + (view === "oblique" ? distance * .35 : 0), distance);
          camera.lookAt(x, height * .49, 0); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        },
        dispose: () => {
          model?.dispose(); roads.dispose(); ground.geometry.dispose(); ground.material.dispose();
          for (const pack of packs.values()) pack.dispose(); base.dispose(); renderer.dispose();
        }
      };
      (window as any).__roadDecorationReview = api;
    }, detailed);
    for (const definition of ROAD_DECORATIONS.filter(definition => roadDecorationModelReady(definition) &&
      (!remaining || !firstBatch.has(definition.family)) && (!ids || ids.includes(definition.id)))) {
      for (const stoneFamily of finishes ? definition.stone?.families ?? [undefined] : [undefined]) {
      const report = await page.evaluate(request => (window as any).__roadDecorationReview.select(request),
        { id: definition.id, stoneFamily });
      assert(report.triangles <= definition.triangles[detailed ? 0 : 1]);
      for (const view of ["front", "oblique"]) {
        const render = await page.evaluate(view => (window as any).__roadDecorationReview.draw(view), view);
        const label = definition.id + (stoneFamily ? `-${stoneFamily}` : "");
        await page.locator("canvas").screenshot({ path: resolve(output, `${quality}-${label}-${view}.png`) });
        reports.push({ ...report, quality, view, render });
      }
      }
    }
    await page.evaluate(() => (window as any).__roadDecorationReview.dispose());
    assert.deepEqual(errors, []); await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "staged art, visual acceptance pending", reports }, null, 2));
  console.log(`Captured ${reports.length} staged road-decoration views in ${output}`);
} finally { await browser.close(); await server.close(); }
