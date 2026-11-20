import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { setupWareIconRenderer } from "./ware-icon-renderer";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "canonical-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid coin review run name");
const output = resolve("../resources/project-reviews/single-coin-2026-11-03", run);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/single-coin.html", route => route.fulfill({ body: "<body style='margin:0;background:#d4c7ab'></body>", contentType: "text/html" }));
  await page.goto(`${url}single-coin.html`); await page.evaluate(setupWareIconRenderer);
  await page.evaluate(async () => {
    const { createWareModel } = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/ware-models.ts"));
    const { createWareRecipe } = await import(/* @vite-ignore */ String("/src/render-common/wares/ware-recipe.ts"));
    const { createRomanWaterStock } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/roman-water-stock.ts"));
    const { createWorkerWellBucket } = await import(/* @vite-ignore */ String("/src/renderers/three/worker-well-bucket.ts"));
    const { disposeMeshGeometries } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mesh-resources.ts"));
    const state = (window as any).__wareIcons;
    state.renderer.setSize(700, 700); document.body.append(state.renderer.domElement);
    (window as any).coin = {
      select: async ({ detailed, pose, ware }: { detailed: boolean; pose: string; ware: string }) => {
        state.coin?.dispose();
        if (ware === "water") {
          if (pose === "carry") {
            const root = createWorkerWellBucket(state.materialPack.materials, detailed, false, "nubian");
            state.coin = { root, triangles: () => 0, dispose: () => {
              disposeMeshGeometries(root); root.userData.disposeOwnedMaterials(); root.removeFromParent(); } };
          } else state.coin = createRomanWaterStock(state.materialPack.materials, detailed, pose === "compact", "nubian");
        } else state.coin = createWareModel("coins", detailed, state.materialPack.materials,
          pose === "carry" ? "carry" : "stock", pose === "compact" ? createWareRecipe("coins", detailed, true) : undefined);
        const model = state.coin; state.scene.add(model.root); model.root.updateMatrixWorld(true);
        const bounds = new state.three.Box3().setFromObject(model.root);
        const size = bounds.getSize(new state.three.Vector3()), factor = 1 / Math.max(size.x, size.y, size.z);
        model.root.scale.setScalar(factor); model.root.position.y = -bounds.min.y * factor + .012;
        state.coinCentre = size.y * factor / 2 + .012;
        const textures = new Set<any>();
        model.root.traverse((node: any) => { if (node.isMesh && node.material.map) textures.add(node.material.map); });
        await Promise.all([...textures].map(async texture => {
          if (texture.isDataTexture || texture.image instanceof HTMLCanvasElement) return;
          const started = performance.now();
          while (!texture.image?.complete) {
            if (performance.now() - started > 10000) throw new Error("Coin face texture failed to load");
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          await texture.image.decode();
        }));
        return { bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, triangles: model.triangles() };
      },
      draw: (face: boolean) => {
        const { camera, renderer, scene } = state;
        camera.position.set(face ? .1 : 2.5, (face ? 5 : 2.7) + state.coinCentre, face ? .1 : 4);
        camera.lookAt(0, state.coinCentre, 0); camera.left = camera.bottom = -.65; camera.right = camera.top = .65;
        camera.updateProjectionMatrix(); renderer.render(scene, camera);
      },
      dispose: () => { state.coin?.dispose(); state.materialPack.dispose(); state.reflection.dispose();
        state.ground.geometry.dispose(); state.ground.material.dispose(); state.renderer.dispose(); state.renderer.forceContextLoss(); }
    };
  });
  for (const ware of ["coins", "water"]) for (const detailed of [true, false]) for (const pose of ["stock", "carry", "compact"]) {
    const metrics = await page.evaluate(request => (window as any).coin.select(request), { detailed, pose, ware });
    for (const face of [true, false]) {
      await page.evaluate(face => (window as any).coin.draw(face), face);
      const name = `${ware}-${detailed ? "high" : "minimal"}-${pose}-${face ? "face" : "oblique"}`;
      await page.screenshot({ path: resolve(output, `${name}.png`) }); reports.push({ name, metrics });
    }
  }
  await page.evaluate(() => (window as any).coin.dispose()); assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors }, null, 2));
  console.log(`Captured ${reports.length} canonical single-coin views`);
} finally { await browser.close(); await server.close(); }
