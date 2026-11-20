import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
const materialOnly = process.argv.includes("--material-only");
const geometryOnly = process.argv.includes("--geometry-only");
const farOnly = process.argv.includes("--far-only");
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid shrub review run");
const output = resolve("../resources/project-reviews/roadside-shrubs-2026-11-04", run);
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/plants/roadside-shrub-graph.ts",
  "src/renderers/three/plants/roadside-shrub-foliage.ts", "src/renderers/three/plants/roadside-shrub-materials.ts",
  "src/renderers/three/plants/roadside-shrub-model.ts", "src/renderers/three/plants/roadside-shrub-pot.ts",
  "src/renderers/three/plants/roadside-shrub-stem.ts",
  "src/renderers/three/plants/roadside-shrub-far.ts",
  "src/renderers/three/plants/roadside-shrub-textures.ts", "src/renderers/three/plants/bonsai-pot-geometry.ts",
  "src/renderers/three/plants/ornamental-shoot-geometry.ts", "src/renderers/three/plants/ornamental-wood-geometry.ts"];
const hashes = () => Object.fromEntries(sources.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [], errors: string[] = [];
try {
  let qualities = geometryOnly ? ["high", "minimal", "far"] : ["high", "minimal"];
  if (farOnly) qualities = ["far"];
  for (const quality of qualities) {
    const detailed = quality === "high";
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/roadside-shrub-review.html", route => route.fulfill({ contentType: "text/html",
      body: "<body style='margin:0'><div id='title' style='position:absolute;top:16px;left:20px;font:22px sans-serif'></div></body>" }));
    await page.goto(`${url}roadside-shrub-review.html`);
    await page.evaluate(async ({ detailed, quality }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createDenseRoadsideShrubModel } = await imp("/src/renderers/three/plants/roadside-shrub-model.ts");
      const { createRoadsideShrubMaterials } = await imp("/src/renderers/three/plants/roadside-shrub-materials.ts");
      const { createRoadsideShrubFarMaterials, createRoadsideShrubFarModel } =
        await imp("/src/renderers/three/plants/roadside-shrub-far.ts");
      const { cartPassingWidth, HANDCART } = await imp("/src/render-common/logistics/handcart-rules.ts");
      const { ROAD_STONE_WIDTH, ROAD_VERGE_WIDTH } = await imp("/src/shared/settlement/road-types.ts");
      const pack = createRoadsideShrubMaterials(), scene = new t.Scene();
      const farPack = quality === "far" ? createRoadsideShrubFarMaterials(pack.materials) : null;
      scene.background = new t.Color("#c7cbbd");
      scene.add(new t.HemisphereLight("#fff5e4", "#728060", 2.2));
      const sun = new t.DirectionalLight("#fff2db", 2.8); sun.position.set(-4, 7, 6); scene.add(sun);
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1440, 1000); renderer.setPixelRatio(1);
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      document.body.append(renderer.domElement);
      const ground = new t.Mesh(new t.PlaneGeometry(100, 100), new t.MeshStandardMaterial({ color: "#909f7b" }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.004; scene.add(ground);
      const camera = new t.PerspectiveCamera(32, 1.44, .003, 100), models: any[] = [], roadParts: any[] = [];
      const clear = () => {
        models.splice(0).forEach(model => model.dispose());
        roadParts.splice(0).forEach(mesh => {
          mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
        });
      };
      (window as any).__shrub = {
        draw: (view: string) => {
          clear();
          const potted = ["pots", "pot", "soil"].includes(view), bounds = new t.Box3();
          for (let variant = 0; variant < 3; variant++) {
            const model = farPack ? createRoadsideShrubFarModel(farPack.materials, variant, potted) :
              createDenseRoadsideShrubModel(pack.materials, detailed, variant, potted);
            model.root.position.x = (variant - 1) * 1.05; scene.add(model.root); models.push(model);
            bounds.union(new t.Box3().setFromObject(model.root));
          }
          const centre = bounds.getCenter(new t.Vector3()), size = bounds.getSize(new t.Vector3());
          let distance = Math.max(size.x * 1.30, size.y * 2.8);
          if (view === "gameplay") distance *= 1.8;
          camera.position.set(centre.x + distance * .06, centre.y + distance * .23, centre.z + distance);
          if (view === "oblique") camera.position.x += distance * .6;
          if (view === "back") camera.position.z = -distance;
          camera.lookAt(centre);
          if (view === "leaf") {
            models[0].root.visible = false; models[2].root.visible = false;
            const leaf = models[1].graph.leaves.reduce((best: any, item: any) =>
              item.position[2] > best.position[2] ? item : best);
            const rotation = new t.Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
            const at = new t.Vector3(0, 0, leaf.length * .48).applyEuler(rotation)
              .add(new t.Vector3(...leaf.position));
            const normal = new t.Vector3(0, 1, 0).applyEuler(rotation);
            camera.position.copy(at).addScaledVector(normal, .22).add(new t.Vector3(.012, .006, .015));
            camera.lookAt(at);
          }
          if (view === "pot" || view === "soil") {
            models[0].root.visible = false; models[2].root.visible = false;
            if (view === "pot") {
              camera.position.set(.11, .20, .62); camera.lookAt(.045, .14, .21);
            } else {
              camera.position.set(.045, .56, .37); camera.lookAt(.015, .256, .14);
            }
          }
          const clearance: unknown[] = [];
          if (view === "road") {
            const road = new t.Mesh(new t.BoxGeometry(5, .006, ROAD_STONE_WIDTH),
              new t.MeshStandardMaterial({ color: "#8a8880", roughness: 1 }));
            scene.add(road); roadParts.push(road);
            const total = ROAD_STONE_WIDTH + 2 * ROAD_VERGE_WIDTH;
            for (const side of [-1, 1]) {
              const verge = new t.Mesh(new t.BoxGeometry(5, .004, ROAD_VERGE_WIDTH),
                new t.MeshStandardMaterial({ color: "#b1ba88", roughness: 1 }));
              verge.position.z = side * (ROAD_STONE_WIDTH + ROAD_VERGE_WIDTH) / 2;
              scene.add(verge); roadParts.push(verge);
            }
            for (const model of models) {
              const local = new t.Box3().setFromObject(model.root);
              const z = cartPassingWidth(2) / 2 + HANDCART.clearance - local.min.z;
              model.root.position.z = z;
              clearance.push({ z, inner: local.min.z + z, outer: local.max.z + z,
                passingHalf: cartPassingWidth(2) / 2, nominalVergeOuter: total / 2 });
            }
            camera.position.set(2.8, 2.3, 4.8); camera.lookAt(0, .12, .5);
          }
          renderer.render(scene, camera);
          document.getElementById("title")!.textContent = `Roadside shrub — ${quality} / ${view}`;
          return { detailed, quality, view, models: models.map(model => ({ triangles: model.triangles, counts: model.counts,
            bounds: new t.Box3().setFromObject(model.root).getSize(new t.Vector3()).toArray() })),
          calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          memory: renderer.info.memory, clearance };
        },
        dispose: () => {
          clear(); farPack?.dispose(); pack.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
        }
      };
    }, { detailed, quality });
    let views = ["front", "oblique", "back", "pots", "gameplay", "leaf", "pot", "soil", "road"];
    if (materialOnly) views = ["pots", "pot", "soil"];
    if (geometryOnly) views = ["front", "back", "pots", "gameplay", "road"];
    if (quality === "far") views = ["front", "pots", "gameplay", "road"];
    for (const view of views) {
      reports.push(await page.evaluate(view => (window as any).__shrub.draw(view), view));
      await page.screenshot({ path: resolve(output, `${quality}-${view}.png`) });
    }
    await page.evaluate(() => (window as any).__shrub.dispose()); await page.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before, "Source changed during review");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "private candidate; visual inspection pending",
    before, errors, reports }, null, 2));
  const figures = reports.map(report => {
    const row = report as { quality: string; view: string };
    const file = `${row.quality}-${row.view}.png`;
    return `<figure><a href="${file}"><img loading="lazy" src="${file}"></a><figcaption>${file}</figcaption></figure>`;
  });
  writeFileSync(resolve(output, "index.html"), `<!doctype html><title>Roadside shrubs private candidate</title>
    <style>body{background:#252b29;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr)}
    figure{margin:8px}img{width:100%}</style><h1>Private shrubs, not approved paid assets</h1><main>${figures.join("")}</main>`);
  console.log(`Captured ${reports.length} shrub views in ${output}`);
} finally { await browser.close(); await server.close(); }
