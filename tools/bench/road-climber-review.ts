import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { launchBrowser, startDevServer } from "./browser";

const outAt = process.argv.indexOf("--out");
const output = resolve(outAt >= 0 ? process.argv[outAt + 1]! : "../resources/project-reviews/road-climbers-2026-11-06");
const benchShadows = process.argv.includes("--bench-shadows");
mkdirSync(output, { recursive: true });
const ids = [
  "roadDecoration:climbing-rose-white:native",
  "roadDecoration:climbing-rose-red:native",
  "roadDecoration:ivy-lattice:native"
];
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/climber-review.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}/climber-review.html`);
  for (const detailed of [true, false]) {
    await page.evaluate(async ({ benchShadows, detailed, ids }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const { createRoadDecorationState } = await imp("/src/shared/settlement/road-decoration-state.ts");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(1200, 800);
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = detailed && benchShadows; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#b9c6cb");
      scene.add(new t.HemisphereLight("#fff6e6", "#687b67", 2.2));
      const sun = new t.DirectionalLight("#fff2dc", 3);
      sun.position.set(-8, 18, 12); sun.castShadow = detailed && benchShadows;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
      sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
      scene.add(sun, sun.target);
      const ground = new t.Mesh(new t.PlaneGeometry(80, 80),
        new t.MeshStandardMaterial({ color: "#85966c", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = detailed && benchShadows;
      scene.add(ground);
      const owner = createThreeRoadDecorations({ cellsX: 64, cellsZ: 64,
        fogDisplayDisabled: true, fogRevision: 0 }, detailed,
      (nation: WorkerNation) => nation === "roman" ? createRomanMaterials(detailed).materials
        : createNationBuildingMaterials(createRomanMaterials(detailed).materials, nation, detailed).materials);
      scene.add(owner.root, owner.ghostRoot);
      const state = createRoadDecorationState(() => ({ nation: "roman", roads: [],
        heightAt: () => 0, isOwned: () => true, isFree: () => true }));
      for (const [index, item] of ids.entries()) {
        const placed = state.place({ item, position: { x: 3 + index * 2.7, z: 0 }, yaw: .45 }, () => true);
        if (!placed.ok) throw new Error(`Placement ${item}: ${JSON.stringify(placed)}`);
      }
      const saved = state.save(); state.load(saved);
      if (JSON.stringify(state.save()) !== JSON.stringify(saved)) throw new Error("Save identity changed");
      const frames = state.frames();
      const camera = new t.PerspectiveCamera(34, 1200 / 800, .01, 100);
      const render = async (close: boolean) => {
        const distance = close ? 6.5 : 12;
        camera.position.set(5.7, close ? 2.2 : 3.2, distance);
        camera.lookAt(5.7, 1.35, 0); camera.updateMatrixWorld(true);
        owner.update(frames, camera); await owner.ready(); renderer.render(scene, camera);
        const stats = owner.statistics();
        if (stats.instances !== ids.length || stats.pending || stats.errors)
          throw new Error(`Actual templates missing: ${JSON.stringify(stats)}`);
        return { detailed, close, stats, triangles: renderer.info.render.triangles,
          calls: renderer.info.render.calls, png: renderer.domElement.toDataURL("image/png") };
      };
      const result = { close: await render(true), normal: await render(false),
        saved, frames: (frames as Array<{ uid: number; item: string }>)
          .map(frame => ({ uid: frame.uid, item: frame.item })) };
      (window as any).__climberReview = result;
      owner.dispose(); ground.geometry.dispose(); ground.material.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }, { benchShadows, detailed, ids });
    const result = await page.evaluate(() => (window as any).__climberReview);
    for (const mode of ["close", "normal"] as const) {
      const image = result[mode].png as string;
      writeFileSync(resolve(output, `${detailed ? "high" : "minimal"}-${mode}.png`),
        Buffer.from(image.split(",")[1]!, "base64"));
      delete result[mode].png;
    }
    reports.push(result);
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    status: "Native source/runtime review of the three climber decorations; visual acceptance pending owner.",
    shadowPath: benchShadows ? "bench-only" : "game",
    ids, reports, errors
  }, null, 2));
  console.log(`Captured climber review: ${output}`);
} finally { await browser.close(); await server.close(); }
