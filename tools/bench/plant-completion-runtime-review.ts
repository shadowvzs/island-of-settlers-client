import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, plantCompletionModelFamily } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { launchBrowser, startDevServer } from "./browser";

const resume = process.argv.find(argument => argument.startsWith("--resume="))?.slice(9);
if (resume) assert(/^[a-z0-9-]+$/.test(resume));
const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/plant-completion-2026-11-05/runtime", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve completed evidence with a fresh run label");
mkdirSync(output, { recursive: true });
const paths = ["src/render-common/plants", "src/renderers/three/plants"].flatMap(directory =>
  readdirSync(directory).filter(file => file.startsWith("catalog-") || file.startsWith("plant-completion") ||
    file === "botanical-decoration-loader.ts").map(file => `${directory}/${file}`));
paths.push("src/renderers/three/road-decoration-asset-loader.ts", "src/renderers/three/road-decoration-templates.ts",
  "src/renderers/three/settlement/three-road-decorations.ts", "src/render-common/plants/ornamental-plant-clearance.ts",
  "../island-of-settlers-shared/src/road-plant-completion.ts", "../island-of-settlers-shared/src/road-plant-models.ts",
  "../island-of-settlers-shared/src/road-decoration-items.ts", "tools/bench/plant-completion-runtime-review.ts",
  "src/renderers/three/plants/ornamental-decoration-profile.ts");
const hashes = () => Object.fromEntries(paths.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sources = hashes();
const preservedFrames: { image: string; sha256: string; sourceRun: string }[] = [];
if (resume) for (const image of ["high-0-normal.png", "high-0-far.png", "high-1-normal.png"]) {
  const previous = resolve(output, "..", resume, image);
  assert(existsSync(previous), `Missing completed preceding frame: ${image}`);
  copyFileSync(previous, resolve(output, image));
  preservedFrames.push({ image, sourceRun: resume,
    sha256: createHash("sha256").update(readFileSync(previous)).digest("hex") });
}

const representatives = [...new Map(PLANT_COMPLETION_ITEM_IDS.map(id =>
  [plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!), id])).values()];
assert.equal(representatives.length, 8);
const groups = [
  representatives.filter(id => !/catalog-(shrub|flower|bonsai)$/.test(
    plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!)!)),
  representatives.filter(id => /catalog-(shrub|flower|bonsai)$/.test(
    plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!)!))
];
const { server, url } = await startDevServer({ unlockAll: false });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const reports: unknown[] = [], errors: string[] = [];
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/plant-completion.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}plant-completion.html`);
  for (const detailed of [true, false]) {
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const { createRoadDecorationState } = await imp("/src/shared/settlement/road-decoration-state.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(1100, 850); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; renderer.shadowMap.enabled = detailed;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#b6c6cb");
      scene.add(new t.HemisphereLight("#fff6e6", "#687b67", 2));
      const sun = new t.DirectionalLight("#fff2dc", 3); sun.position.set(10, 30, 25);
      sun.target.position.set(24, 0, 24); sun.castShadow = detailed; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
      sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
      scene.add(sun, sun.target);
      const ground = new t.Mesh(new t.PlaneGeometry(128, 128),
        new t.MeshStandardMaterial({ color: "#829970", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(32, -.01, 32); ground.receiveShadow = detailed;
      scene.add(ground);
      const owner = createThreeRoadDecorations({ cellsX: 128, cellsZ: 128,
        fogDisplayDisabled: true, fogRevision: 0 }, detailed,
      () => { throw new Error("Completion plant acquired national materials"); });
      scene.add(owner.root, owner.ghostRoot);
      const state = createRoadDecorationState(() => ({ nation: "roman", roads: [], heightAt: () => 0,
        isOwned: () => true, isFree: () => true }));
      const camera = new t.PerspectiveCamera(36, 1100 / 850, .01, 300);
      (window as any).plantCompletion = {
        draw: async (ids: string[], far: boolean) => {
          state.load(undefined); owner.update([]);
          const spacing = ids.length > 3 ? 4.5 : 1.25;
          for (const [index, item] of ids.entries()) {
            const position = { x: 20 + index % 3 * spacing, z: 20 + Math.floor(index / 3) * spacing };
            if (!state.place({ item, position, yaw: .4 }, () => true).ok) throw new Error(`Placement ${item}`);
            const uid = state.frames().at(-1).uid;
            if (!state.rotate(uid).ok || !state.move(uid, position, .4).ok) throw new Error(`Move/rotate ${item}`);
          }
          const saved = state.save(); state.load(saved);
          if (JSON.stringify(state.save()) !== JSON.stringify(saved)) throw new Error("Save identity changed");
          const bounds = new t.Box3();
          for (const frame of state.frames()) for (const box of frame.volumes) {
            bounds.expandByPoint(new t.Vector3(...box.min)); bounds.expandByPoint(new t.Vector3(...box.max));
          }
          const center = bounds.getCenter(new t.Vector3()), size = bounds.getSize(new t.Vector3());
          const distance = Math.max(size.x, size.y, size.z) * 2.2;
          const inspectPosition = center.clone().add(new t.Vector3(distance * .32, distance * .56, distance));
          camera.position.copy(inspectPosition);
          if (far) camera.position.sub(center).multiplyScalar(ids.length <= 3 ? 3 : 2.25).add(center);
          camera.lookAt(center); camera.updateMatrixWorld(true);
          owner.update(state.frames(), camera, 850); await owner.ready(); renderer.render(scene, camera);
          const statistics = owner.statistics();
          if (statistics.instances !== ids.length || statistics.pending || statistics.errors)
            throw new Error(`Missing actual templates ${JSON.stringify(statistics)}`);
          if (far && !owner.root.children.every((part: { name: string }) => part.name.includes(":far/")))
            throw new Error("Bounded camera did not select actual far representations");
          const selectedDistance = camera.position.distanceTo(center);
          // Inspect already selected far assets closely without changing their actual runtime LOD decision.
          if (far) { camera.position.copy(inspectPosition); camera.lookAt(center); camera.updateMatrixWorld(true); }
          owner.root.updateMatrixWorld(true);
          for (const frame of state.frames()) {
            const origin = new t.Vector3(frame.position[0], 30, frame.position[2]);
            if (owner.pick(new t.Raycaster(origin, new t.Vector3(0, -1, 0)))?.uid !== frame.uid)
              throw new Error(`Picking ${frame.item}`);
            if (!owner.setHover(frame.uid)) throw new Error(`Hover ${frame.item}`);
          }
          owner.setHover(null);
          owner.updateGhost({ item: ids[0], position: [40, 0, 40], yaw: 0, valid: true }); await owner.ready();
          if (!owner.ghostRoot.children.length) throw new Error("Empty canonical placement ghost");
          owner.updateGhost(null);
          renderer.render(scene, camera);
          const png = renderer.domElement.toDataURL("image/png");
          let returned = 0;
          const placedFrames = state.frames().slice();
          for (const frame of placedFrames) {
            if (state.pickUp(frame.uid).returned !== 1 || state.pickUp(frame.uid).returned !== 0)
              throw new Error("Pickup custody duplicated or lost");
          }
          const returns = state.returns().map((row: { id: number }) => row.id);
          state.claimReturns(returns, (items: Record<string, number>) => {
            returned += Object.values(items).reduce((sum, count) => sum + count, 0); return true;
          });
          state.claimReturns(returns, () => { throw new Error("Duplicate claimed custody"); });
          if (returned !== ids.length) throw new Error("Custody quantity changed");
          return { ids, far, selectedDistance, captureReframed: far, statistics, returned,
            triangles: renderer.info.render.triangles, png };
        },
        dispose: () => { owner.dispose(); state.load(undefined); ground.geometry.dispose(); ground.material.dispose();
          renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
      };
    }, detailed);
    try {
      for (const [index, ids] of groups.entries()) for (const far of [false, true]) {
        const image = `${detailed ? "high" : "minimal"}-${index}-${far ? "far" : "normal"}.png`;
        if (preservedFrames.some(frame => frame.image === image)) continue;
        const { png, ...report } = await page.evaluate(({ far, ids }) =>
          (window as any).plantCompletion.draw(ids, far), { ids, far });
        reports.push({ detailed, group: index, ...report });
        writeFileSync(resolve(output, image),
          Buffer.from(png.split(",")[1], "base64"));
      }
    } finally { await page.evaluate(() => (window as any).plantCompletion.dispose()); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), sources);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ sources, errors, reports, preservedFrames,
    preservationNote: "Three preceding frames completed every functional assertion before their PNG write. " +
      "A subsequent small-group camera assertion stopped that run; frozen model/icon sources remain unchanged." }, null, 2));
  console.log(`Captured8 bounded canonical runtime frames: ${output}`);
} finally { try { await browser?.close(); } finally { await server.close(); } }
