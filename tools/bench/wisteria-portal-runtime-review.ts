import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const lodProof = process.argv.includes("--lod");
const romanGardenProof = process.argv.includes("--roman-garden");
const mapleProof = process.argv.includes("--maple");
const treeProof = process.argv.includes("--trees");
const woodenLanternProof = process.argv.includes("--wooden-lanterns");
const run = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid Wisteria runtime run label");
const output = resolve("../resources/project-reviews/wisteria-portal-runtime-2026-11-04", run);
if (existsSync(output)) throw new Error("Preserve previous evidence; use a new run label");
mkdirSync(output, { recursive: true });
let proofIds = ["japanese-hanging-lantern-torii", "chinese-hanging-lantern-pailou",
  "wisteria-curved", "wisteria-lattice", "wisteria-pergola"];
if (treeProof) proofIds = ["wisteria-tree-0", "wisteria-tree-1", "wisteria-tree-2"];
if (woodenLanternProof) proofIds = ["japanese-wooden-lantern", "chinese-wooden-lantern"];
if (romanGardenProof) proofIds = [
  ...[0, 1, 2].map(variant => `roadDecoration:plant-compact-willow-standalone-ground-${variant}:native`),
  ...[0, 1, 2].map(variant => `roadDecoration:plant-columnar-cypress-roadside-ground-${variant}:native`),
  ...["roman-doric-column", "roman-ionic-column"].flatMap(content =>
    ["limestone", "marble"].map(finish => `roadDecoration:${content}:${finish}`))
];
if (mapleProof) proofIds = ["red-maple", "red-maple-yellow", "red-maple-orange"].flatMap(species =>
  [0, 1, 2].map(variant => `roadDecoration:plant-${species}-standalone-ground-${variant}:native`));
const sources = [
  "src/render-common/wisteria-hero-graph.ts", "src/render-common/wisteria-hero-frame.ts",
  "src/render-common/wisteria-lod-layout.ts", "src/render-common/wisteria-structure-clearance.ts",
  "src/renderers/three/wisteria-hero.ts", "src/renderers/three/wisteria-production-model.ts",
  "src/renderers/three/wisteria-minimal-templates.ts", "src/renderers/three/wisteria-population-templates.ts",
  "src/renderers/three/road-decoration-hanging-lanterns.ts", "src/renderers/three/road-decoration-asset-loader.ts",
  "src/renderers/three/premium-decoration-loader.ts",
  "src/render-common/road-decoration-hanging-lanterns.ts", "src/render-common/road-decoration-eastern.ts",
  "src/render-common/road-decoration-japanese.ts", "src/renderers/three/road-decoration-model.ts",
  "src/shared/settlement/road-decoration-additions.ts", "src/render-common/road-decoration-clearance.ts",
  "src/renderers/three/plants/ornamental-decoration-profile.ts",
  "src/renderers/three/plants/ornamental-plant-lod.ts",
  "src/renderers/three/plants/ornamental-plant-overview.ts",
  "src/renderers/three/plants/ornamental-plant-overview-geometry.ts",
  "src/renderers/three/road-decoration-templates.ts",
  "src/renderers/three/settlement/three-road-decorations.ts",
  "src/renderers/three/wisteria-botanical-templates.ts",
  "src/renderers/three/wisteria-botanical-materials.ts",
  "tools/bench/wisteria-portal-runtime-review.ts",
  ...(woodenLanternProof ? ["src/render-common/road-decoration-wood-lanterns.ts",
    "src/renderers/three/road-decoration-wood-lantern.ts"] : []),
  "../island-of-settlers-shared/src/road-decoration-additions.ts",
  ...(treeProof ? ["src/render-common/plants/wisteria-tree-graph.ts",
    "src/renderers/three/plants/wisteria-tree-florets.ts",
    "src/renderers/three/plants/wisteria-tree-model.ts", "src/renderers/three/plants/wisteria-tree-templates.ts",
    "src/renderers/three/plants/wisteria-tree-bark.ts", "assets/botanical-textures/wisteria-tree-lod-albedo.png",
    "assets/botanical-textures/wisteria-tree-lod-albedo.json"] : []),
  ...(mapleProof ? ["src/render-common/plants/maple-tree-graph.ts",
    "src/renderers/three/plants/maple-tree-model.ts", "src/renderers/three/plants/maple-connected-wood.ts",
    "src/renderers/three/plants/maple-display-limb.ts", "src/renderers/three/plants/maple-leaf-textures.ts",
    "src/renderers/three/plants/maple-production-leaf-geometry.ts", "src/renderers/three/plants/maple-bark-material.ts",
    "src/renderers/three/plants/maple-leaf-material.ts", "src/renderers/three/plants/maple-tree-far-model.ts",
    "src/renderers/three/plants/maple-far-alpha.ts", "../island-of-settlers-shared/src/road-plant-models.ts"] : []),
  ...(romanGardenProof ? ["src/render-common/plants/roman-garden-tree-graph.ts",
    "src/render-common/plants/roman-garden-tree-physical.ts", "src/renderers/three/plants/roman-garden-tree-model.ts",
    "src/renderers/three/plants/roman-garden-tree-materials.ts", "src/renderers/three/plants/cypress-foliage-core.ts",
    "src/renderers/three/roman-column-decoration.ts", "src/renderers/three/roman-column-geometry.ts",
    "../island-of-settlers-shared/src/catalog/data/decorations/structures.json",
    "../island-of-settlers-shared/src/road-plant-models.ts"] : []),
  ...(lodProof ? ["public/icons/road-decorations/ornamental-overview.json",
    ...proofIds.map(id => {
      const [, content, finish] = id.split(":");
      return `public/icons/road-decorations/${content ?? id}-${finish ?? "native"}.png`;
    })] : [])
];
const hashesOf = () => Object.fromEntries(sources.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const hashes = hashesOf(), errors: string[] = [], records: unknown[] = [], images: string[] = [];
const ids = proofIds;
const { server, url } = await startDevServer({ unlockAll: false });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
let phase = "browser boot";
try {
  browser = await launchBrowser();
  for (const detailed of [true, false]) {
    phase = `${detailed ? "high" : "minimal"} setup`;
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/wisteria-runtime.html", route => route.fulfill({
      contentType: "text/html", body: "<body style='margin:0'></body>"
    }));
    await page.goto(`${url}wisteria-runtime.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const { createRoadDecorationState } = await imp("/src/shared/settlement/road-decoration-state.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(1100, 900); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.shadowMap.enabled = detailed; renderer.toneMapping = t.ACESFilmicToneMapping;
      renderer.debug.onShaderError = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
        throw new Error(gl.getProgramInfoLog(program) ?? "Wisteria shader error");
      };
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#b5bfae");
      scene.add(new t.HemisphereLight("#fff6e6", "#687b67", 2.1));
      const sun = new t.DirectionalLight("#fff1dc", 2.7); sun.position.set(11, 13, 23);
      sun.target.position.set(10, 0, 10); sun.castShadow = detailed;
      Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 6, bottom: -5 });
      sun.shadow.mapSize.set(1024, 1024); sun.shadow.normalBias = .01; scene.add(sun, sun.target);
      const ground = new t.Mesh(new t.PlaneGeometry(32, 32), new t.MeshStandardMaterial({ color: "#8b9873" }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(10, -.006, 10); ground.receiveShadow = detailed; scene.add(ground);
      const base = createRomanMaterials(detailed), packs = new Map<string, any>();
      const materialsFor = (nation: string) => {
        if (!packs.has(nation)) packs.set(nation, createNationBuildingMaterials(base.materials, nation, detailed));
        return packs.get(nation).materials;
      };
      const owner = createThreeRoadDecorations({ cellsX: 32, cellsZ: 32, fogDisplayDisabled: true, fogRevision: 0 },
        detailed, materialsFor);
      scene.add(owner.root, owner.ghostRoot);
      const context = () => ({ nation: "roman", roads: [], heightAt: () => 0,
        isOwned: () => true, isFree: () => true });
      const state = createRoadDecorationState(context);
      const camera = new t.PerspectiveCamera(35, 1100 / 900, .02, 1000);
      let selectedTree = false;
      let selectedWoodenLantern = false;
      let portalTriangles = 0;
      let gardenKind = "";
      (window as any).portalReview = {
        select: async (id: string) => {
          const item = id.startsWith("roadDecoration:") ? id : `roadDecoration:${id}:native`;
          const content = item.split(":")[1]!;
          gardenKind = "";
          if (content.includes("compact-willow")) gardenKind = "willow";
          if (content.includes("columnar-cypress")) gardenKind = "cypress";
          if (content.includes("plant-red-maple")) gardenKind = "maple";
          if (content.startsWith("roman-")) gardenKind = "column";
          selectedTree = content.startsWith("wisteria-tree-");
          selectedWoodenLantern = id.endsWith("-wooden-lantern");
          // Actual independent CPU geometry counts; hanging portals intentionally share near/far geometry.
          portalTriangles = 0;
          if (id === "japanese-hanging-lantern-torii") portalTriangles = detailed ? 2068 : 872;
          if (id === "chinese-hanging-lantern-pailou") portalTriangles = detailed ? 6720 : 1388;
          state.load(undefined);
          const order = { item, position: { x: 10, z: 10 }, yaw: Math.PI / 4 };
          let consumed = 0;
          const placed = state.place(order, () => { consumed++; return true; });
          if (!placed.ok || consumed !== 1) throw new Error(`Actual placement failed: ${JSON.stringify(placed)}`);
          for (let turn = 0; turn < 4; turn++) {
            if (!state.rotate(placed.uid).ok || state.frames()[0]?.uid !== placed.uid)
              throw new Error("Rotation changed decoration identity");
          }
          if (!state.move(placed.uid, { x: 12, z: 10 }, order.yaw).ok ||
            !state.move(placed.uid, order.position, order.yaw).ok || consumed !== 1)
            throw new Error("Move changed held custody or failed to retain the decoration");
          const saved = state.save(); state.load(saved);
          if (JSON.stringify(state.save()) !== JSON.stringify(saved)) throw new Error("Saved identity changed");
          if (selectedWoodenLantern) { camera.position.set(11.1, 1.2, 12); camera.lookAt(10, .6, 10); }
          else { camera.position.set(14.2, 4.8, 17.2); camera.lookAt(10, 1.65, 10); }
          owner.update(state.frames(), camera, 900); await owner.ready(); owner.root.updateMatrixWorld(true);
          const stats = owner.statistics();
          if (stats.instances !== 1 || stats.pending || stats.errors || !owner.root.children.length)
            throw new Error(`Runtime did not load a real model: ${JSON.stringify(stats)}`);
          const post = id.startsWith("wisteria") ? 1 : 1.44;
          let x = 10 + post * Math.cos(Math.PI / 4), z = 10 - post * Math.sin(Math.PI / 4);
          if (selectedTree || selectedWoodenLantern || gardenKind) {
            const support = state.frames()[0]!.supports[0]!;
            x = (support.min[0] + support.max[0]) / 2;
            z = (support.min[2] + support.max[2]) / 2;
          }
          const hit = owner.pick(new t.Raycaster(new t.Vector3(x, 10, z), new t.Vector3(0, -1, 0)));
          if (hit?.uid !== placed.uid || !owner.setHover(placed.uid)) throw new Error("Actual placed model is not pickable");
          owner.setHover(null);
          owner.updateGhost({ item, position: [14, 0, 10], yaw: 0, valid: true }); await owner.ready();
          if (!owner.ghostRoot.children.length) throw new Error("Actual preview produced no geometry");
          owner.updateGhost(null);
          const step = .05;
          if (!selectedTree && !selectedWoodenLantern && !gardenKind) for (let z = 7; z <= 13; z += step) {
            // A true static passage query is also used by live settlement navigation.
            const localX = 10 + (z - 10) * Math.sin(Math.PI / 4);
            const localZ = 10 + (z - 10) * Math.cos(Math.PI / 4);
            if (!state.isSupportClear({ x: localX, z: localZ }, .18)) throw new Error("Canonical pedestrian passage blocked");
          }
          return { id, saved, ...stats };
        },
        draw: async (view: string) => {
          if (["near", "far", "overview"].includes(view)) {
            let distance = 400;
            // A mature maple's broad conservative crown still exceeds35px at the arch's400m witness.
            if (gardenKind === "maple" && view === "overview") distance = 800;
            if (view === "near") distance = 6;
            else if (view === "far") distance = 85;
            // The mature tree crowns exceed the arch fixture's near framing.
            // At 12m all three rotated crowns fit while retaining the true near tier.
            if ((selectedTree || gardenKind === "willow" || gardenKind === "cypress" || gardenKind === "maple") && view === "near") distance = 12;
            if (portalTriangles && view === "near") distance = 12;
            if (selectedWoodenLantern) {
              distance = 150;
              if (view === "near") distance = 2.5;
              else if (view === "far") distance = 30;
            }
            let targetHeight = 1.65;
            if (selectedWoodenLantern) targetHeight = .6;
            if (gardenKind === "willow" || gardenKind === "cypress" || gardenKind === "maple") targetHeight = 2.4;
            camera.position.set(10, targetHeight + distance * .12, 10 + distance);
            camera.lookAt(10, targetHeight, 10);
            const fullyFramed = () => {
              camera.updateMatrixWorld();
              return state.frames().every((frame: any) => frame.volumes.every((box: any) => {
                for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]])
                  for (const z of [box.min[2], box.max[2]]) {
                    const point = new t.Vector3(x, y, z).project(camera);
                    if (Math.abs(point.x) > .98 || Math.abs(point.y) > .98 || Math.abs(point.z) > 1) return false;
                  }
                return true;
              }));
            };
            // Retain the real selector's near tier while fitting every reserved corner, not only the trunk.
            if (view === "near") for (let attempt = 0; !fullyFramed() && attempt < 12; attempt++)
              camera.position.sub(new t.Vector3(10, targetHeight, 10)).multiplyScalar(1.15)
                .add(new t.Vector3(10, targetHeight, 10));
            if (!fullyFramed()) throw new Error(`Single decoration is clipped in ${view}`);
            owner.update(state.frames(), camera, 900); await owner.ready();
            const triangles = () => {
              let count = 0;
              owner.root.traverseVisible((node: any) => { if (node.isMesh) count +=
                (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3 * (node.isInstancedMesh ? node.count : 1); });
              return count;
            };
            const visibleTriangles = triangles();
            if (portalTriangles && view !== "overview" && visibleTriangles !== portalTriangles)
              throw new Error(`Hanging portal source changed or wrong tier: ${view}/${visibleTriangles}/${portalTriangles}`);
            if (selectedWoodenLantern && view !== "overview" &&
              (visibleTriangles <= 2 || visibleTriangles > (view === "near" && detailed ? 3500 : 1000)))
              throw new Error(`Wooden lantern model tier failed: ${view}/${visibleTriangles}`);
            if (gardenKind && view !== "overview") {
              let cap = detailed ? 24000 : 6000;
              if (view === "far") cap = 1800;
              if (gardenKind === "maple") {
                cap = detailed ? 24000 : 8075;
                if (view === "far") cap = 2116;
              }
              if (gardenKind === "column") {
                cap = detailed ? 6500 : 1800;
                if (view === "far") cap = 700;
              }
              const willowIcon = gardenKind === "willow" && view === "far";
              if (willowIcon ? visibleTriangles !== 2 : visibleTriangles <= 2 || visibleTriangles > cap)
                throw new Error(`Roman garden actual tier/budget failed: ${gardenKind}/${view}/${visibleTriangles}/${cap}`);
            }
            let highNearLimit = 24000;
            if (selectedTree) highNearLimit = 30000;
            if (!gardenKind && !selectedWoodenLantern && !portalTriangles && view === "near" && detailed &&
              (visibleTriangles < 20000 || visibleTriangles > highNearLimit))
              throw new Error(`True3D near was not selected: ${visibleTriangles}`);
            if (!gardenKind && !selectedWoodenLantern && !portalTriangles && view === "near" && !detailed && (visibleTriangles < 1000 || visibleTriangles > 6000))
              throw new Error(`Minimal near was not selected: ${visibleTriangles}`);
            if (!gardenKind && !selectedWoodenLantern && !portalTriangles && view === "far" && (visibleTriangles < 1000 || visibleTriangles > 4000))
              throw new Error(`Atlas far was not selected: ${visibleTriangles}`);
            if (view === "overview" && visibleTriangles !== 2)
              throw new Error(`Two triangle overview was not selected: ${visibleTriangles}`);
            renderer.render(scene, camera);
            return { visibleTriangles, fullyFramed: fullyFramed(), cameraDistance: camera.position.distanceTo(new t.Vector3(10, targetHeight, 10)),
              ...owner.statistics(), calls: renderer.info.render.calls,
              triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures,
              geometries: renderer.info.memory.geometries };
          }
          if (view === "front") camera.position.set(14.2, 4.8, 17.2);
          else camera.position.set(8.9, 3.1, 13.5);
          camera.lookAt(10, view === "front" ? 1.65 : 2.5, 10); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
        },
        stress: async () => {
          const source = state.frames()[0];
          if (!source) throw new Error("Missing base frame for stress");
          // LOD already consumes each reservation's union. Reuse that exact conservative authored
          // envelope for repeated garden fixtures instead of allocating millions of tiny crown cells.
          const stressVolumes = gardenKind ? [{
            min: [0, 1, 2].map(axis => Math.min(...source.volumes.map((box: any) => box.min[axis]))),
            max: [0, 1, 2].map(axis => Math.max(...source.volumes.map((box: any) => box.max[axis])))
          }] : source.volumes;
          const frames = Array.from({ length: 1000 }, (_, index) => {
            const x = (index % 32) * 4, z = Math.floor(index / 32) * 4;
            const translate = (box: any) => ({ min: [box.min[0] + x - source.position[0], box.min[1], box.min[2] + z - source.position[2]],
              max: [box.max[0] + x - source.position[0], box.max[1], box.max[2] + z - source.position[2]] });
            return { ...source, uid: index + 1, item: source.item, position: [x, 0, z],
              volumes: stressVolumes.map(translate), supports: source.supports.map(translate) };
          });
          camera.position.set(64, 95, 180); camera.lookAt(64, 0, 64);
          // Count actual fully framed instances; do not certify offscreen populations by metadata alone.
          const fullyFramed = () => {
            camera.updateMatrixWorld();
            let count = 0;
            for (const frame of frames) {
              const framed = frame.volumes.every((box: any) => {
                for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]])
                  for (const z of [box.min[2], box.max[2]]) {
                    const projected = new t.Vector3(x, y, z).project(camera);
                    if (Math.abs(projected.x) > .98 || Math.abs(projected.y) > .98 ||
                      projected.z < -1 || projected.z > 1) return false;
                  }
                return true;
              });
              if (framed) count++;
            }
            return count;
          };
          for (let attempt = 0; fullyFramed() !== 1000 && attempt < 12; attempt++)
            camera.position.sub(new t.Vector3(64, 0, 64)).multiplyScalar(1.15).add(new t.Vector3(64, 0, 64));
          if (fullyFramed() !== 1000) throw new Error("Population is not fully inside the actual camera frustum");
          owner.update(frames, camera, 900); await owner.ready();
          let visibleTriangles = 0;
          owner.root.traverseVisible((node: any) => { if (node.isMesh) visibleTriangles +=
            (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3 * (node.isInstancedMesh ? node.count : 1); });
          const stats = owner.statistics();
          if (stats.instances !== 1000 || stats.errors || stats.pending || visibleTriangles > (detailed ? 100000 : 60000))
            throw new Error(`Structural1000 LOD is not bounded: ${JSON.stringify({ ...stats, visibleTriangles })}`);
          renderer.render(scene, camera);
          return { ...stats, fullyFramed: fullyFramed(), visibleTriangles, calls: renderer.info.render.calls,
            textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
        },
        finish: () => {
          const first = state.pickUp(1), duplicate = state.pickUp(1);
          const returned = state.claimReturns(state.returns().map((row: any) => row.id), () => true);
          if (first.returned !== 1 || duplicate.returned !== 0 || returned.returned !== 1)
            throw new Error("Placed custody was not returned exactly once");
          owner.update(state.frames(), camera, 900); renderer.render(scene, camera);
        },
        dispose: () => {
          owner.dispose(); for (const pack of packs.values()) pack.dispose(); base.dispose();
          ground.geometry.dispose(); ground.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
        }
      };
    }, detailed);
    try {
      for (const id of ids) {
        phase = `${detailed ? "high" : "minimal"} ${id} placement/loading`;
        const placed = await page.evaluate(id => (window as any).portalReview.select(id), id);
        for (const view of lodProof ? ["near", "far", "overview", "near"] : ["front", "detail"]) {
          phase = `${detailed ? "high" : "minimal"} ${id} ${view}`;
          const metrics = await page.evaluate(view => (window as any).portalReview.draw(view), view);
          const file = `${detailed ? "high" : "minimal"}-${id}-${view}-${images.length}.png`;
          await page.screenshot({ path: resolve(output, file) }); images.push(file);
          records.push({ detailed, id, view, placed, metrics });
        }
        if (lodProof) {
          const metrics = await page.evaluate(id => (window as any).portalReview.stress(id), id);
          const file = `${detailed ? "high" : "minimal"}-${id}-1000.png`;
          await page.screenshot({ path: resolve(output, file) }); images.push(file);
          records.push({ detailed, id, view: "1000", metrics });
        }
        await page.evaluate(() => (window as any).portalReview.finish());
      }
    } finally { await page.evaluate(() => (window as any).portalReview?.dispose()); await page.close(); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashesOf(), hashes);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ hashes, errors, records,
    scope: "Actual decoration renderer and domain placement/custody; not authenticated purchases or posed actor clearance." }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Wisteria runtime</title>
    <style>body{font:16px sans-serif;background:#20251f;color:white}img{max-width:96vw}figure{margin:1rem}</style>
    ${images.map(file => `<figure><figcaption>${file}</figcaption><img src="${file}"></figure>`).join("\n")}`);
  console.log(JSON.stringify({ output, images: images.length, records: records.length }));
} catch (error) {
  writeFileSync(resolve(output, "failure.json"), JSON.stringify({ phase, error: String(error), hashes,
    errors, records, images }, null, 2));
  throw error;
} finally { await browser?.close(); await server.close(); }
