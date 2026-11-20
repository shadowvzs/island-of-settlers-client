import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mesh } from "three";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid bonsai review run");
const species = process.argv.find(argument => argument.startsWith("--species="))?.slice(10) ?? "elm";
const vivid = process.argv.includes("--vivid");
if (!["pine", "elm"].includes(species)) throw new Error("Invalid bonsai species");
if (vivid && species !== "elm") throw new Error("The vivid correction belongs only to oval-leaved Elm bonsai");
const variants = process.argv.find(argument => argument.startsWith("--variants="))?.slice(11).split(",").map(Number) ??
  [0, 1, 2];
if (!variants.length || variants.some(variant => ![0, 1, 2].includes(variant)))
  throw new Error("Invalid bonsai variant");
const viewsRequested = process.argv.find(argument => argument.startsWith("--views="))?.slice(8).split(",") ??
  ["front", "oblique", "back", "gameplay"];
if (viewsRequested.some(view => !["front", "oblique", "back", "gameplay", "leaf", "bark", "runtime", "night"].includes(view)))
  throw new Error("Invalid bonsai view");
const output = resolve("../resources/project-reviews/bonsai-candidate-2026-11-04", run);
if (existsSync(resolve(output, "report.json")))
  throw new Error("Bonsai evidence already exists; choose a fresh --run label to preserve earlier captures");
mkdirSync(output, { recursive: true });
const sourceFiles = [
  "src/render-common/plants/bonsai-elm-graph.ts", "src/render-common/plants/bonsai-pine-graph.ts",
  "src/render-common/plants/ornamental-tree-graph.ts", "src/renderers/three/plants/bonsai-model.ts",
  "src/renderers/three/plants/bonsai-elm-leaf-geometry.ts", "src/renderers/three/plants/bonsai-elm-leaf-lighting.ts",
  "src/renderers/three/plants/bonsai-elm-leaf-textures.ts", "src/renderers/three/plants/bonsai-elm-bark-textures.ts",
  "src/renderers/three/plants/bonsai-elm-materials.ts", "src/renderers/three/plants/bonsai-pot-geometry.ts",
  "src/renderers/three/plants/ornamental-leaf-textures.ts", "src/renderers/three/plants/ornamental-shoot-geometry.ts",
  "src/renderers/three/plants/ornamental-wood-geometry.ts", "tools/bench/bonsai-candidate-review.ts"
];
const hashSources = () => Object.fromEntries(sourceFiles.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sourceHashes = hashSources();
const errors: string[] = [], results: unknown[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/bonsai-candidate.html", route => route.fulfill({
    body: "<body style='margin:0'></body>", contentType: "text/html"
  }));
  await page.goto(`${url}bonsai-candidate.html`);
  for (const detailed of [true, false]) for (const variant of variants) {
    const measured = await page.evaluate(async ({ detailed, species, variant, vivid }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createBonsaiElmMaterials, createBonsaiElmModel, createBonsaiModel } =
        await imp("/src/renderers/three/plants/bonsai-model.ts");
      const { createOrnamentalTreeMaterials } = await imp("/src/renderers/three/plants/ornamental-tree-materials.ts");
      const { VIVID_BONSAI_ELM_APPEARANCE } = await imp("/src/renderers/three/plants/bonsai-elm-materials.ts");
      const { computeEnvironment, TIME_PRESETS } = await imp("/src/render-common/environment.ts");
      const { createBonsaiElmLeafGeometry } = await imp("/src/renderers/three/plants/bonsai-elm-leaf-geometry.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
        throw new Error(gl.getProgramInfoLog(program) ?? "Bonsai shader compilation failed");
      };
      renderer.setSize(1200, 1000); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = detailed;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c9c9bb");
      const ambient = new t.HemisphereLight("#fff8e9", "#727b65", 2); scene.add(ambient);
      const sun = new t.DirectionalLight("#fff3de", 3); sun.position.set(-2, 4, 3);
      sun.castShadow = detailed; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -1; sun.shadow.camera.right = 1;
      sun.shadow.camera.top = 1; sun.shadow.camera.bottom = -1;
      sun.shadow.bias = -.00005; scene.add(sun);
      const appearance = vivid ? VIVID_BONSAI_ELM_APPEARANCE : undefined;
      const materials = species === "elm" ? createBonsaiElmMaterials(undefined, undefined, appearance) : createOrnamentalTreeMaterials();
      const factory = species === "elm" ? createBonsaiElmModel : createBonsaiModel;
      const model = factory(materials.materials, detailed, variant);
      scene.add(model.root);
      let inspectionLeaf: Mesh | undefined;
      if (species === "elm") {
        const leaf = { ...model.graph.leaves[0], position: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };
        const leafMesh = new t.Mesh(createBonsaiElmLeafGeometry(leaf, detailed), materials.materials.foliage);
        leafMesh.position.y = .08; leafMesh.visible = false; scene.add(leafMesh);
        inspectionLeaf = leafMesh;
      }
      const ground = new t.Mesh(new t.PlaneGeometry(30, 30),
        new t.MeshStandardMaterial({ color: "#a4a18b", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.001;
      ground.receiveShadow = true; scene.add(ground);
      const camera = new t.PerspectiveCamera(34, 1.2, .005, 40);
      const bounds = new t.Box3().setFromObject(model.root), centre = bounds.getCenter(new t.Vector3());
      const inspect = {
        draw: (view: string) => {
          const environment = computeEnvironment({ azimuthX: 0, azimuthZ: 1, elevation: .7 },
            view === "night" ? TIME_PRESETS.night : TIME_PRESETS.day, 0);
          if (vivid) {
            ambient.color.fromArray(environment.ambientSky); ambient.groundColor.fromArray(environment.ambientGround);
            sun.color.fromArray(environment.sunColor); scene.background.fromArray(environment.fogColor);
          }
          model.root.visible = view !== "leaf";
          model.root.rotation.y = view === "runtime" || view === "night" ? Math.PI / 4 : 0;
          if (inspectionLeaf) inspectionLeaf.visible = view === "leaf";
          if (view === "runtime" || view === "night") {
            camera.fov = 36; camera.aspect = 1100 / 900; camera.updateProjectionMatrix();
            camera.position.set(2.4 * .38, .4 + 2.4 * .48, 2.4); camera.lookAt(0, .4, 0);
            renderer.render(scene, camera);
            return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
              geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
          }
          camera.fov = 34; camera.aspect = 1.2; camera.updateProjectionMatrix();
          if (view === "leaf") {
            if (!inspectionLeaf) throw new Error("Leaf inspection requires elm bonsai");
            camera.position.set(0, .24, .095); camera.lookAt(0, .08, .04);
            renderer.render(scene, camera);
            return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
              geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
          }
          if (view === "bark") {
            const point = model.graph.limbs[0].path[2];
            camera.position.set(point[0] + .12, point[1] + .03, point[2] + .38);
            camera.lookAt(...point); renderer.render(scene, camera);
            return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
              geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
          }
          const poses: Record<string, number[]> = {
            front: [0, .82, 2.1], oblique: [1.3, 1.0, 1.8], back: [-1.0, .8, -1.8], gameplay: [3.3, 4.1, 4.4]
          };
          const pose = poses[view]!;
          camera.position.set(centre.x + pose[0]!, pose[1]!, centre.z + pose[2]!);
          camera.lookAt(centre); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
        },
        dispose: () => {
          model.dispose(); materials.dispose(); ground.geometry.dispose(); ground.material.dispose();
          inspectionLeaf?.geometry.dispose();
          sun.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        }
      };
      Object.assign(window, { bonsaiCandidate: inspect });
      return { triangles: model.triangles, counts: model.counts,
        appearance: { foliage: materials.materials.foliage.color.getHexString(), vivid,
          emission: materials.materials.foliage.emissive.getHex() },
        bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
    }, { detailed, species, variant, vivid });
    const views = [];
    for (const view of viewsRequested) {
      const metrics = await page.evaluate(view => {
        const host = window as unknown as { bonsaiCandidate: { draw: (view: string) => unknown } };
        return host.bonsaiCandidate.draw(view);
      }, view);
      const filename = `${species}-${detailed ? "high" : "minimal"}-v${variant}-${view}.png`;
      await page.screenshot({ path: resolve(output, filename) });
      views.push({ filename, view, metrics });
    }
    results.push({ detailed, species, variant, measured, views });
    await page.evaluate(() => {
      const host = window as unknown as { bonsaiCandidate: { dispose: () => void } };
      host.bonsaiCandidate.dispose();
    });
  }
  await page.close(); assert.deepEqual(errors, []);
  assert.deepEqual(hashSources(), sourceHashes, "Bonsai source changed during capture");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    status: "PRIVATE CANDIDATE — no premium art or production budget approval", vivid, sourceHashes, results, errors
  }, null, 2));
  const cards = results.flatMap(result => {
    const entry = result as { views: Array<{ filename: string }> };
    return entry.views.map(({ filename }) => `<figure><img src="${filename}"><figcaption>${filename}</figcaption></figure>`);
  });
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Bonsai candidate</title>
    <style>body{background:#222;color:#eee;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr)}
    figure{margin:8px}img{width:100%}</style><h1>Private unaccepted bonsai candidate</h1><main>${cards.join("")}</main>`);
  console.log(`Captured ${results.length * viewsRequested.length} bonsai candidate frames`);
} finally { await browser.close(); await server.close(); }
