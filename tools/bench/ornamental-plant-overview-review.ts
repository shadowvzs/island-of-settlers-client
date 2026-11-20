import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantArtReady } from "../../../island-of-settlers-shared/src/road-plant-models";
import type { RoadDecorationFrame } from "../../src/shared/settlement/road-decoration-state";
import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? "overview-b";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid overview proof label");
const output = resolve("../resources/project-reviews/ornamental-plant-runtime-2026-11-04", run);
if (existsSync(resolve(output, "report.json"))) throw new Error("Preserve completed proof; use a new label");
const items = Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)
  .filter(([, item]) => item.plant && ornamentalPlantArtReady(item.plant)).map(([id]) => id);
assert.equal(items.length, 18);
const iconDirectory = "public/icons/road-decorations/";
const manifest = JSON.parse(readFileSync(`${iconDirectory}ornamental-overview.json`, "utf8")) as
  Record<string, { image: string }>;
const sources = [
  "src/renderers/three/plants/ornamental-plant-lod.ts", "src/renderers/three/plants/ornamental-plant-overview.ts",
  "src/renderers/three/plants/ornamental-decoration-profile.ts",
  "src/renderers/three/plants/ornamental-plant-overview-geometry.ts", "src/renderers/three/plants/ornamental-plant-model.ts",
  "src/renderers/three/road-decoration-asset-loader.ts", "src/renderers/three/road-decoration-templates.ts",
  "src/renderers/three/settlement/three-road-decorations.ts", "src/renderers/three/road-decoration-hover.ts",
  "src/render-common/plants/ornamental-plant-clearance.ts", "src/render-common/plants/ornamental-overview-light.ts",
  "src/render-common/plants/bonsai-elm-graph.ts", "src/render-common/plants/bonsai-pine-graph.ts",
  "src/renderers/three/plants/bonsai-model.ts", "src/renderers/three/plants/bonsai-elm-leaf-geometry.ts",
  "src/renderers/three/plants/bonsai-elm-leaf-textures.ts", "src/renderers/three/plants/bonsai-elm-leaf-lighting.ts",
  "src/renderers/three/plants/bonsai-elm-bark-textures.ts", "src/renderers/three/plants/bonsai-elm-materials.ts",
  "src/renderers/three/plants/bonsai-pot-geometry.ts", "src/renderers/three/plants/ornamental-shoot-geometry.ts",
  "src/renderers/three/plants/ornamental-wood-geometry.ts", "src/renderers/three/plants/ornamental-leaf-textures.ts",
  "src/render-common/plants/roadside-shrub-graph.ts", "src/renderers/three/plants/roadside-shrub-model.ts",
  "src/renderers/three/plants/roadside-shrub-far.ts", "src/renderers/three/plants/roadside-shrub-foliage.ts",
  "src/renderers/three/plants/roadside-shrub-stem.ts", "src/renderers/three/plants/roadside-shrub-textures.ts",
  "src/renderers/three/plants/roadside-shrub-materials.ts", "src/renderers/three/plants/roadside-shrub-pot.ts",
  "src/render-common/plants/maple-tree-graph.ts", "src/renderers/three/plants/maple-tree-model.ts",
  "src/renderers/three/plants/maple-tree-far-model.ts", "src/renderers/three/plants/maple-far-alpha.ts",
  "src/renderers/three/plants/maple-production-leaf-geometry.ts", "src/renderers/three/plants/maple-production-wood.ts",
  "src/renderers/three/plants/maple-leaf-geometry.ts", "src/renderers/three/plants/maple-leaf-material.ts",
  "src/renderers/three/plants/maple-leaf-textures.ts", "src/renderers/three/plants/maple-bark-material.ts",
  "src/render-common/plants/ornamental-tree-graph.ts",
  "../island-of-settlers-shared/src/road-plant-models.ts", "tools/bench/ornamental-plant-overview-review.ts",
  `${iconDirectory}ornamental-overview.json`, ...items.map(id => `${iconDirectory}${manifest[id]!.image}`)
];
const hashSources = () => Object.fromEntries(sources.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sourceHashes = hashSources(), errors: string[] = [], results: unknown[] = [], images: string[] = [];
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer({ unlockAll: false });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/ornamental-overview.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}ornamental-overview.html`);
  for (const detailed of [true, false]) {
    await page.evaluate(async ({ detailed, items }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const { createRoadDecorationState } = await imp("/src/shared/settlement/road-decoration-state.ts");
      const { createThreeCameraRig } = await imp("/src/renderers/three/three-camera.ts");
      const { computeEnvironment, TIME_PRESETS } = await imp("/src/render-common/environment.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
        throw new Error(gl.getProgramInfoLog(program) ?? "Overview shader failed");
      };
      renderer.setPixelRatio(1); renderer.setSize(1100, 900); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; renderer.shadowMap.enabled = detailed;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(), hemisphere = new t.HemisphereLight("#fff6e6", "#687b67", 2);
      const sun = new t.DirectionalLight("#fff2dc", 3); sun.position.set(10, 40, 55);
      sun.target.position.set(36, 0, 36); sun.castShadow = detailed; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
      sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80; scene.add(hemisphere, sun, sun.target);
      const ground = new t.Mesh(new t.PlaneGeometry(1024, 1024),
        new t.MeshStandardMaterial({ color: "#87916a", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(256, -.005, 256); ground.receiveShadow = detailed; scene.add(ground);
      const owner = createThreeRoadDecorations({ cellsX: 1024, cellsZ: 1024, fogDisplayDisabled: true, fogRevision: 0 },
        detailed, () => { throw new Error("Unexpected national maps"); });
      scene.add(owner.root, owner.ghostRoot);
      const context = () => ({ nation: "roman", roads: [], heightAt: () => 0,
        isOwned: () => true, isFree: () => true });
      const state = createRoadDecorationState(context), started = performance.now();
      let held = 1000;
      for (let index = 0; index < 1000; index++) {
        const result = state.place({ item: items[index % items.length],
          position: { x: 8 + index % 32 * 8, z: 8 + Math.floor(index / 32) * 8 },
          yaw: index * .37 % (Math.PI * 2) }, () => { held--; return true; });
        if (!result.ok) throw new Error(`Actual1000 placement ${index}: ${JSON.stringify(result)}`);
      }
      if (held !== 0) throw new Error("Placement custody mismatch");
      const placementMs = performance.now() - started, saved = state.save(), loadStart = performance.now();
      state.load(saved);
      if (JSON.stringify(saved) !== JSON.stringify(state.save())) throw new Error("1000 save identity mismatch");
      const loadMs = performance.now() - loadStart, frames: readonly RoadDecorationFrame[] = state.frames();
      const locationKey = (x: number, z: number) => `${x.toFixed(3)}:${z.toFixed(3)}`;
      const byPosition = new Map(frames.map(frame => [locationKey(frame.position[0], frame.position[2]), frame]));
      const field = new t.Box3();
      for (const frame of frames) for (const box of frame.volumes) {
        field.expandByPoint(new t.Vector3(...box.min)); field.expandByPoint(new t.Vector3(...box.max));
      }
      const centre = field.getCenter(new t.Vector3()), rig = createThreeCameraRig(() => 0);
      sun.target.position.set(centre.x, 0, centre.z); sun.position.set(centre.x - 10, 25, centre.z + 15);
      sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
      sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
      const cameraState = { centerX: centre.x, centerZ: centre.z, viewportWidth: 1100, viewportHeight: 900,
        zoom: 1, yaw: 0, tilt: 0 };
      let camera = rig.update(cameraState);
      const corners = (box: any) => {
        const points = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) points.push(new t.Vector3(x, y, z));
        return points;
      };
      const fit = (mode: string) => {
        rig.setMode(mode); cameraState.zoom = 1;
        camera = rig.update(cameraState); camera.updateMatrixWorld(true);
        let maximum = 1;
        for (const point of corners(field)) { point.project(camera); maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y)); }
        cameraState.zoom = Math.min(.25, .78 / maximum);
        camera = rig.update(cameraState); camera.updateMatrixWorld(true);
      };
      const visibility = () => {
        camera.updateMatrixWorld(true); owner.root.updateMatrixWorld(true);
        const frustum = new t.Frustum().setFromProjectionMatrix(new t.Matrix4()
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const right = new t.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new t.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const instance = new t.Matrix4(), world = new t.Matrix4(), root = new t.Vector3(), point = new t.Vector3();
        let submittedInstances = 0, fullyVisible = 0, partiallyVisible = 0, outside = 0, overviewInstances = 0;
        let mainBufferTriangles = 2;
        const recorded = new Set<string>(), locations = new Set<string>(), samples: unknown[] = [];
        for (const mesh of owner.root.children) {
          if (!mesh.isInstancedMesh) continue;
          const batch = mesh.name.slice(0, mesh.name.lastIndexOf("/"));
          mainBufferTriangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3 * mesh.count;
          if (recorded.has(batch)) continue;
          recorded.add(batch);
          for (let index = 0; index < mesh.count; index++) {
            submittedInstances++; mesh.getMatrixAt(index, instance); world.multiplyMatrices(mesh.matrixWorld, instance);
            root.setFromMatrixPosition(world);
            const location = locationKey(root.x, root.z);
            if (!byPosition.has(location) || locations.has(location)) throw new Error("GPU instance location missing or duplicated");
            locations.add(location);
            let points;
            if (mesh.userData.plantOverview) {
              overviewInstances++;
              const positions = mesh.geometry.getAttribute("position"); points = [];
              for (let vertex = 0; vertex < positions.count; vertex++) points.push(point.copy(root)
                .addScaledVector(right, positions.getX(vertex)).addScaledVector(up, positions.getY(vertex)).clone());
            } else {
              const frame = byPosition.get(locationKey(root.x, root.z));
              if (!frame) throw new Error("Submitted instance has no authoritative world position");
              const complete = new t.Box3();
              for (const box of frame.volumes) {
                complete.expandByPoint(new t.Vector3(...box.min)); complete.expandByPoint(new t.Vector3(...box.max));
              }
              points = corners(complete);
            }
            let contained = 0;
            for (const point of points) if (frustum.containsPoint(point)) contained++;
            if (contained === points.length) fullyVisible++; else if (contained) partiallyVisible++; else outside++;
            if (samples.length < 3) samples.push({ position: root.toArray(), matrix: instance.toArray() });
          }
        }
        return { bufferInstances: submittedInstances, uniqueWorldPositions: locations.size, fullyVisible, partiallyVisible,
          outside, overviewInstances, mainBufferTriangles, samples };
      };
      const draw = async (view: string) => {
        const close = view === "close", night = view === "iso-night";
        fit(view === "perspective" ? "cinematic" : "iso");
        if (close) { cameraState.zoom = 3; camera = rig.update(cameraState); }
        const environment = computeEnvironment({ azimuthX: 0, azimuthZ: 1, elevation: .7 },
          night ? TIME_PRESETS.night : TIME_PRESETS.day, 0);
        scene.background = new t.Color().fromArray(environment.fogColor);
        hemisphere.color.fromArray(environment.ambientSky); hemisphere.groundColor.fromArray(environment.ambientGround);
        sun.color.fromArray(environment.sunColor);
        owner.update(frames, camera, 900); await owner.ready(); owner.updateEnvironment(environment);
        renderer.render(scene, camera);
        const visible = visibility(), stats = owner.statistics();
        if (stats.instances !== 1000 || stats.pending || stats.errors) throw new Error("1000 assets not ready");
        if (!close && (visible.fullyVisible !== 1000 || visible.overviewInstances !== 1000))
          throw new Error(`Entire actual field not fully overview-visible: ${JSON.stringify(visible)}`);
        if (!close && (stats.batches > items.length || visible.mainBufferTriangles !== 2002))
          throw new Error("Canonical overview did not use at most18 batches/2000 plant triangles");
        if (visible.mainBufferTriangles > (detailed ? 100000 : 60000)) throw new Error("Plant margin budget exceeded");
        if (renderer.info.render.triangles > 300000) throw new Error("Rendered main+shadow phone envelope exceeded");
        const versions = owner.root.children.map((mesh: any) => mesh.instanceMatrix?.version);
        const measured = { view, detailed, ...visible, ...stats, placementMs, loadMs, camera: { ...cameraState },
          calls: renderer.info.render.calls, renderedTriangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
        for (let frame = 0; frame < 60; frame++) { owner.update(frames, camera, 900); owner.updateEnvironment(environment); renderer.render(scene, camera); }
        if (JSON.stringify(versions) !== JSON.stringify(owner.root.children.map((mesh: any) => mesh.instanceMatrix?.version)))
          throw new Error("Unchanged frame uploads matrices");
        const target = frames[777];
        if (!target) throw new Error("Missing known1000th-field picking witness");
        owner.root.updateMatrixWorld(true);
        const hit = owner.pick(new t.Raycaster(new t.Vector3(target.position[0], 5, target.position[2]), new t.Vector3(0, -1, 0)));
        if (hit?.uid !== target.uid || !owner.setHover(target.uid)) throw new Error("Overview physical UID/hover mismatch");
        owner.setHover(null); return measured;
      };
      (window as any).overviewProof = { draw, dispose: () => {
        owner.dispose(); state.load(undefined); ground.geometry.dispose(); ground.material.dispose();
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      } };
    }, { detailed, items });
    try {
      for (const view of ["iso", "perspective", "iso-night", "close"]) {
        results.push(await page.evaluate(view => (window as any).overviewProof.draw(view), view));
        const file = `${detailed ? "high" : "minimal"}-${view}.png`;
        await page.screenshot({ path: resolve(output, file) }); images.push(file);
      }
    } finally { await page.evaluate(() => (window as any).overviewProof.dispose()); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashSources(), sourceHashes);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ sourceHashes, errors, results }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>1000 actual canonical plants</title>
    <style>body{background:#222;color:white;font-family:system-ui}img{width:45vw}figure{display:inline-block}</style>
    <h1>1000 actual canonical plants: full field, iso/perspective/night and close tier transition</h1>
    ${images.map(file => `<figure><img src="${file}"><figcaption>${file}</figcaption></figure>`).join("\n")}`);
  console.log(`Captured ${images.length} actual1000 canonical plant views`);
} finally { await browser?.close(); await server.close(); }
