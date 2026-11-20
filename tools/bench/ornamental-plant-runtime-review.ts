import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantModel } from "../../../island-of-settlers-shared/src/road-plant-models";
import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? "native-a";
const peachOnly = process.argv.includes("--peach");
const benchShadows = process.argv.includes("--bench-shadows");
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid plant runtime review label");
const output = resolve("../resources/project-reviews/ornamental-plant-runtime-2026-11-04", run);
if (existsSync(resolve(output, "report.json"))) throw new Error("Preserve completed runtime evidence; use a fresh label");
mkdirSync(output, { recursive: true });
const sources = [
  "src/renderers/three/plants/ornamental-plant-model.ts", "src/renderers/three/plants/ornamental-plant-lod.ts",
  "src/renderers/three/plants/ornamental-decoration-profile.ts",
  "src/renderers/three/plants/bonsai-model.ts", "src/renderers/three/plants/bonsai-elm-leaf-geometry.ts",
  "src/renderers/three/plants/maple-tree-model.ts", "src/renderers/three/plants/roadside-shrub-model.ts",
  "src/renderers/three/plants/maple-tree-far-model.ts", "src/renderers/three/plants/maple-far-alpha.ts",
  "src/renderers/three/plants/maple-leaf-geometry.ts", "src/renderers/three/plants/maple-leaf-material.ts",
  "src/render-common/plants/bonsai-elm-graph.ts", "src/render-common/plants/maple-tree-graph.ts",
  "src/render-common/plants/roadside-shrub-graph.ts", "src/renderers/three/plants/roadside-shrub-stem.ts",
  "src/renderers/three/plants/roadside-shrub-far.ts", "src/renderers/three/road-decoration-asset-loader.ts",
  "src/renderers/three/road-decoration-templates.ts", "src/renderers/three/settlement/three-road-decorations.ts",
  "src/render-common/plants/ornamental-plant-clearance.ts", "../island-of-settlers-shared/src/road-plant-models.ts"
];
if (peachOnly) sources.push(
  "src/render-common/plants/flowering-peach-graph.ts", "src/render-common/plants/flowering-peach-physical.ts",
  "src/renderers/three/plants/peach-production-templates.ts", "src/renderers/three/plants/peach-production-resources.ts",
  "src/renderers/three/plants/peach-production-assets.ts", "src/renderers/three/plants/peach-tree-production-model.ts",
  "src/renderers/three/plants/peach-tree-near-model.ts", "src/renderers/three/plants/peach-tree-impostor.ts",
  "src/renderers/three/plants/peach-crown-impostor.ts", "src/renderers/three/plants/peach-crown-layout.ts",
  "src/renderers/three/plants/peach-blossom-tree-templates.ts", "src/renderers/three/plants/peach-blossom-merged.ts",
  "src/renderers/three/plants/peach-blossom-geometry.ts", "src/renderers/three/plants/peach-blossom-materials.ts",
  "src/renderers/three/plants/peach-tree-materials.ts", "src/renderers/three/plants/peach-tree-model.ts",
  "src/renderers/three/plants/peach-bark-geometry.ts", "src/renderers/three/plants/peach-bark-textures.ts",
  "src/renderers/three/road-decoration-hover.ts", "src/shared/settlement/road-decoration-state.ts",
  "tools/bench/ornamental-plant-runtime-review.ts",
  ...readdirSync("public/textures/plants/peach-k").map(file => `public/textures/plants/peach-k/${file}`)
);
const hashSources = () => Object.fromEntries(sources.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const hashes = hashSources();
const specimens = Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)
  .filter(([, item]) => {
    if (!item.plant) return false;
    const species = ornamentalPlantModel(item.plant);
    if (peachOnly) return species === "flowering-peach";
    return species && !species.startsWith("catalog-") &&
      !["flowering-peach", "willow-tree", "cypress-tree"].includes(species) &&
      item.plant.palette === "default";
  })
  .map(([id, item]) => ({ id, name: item.name, botanical: ornamentalPlantModel(item.plant!) }));
assert.equal(specimens.length, peachOnly ? 3 : 12);
const errors: string[] = [], results: unknown[] = [], images: string[] = [];
const { server, url } = await startDevServer({ unlockAll: false });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/ornamental-runtime.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}ornamental-runtime.html`);
  for (const detailed of [true, false]) {
    await page.evaluate(async ({ benchShadows, detailed, peachOnly }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const { createRoadDecorationState } = await imp("/src/shared/settlement/road-decoration-state.ts");
      const { createThreeCameraRig } = await imp("/src/renderers/three/three-camera.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
        throw new Error(gl.getProgramInfoLog(program) ?? "Ornamental runtime shader failure");
      };
      renderer.setPixelRatio(1); renderer.setSize(1100, 900); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.shadowMap.enabled = detailed && benchShadows;
      renderer.toneMapping = t.ACESFilmicToneMapping; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#b4bdb5");
      scene.add(new t.HemisphereLight("#fff6e6", "#687b67", 2));
      const sun = new t.DirectionalLight("#fff2dc", 3); sun.position.set(10, 30, 25);
      sun.target.position.set(16, 0, 16); sun.castShadow = detailed && benchShadows;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
      sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
      scene.add(sun, sun.target);
      const ground = new t.Mesh(new t.PlaneGeometry(256, 256),
        new t.MeshStandardMaterial({ color: "#87916a", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(64, -.005, 64); scene.add(ground);
      ground.receiveShadow = detailed && benchShadows;
      let camera = new t.PerspectiveCamera(36, 1100 / 900, .01, 600);
      const owner = createThreeRoadDecorations({ cellsX: 256, cellsZ: 256, fogDisplayDisabled: true, fogRevision: 0 },
        detailed, () => { throw new Error("Botanical models unexpectedly acquired national materials"); });
      scene.add(owner.root, owner.ghostRoot);
      const context = () => ({ nation: "roman", roads: [], heightAt: () => 0,
        isOwned: () => true, isFree: () => true });
      const state = createRoadDecorationState(context);
      const metrics = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, ...owner.statistics() });
      const draw = async (specimen: { id: string; botanical: string }, far: boolean) => {
        state.load(undefined);
        const placed = state.place({ item: specimen.id, position: { x: 16, z: 16 }, yaw: Math.PI / 4 }, () => true);
        if (!placed.ok) throw new Error(`Actual placement rejected: ${JSON.stringify(placed)}`);
        const placedUid = state.frames()[0].uid;
        if (!state.rotate(placedUid).ok || !state.move(placedUid, { x: 16, z: 16 }, Math.PI / 4).ok)
          throw new Error("Actual same-UID rotation/move rejected");
        const saved = state.save(); state.load(saved);
        if (JSON.stringify(state.save()) !== JSON.stringify(saved)) throw new Error("Plant save roundtrip changed identity");
        const maple = specimen.botanical === "maple-tree" || specimen.botanical === "flowering-peach";
        let distance = maple ? 14 : 2.4;
        if (far) distance = 70;
        const height = maple ? 3.2 : .4;
        camera.position.set(16 + distance * .38, height + distance * .48, 16 + distance);
        camera.lookAt(16, height, 16);
        owner.update(state.frames(), camera); await owner.ready();
        renderer.render(scene, camera);
        const before = metrics();
        if (before.instances !== 1 || before.pending || before.errors) throw new Error("Placed template did not load");
        const templateTriangles = owner.root.children.reduce((sum: number, mesh: any) => {
          if (!mesh.isInstancedMesh) return sum;
          return sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3 * mesh.count;
        }, 0);
        if (specimen.botanical === "flowering-peach") {
          const nearCost = detailed ? 22124 : 5912;
          if (templateTriangles !== (far ? 2 : nearCost)) throw new Error("Actual peach tier selection/cost mismatch");
        }
        const closeFarInspection = far && specimen.botanical !== "flowering-peach";
        if (closeFarInspection) {
          // Inspect the already selected far template closely. Actual overview cost/selection is above;
          // this diagnostic camera move intentionally does not run the runtime LOD selector again.
          const inspectDistance = maple ? 14 : 2.4;
          camera.position.set(16 + inspectDistance * .38, height + inspectDistance * .48, 16 + inspectDistance);
          camera.lookAt(16, height, 16); renderer.render(scene, camera);
        }
        const uid = state.frames()[0].uid;
        owner.root.updateMatrixWorld(true);
        const hit = owner.pick(new t.Raycaster(new t.Vector3(16, 30, 16), new t.Vector3(0, -1, 0)));
        if (hit?.uid !== uid) throw new Error("Actual plant ray picking lost its UID");
        if (!owner.setHover(uid)) throw new Error("Actual placed plant cannot be hovered");
        owner.setHover(null);
        if (!far) {
          owner.updateGhost({ item: specimen.id, position: [18, 0, 16], yaw: Math.PI / 2, valid: true });
          await owner.ready();
          if (!owner.ghostRoot.children.length) throw new Error("Plant ghost is empty");
          owner.updateGhost(null);
        }
        const picked = state.pickUp(uid);
        if (!picked.ok || picked.returned !== 1 || state.pickUp(uid).returned !== 0)
          throw new Error("Plant pickup was not exactly once");
        const returns = state.returns().map((row: { id: number }) => row.id);
        let returned = 0;
        state.claimReturns(returns, (items: Record<string, number>) => { returned += items[specimen.id] ?? 0; return true; });
        state.claimReturns(returns, () => { throw new Error("Duplicate custody return"); });
        if (returned !== 1) throw new Error("Plant custody was not conserved");
        return { ...before, templateTriangles, saved, custodyReturned: returned, far, closeFarInspection };
      };
      (window as any).ornamentalRuntime = { draw,
        population: async (items: string[]) => {
          state.load(undefined);
          const spacing = peachOnly ? 10 : 7;
          for (let index = 0; index < 192; index++) {
            const item = items[index % items.length]!;
            const result = state.place({ item, position: { x: 8 + index % 16 * spacing, z: 8 + Math.floor(index / 16) * spacing },
              yaw: index * .73 % (Math.PI * 2) }, () => true);
            if (!result.ok) throw new Error(`Population placement ${index}: ${JSON.stringify(result)}`);
          }
          const field = new t.Box3();
          for (const frame of state.frames()) for (const box of frame.volumes) {
            field.expandByPoint(new t.Vector3(...box.min)); field.expandByPoint(new t.Vector3(...box.max));
          }
          const centre = field.getCenter(new t.Vector3()), rig = createThreeCameraRig(() => 0);
          const cameraState = { centerX: centre.x, centerZ: centre.z,
            viewportWidth: 1100, viewportHeight: 900, zoom: .15, yaw: 0, tilt: 0 };
          camera = rig.update(cameraState);
          let maximum = .75;
          for (const x of [field.min.x, field.max.x]) for (const y of [field.min.y, field.max.y])
            for (const z of [field.min.z, field.max.z]) {
              const point = new t.Vector3(x, y, z).project(camera);
              maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y));
            }
          cameraState.zoom *= .75 / maximum; camera = rig.update(cameraState);
          owner.update(state.frames(), camera); await owner.ready(); renderer.render(scene, camera);
          const before = metrics();
          if (before.instances !== 192 || before.pending || before.errors) throw new Error("Population did not load");
          if (before.triangles > 300000) throw new Error(`Phone triangle envelope exceeded: ${before.triangles}`);
          const physical = state.frames(), positions = new Set<string>();
          const frustum = new t.Frustum().setFromProjectionMatrix(new t.Matrix4()
            .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          const instance = new t.Matrix4(), point = new t.Vector3();
          let mainBufferTriangles = 2, fullyVisible = 0;
          owner.root.updateMatrixWorld(true);
          for (const mesh of owner.root.children) {
            if (!mesh.isInstancedMesh) continue;
            mainBufferTriangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3 * mesh.count;
            for (let index = 0; index < mesh.count; index++) {
              mesh.getMatrixAt(index, instance); instance.premultiply(mesh.matrixWorld); point.setFromMatrixPosition(instance);
              positions.add(`${point.x.toFixed(3)}:${point.z.toFixed(3)}`);
            }
          }
          for (const frame of physical) {
            if (!positions.has(`${frame.position[0].toFixed(3)}:${frame.position[2].toFixed(3)}`))
              throw new Error("Population lacks an actual GPU world position");
            let visible = true;
            for (const box of frame.volumes) for (const x of [box.min[0], box.max[0]])
              for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]])
                if (!frustum.containsPoint(point.set(x, y, z))) visible = false;
            if (visible) fullyVisible++;
          }
          if (positions.size !== 192 || fullyVisible !== 192) throw new Error("Actual population not fully framed");
          const versions = owner.root.children.map((mesh: any) => mesh.instanceMatrix?.version);
          for (let frame = 0; frame < 60; frame++) { owner.update(state.frames(), camera); renderer.render(scene, camera); }
          if (JSON.stringify(versions) !== JSON.stringify(owner.root.children.map((mesh: any) => mesh.instanceMatrix?.version)))
            throw new Error("Unchanged plant frames re-upload matrices");
          return { ...before, mainBufferTriangles, uniqueGpuPositions: positions.size, fullyVisible,
            samples: 60, placed: state.frames().length };
        },
        dispose: () => {
          owner.dispose(); state.load(undefined); ground.geometry.dispose(); ground.material.dispose();
          renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        } };
    }, { benchShadows, detailed, peachOnly });
    try {
      for (const [index, specimen] of specimens.entries()) for (const far of [false, true]) {
        const result = await page.evaluate(({ far, specimen }) => (window as any).ornamentalRuntime.draw(specimen, far),
          { specimen, far });
        results.push({ detailed, specimen, result });
        const file = `${detailed ? "high" : "minimal"}-${index}-${far ? "far" : "near"}.png`;
        await page.screenshot({ path: resolve(output, file) }); images.push(file);
      }
      const populationItems = peachOnly ? specimens.map(item => item.id) : [
        specimens.find(item => item.botanical === "maple-tree")!.id,
        specimens.find(item => item.botanical === "bonsai-elm")!.id,
        specimens.find(item => item.botanical === "roadside-shrub")!.id
      ];
      const population = await page.evaluate(items => (window as any).ornamentalRuntime.population(items), populationItems);
      results.push({ detailed, population });
      const file = `${detailed ? "high" : "minimal"}-population192.png`;
      await page.screenshot({ path: resolve(output, file) }); images.push(file);
    } finally { await page.evaluate(() => (window as any).ornamentalRuntime.dispose()); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashSources(), hashes);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    shadowPath: benchShadows ? "bench-only" : "game", hashes, errors, results
  }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Canonical ornamental runtime</title>
    <style>body{background:#222;color:#eee;font-family:system-ui}img{width:45vw}figure{display:inline-block}</style>
    <h1>Canonical ornamental runtime: High/Minimal, near/far,192-instance population</h1>
    ${images.map(file => `<figure><img src="${file}"><figcaption>${file}</figcaption></figure>`).join("\n")}`);
  console.log(`Captured ${images.length} canonical ornamental runtime frames`);
} finally { await browser?.close(); await server.close(); }
