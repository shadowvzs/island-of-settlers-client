import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/project-reviews/hanging-lantern-2026-11-04/native-a");
const actorReceiptPath = "../resources/project-reviews/road-decoration-prototypes-2026-11-03/actual-actor-clearance/report.json";
const actorReceiptBytes = readFileSync(resolve(actorReceiptPath));
const actorReceipt = JSON.parse(actorReceiptBytes.toString());
const actorReceiptHash = createHash("sha256").update(actorReceiptBytes).digest("hex");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/hanging-lantern.html", route => route.fulfill({
      body: "<body style='margin:0'></body>", contentType: "text/html"
    }));
    await page.goto(`${url}hanging-lantern.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createHangingLanternRoadModel } = await imp("/src/renderers/three/road-decoration-hanging-lanterns.ts");
      const { createWisteriaGeometryClearance } = await imp("/src/renderers/three/wisteria-geometry-clearance.ts");
      const { CART_STONE_LANE, HANDCART } = await imp("/src/render-common/logistics/handcart-rules.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1000, 760); renderer.setPixelRatio(1);
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = detailed;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c1c9b1");
      scene.add(new t.HemisphereLight("#fff2d8", "#6b785c", 2.2));
      const sun = new t.DirectionalLight("#fff0d6", 2.6); sun.position.set(-3, 7, 5);
      sun.castShadow = detailed; sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4, near: .1, far: 20 });
      sun.shadow.normalBias = .012; scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(40, 40),
        new t.MeshStandardMaterial({ color: "#8d9970", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.012;
      ground.receiveShadow = true; scene.add(ground);
      const base = createRomanMaterials(detailed), packs = new Map<string, any>();
      const camera = new t.PerspectiveCamera(35, 1000 / 760, .03, 60);
      let model: any, bounds: any;
      (window as any).lanternReview = {
        select: (nation: string) => {
          model?.dispose();
          if (!packs.has(nation)) packs.set(nation, createNationBuildingMaterials(base.materials, nation, detailed));
          model = createHangingLanternRoadModel(nation, detailed, packs.get(nation).materials);
          scene.add(model.root); bounds = new t.Box3().setFromObject(model.root);
          return { triangles: model.triangles, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
        },
        draw: (view: string) => {
          const center = bounds.getCenter(new t.Vector3());
          if (view === "detail") { center.set(1.45, 2.08, .25); camera.position.set(2.7, 2.7, 2.6); }
          else {
            const distance = Math.max(bounds.getSize(new t.Vector3()).x, 3) * 2.1;
            camera.position.copy(center).add(new t.Vector3(view === "gameplay" ? distance * .6 : 0,
              view === "gameplay" ? distance * .6 : .1, distance));
          }
          camera.lookAt(center); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
        },
        clearance: (receipt: any) => {
          const collision = createWisteriaGeometryClearance(model.root);
          const sweep = (entry: any, lane: number, margin: number) => {
            const box = new t.Box3(new t.Vector3(...entry.bounds.min), new t.Vector3(...entry.bounds.max));
            box.min.x += lane; box.max.x += lane; box.min.z = -2; box.max.z = 2;
            return !collision.intersects(box.expandByScalar(margin));
          };
          return {
            mounted: receipt.mounted.map((entry: any) => ({ quality: entry.quality, nation: entry.nation,
              pose: entry.pose, centerClear: sweep(entry, 0, .03),
              lanesClear: [-CART_STONE_LANE, CART_STONE_LANE].every(lane => sweep(entry, lane, .03)) })),
            carts: receipt.carts.map((entry: any) => ({ quality: entry.quality, ware: entry.ware,
              lanesClear: [-CART_STONE_LANE, CART_STONE_LANE].every(lane => sweep(entry, lane, HANDCART.clearance)) }))
          };
        },
        dispose: () => {
          model?.dispose(); for (const pack of packs.values()) pack.dispose(); base.dispose();
          ground.geometry.dispose(); ground.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
        }
      };
    }, detailed);
    for (const nation of ["japanese", "chinese"]) {
      const metadata = await page.evaluate(nation => (window as any).lanternReview.select(nation), nation);
      assert(metadata.triangles <= (detailed ? 7000 : 1800), `${nation} canonical portal budget`);
      const clearance = await page.evaluate(receipt => (window as any).lanternReview.clearance(receipt), actorReceipt);
      writeFileSync(resolve(output, `${detailed ? "high" : "minimal"}-${nation}-clearance.json`),
        JSON.stringify(clearance, null, 2));
      assert(clearance.mounted.every((entry: any) => entry.centerClear && entry.lanesClear), `${nation} mounted sweep`);
      assert(clearance.carts.every((entry: any) => entry.lanesClear), `${nation} loaded cart sweep`);
      for (const view of ["front", "detail", "gameplay"]) {
        const stats = await page.evaluate(view => (window as any).lanternReview.draw(view), view);
        const name = `${detailed ? "high" : "minimal"}-${nation}-${view}`;
        await page.screenshot({ path: resolve(output, `${name}.png`) }); reports.push({ name, ...metadata, stats });
      }
    }
    await page.evaluate(() => (window as any).lanternReview.dispose());
    assert.deepEqual(errors, []); await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    status: "Unregistered private art studies; owner acceptance and live navigation remain pending",
    clearanceScope: "Current lantern triangles against frozen actual posed actor/cart bounds from the linked November4 receipt; flat sweeps only, actors not re-rendered.",
    actorReceiptPath, actorReceiptHash, reports
  }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Hanging lantern studies</title>
    <style>body{background:#20231f;color:#eee;font:16px sans-serif}img{max-width:96vw;width:900px}figure{margin:24px}</style>
    <h1>Private hanging-lantern studies — owner acceptance pending</h1>${reports.map((report: any) =>
    `<figure><figcaption>${report.name} · ${report.triangles} triangles</figcaption><img src="${report.name}.png"></figure>`).join("")}`);
  console.log(`Captured ${reports.length} hanging-lantern views in ${output}`);
} finally { await browser.close(); await server.close(); }
