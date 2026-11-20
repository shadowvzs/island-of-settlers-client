import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { renderWareIcon, setupWareIconRenderer } from "./ware-icon-renderer";

const output = resolve("../resources/project-reviews/iron-ingot-2026-11-02");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/iron-review.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}iron-review.html`);
  await page.evaluate(setupWareIconRenderer);
  const icon = await page.evaluate(renderWareIcon, "iron");
  writeFileSync(resolve("assets/ware-icons/iron.png"), Buffer.from(icon.png, "base64"));
  writeFileSync(resolve(output, "iron-icon.png"), Buffer.from(icon.png, "base64"));
  reports.push(icon.stats);
  await page.evaluate(() => {
    const state = (window as any).__wareIcons;
    for (const model of state.models.values()) model.dispose();
    state.materialPack.dispose(); state.reflection.dispose(); state.renderer.dispose();
  });
  for (const detailed of [true, false]) {
    const captures = await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/@id/three");
      const { RoomEnvironment } = await imp("/@id/three/examples/jsm/environments/RoomEnvironment.js");
      const { ThreeWorkerPack } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts");
      const { createWorkerPoser, createWorkerTextureLoader } = await imp("/src/renderers/three/three-worker.ts");
      const { createWorkerProp } = await imp("/src/renderers/three/three-worker-prop.ts");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createRomanBuilding } = await imp("/src/renderers/three/buildings/roman-building.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { createWareModel } = await imp("/src/renderers/three/settlement/ware-models.ts");
      const { getWareCarryAction } = await imp("/src/render-common/wares/ware-catalog.ts");
      const { WORKER_SCALE } = await imp("/src/render-common/workers/worker-dimensions.ts");
      const renderer = new three.WebGLRenderer({ antialias: detailed, preserveDrawingBuffer: true });
      renderer.setSize(1100, 900); renderer.toneMapping = three.ACESFilmicToneMapping;
      const scene = new three.Scene(); scene.background = new three.Color("#c6d0be");
      const environment = new RoomEnvironment(), pmrem = new three.PMREMGenerator(renderer);
      const reflection = pmrem.fromScene(environment, .04); scene.environment = reflection.texture;
      scene.environmentIntensity = .7; environment.dispose(); pmrem.dispose();
      scene.add(new three.HemisphereLight("#fff1db", "#667854", 1.5));
      const sun = new three.DirectionalLight("#fff1db", 2.5); sun.position.set(-4, 8, 6); scene.add(sun);
      const floor = new three.Mesh(new three.PlaneGeometry(30, 30), new three.MeshStandardMaterial({ color: "#829766" }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.001; scene.add(floor);
      const camera = new three.PerspectiveCamera(35, 1100 / 900, .01, 100);
      const materials = createRomanMaterials(detailed);
      const captures: any[] = [];
      const capture = (name: string, target: any, offset: any, facts: any = {}) => {
        camera.position.copy(target).add(offset); camera.lookAt(target); scene.updateMatrixWorld(true);
        renderer.render(scene, camera); renderer.getContext().finish();
        captures.push({ name, ...facts, png: renderer.domElement.toDataURL("image/png").split(",")[1] });
      };
      const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, createWorkerTextureLoader(renderer));
      const manifest = await fetch("workers/tripo/manifest.json").then(response => response.json());
      const entry = manifest.workers.find((candidate: any) => candidate.nation === "roman");
      const worker = await pack.load(entry.nation, entry.variant);
      worker.root.scale.setScalar(WORKER_SCALE); scene.add(worker.root);
      const pose = createWorkerPoser(worker), prop = createWorkerProp(pack, worker, detailed);
      const stock = createWareModel("iron", detailed, materials.materials);
      stock.root.scale.setScalar(WORKER_SCALE); stock.root.updateMatrixWorld(true);
      const bottom = new three.Box3().setFromObject(stock.root).min.y;
      stock.root.position.set(.7, -bottom, 0); scene.add(stock.root);
      const action = getWareCarryAction("iron");
      const frame: any = { nation: entry.nation, variant: entry.variant, x: 0, y: 0, z: 0, heading: 0,
        selected: false, action, animationTime: .35, gaitPhase: 0, runBlend: 0, target: null,
        carryingWare: "iron", workerJob: "Carrier" };
      for (let tick = 0; tick < 25; tick++) { pose(frame); prop.update(frame); await new Promise(resolve => setTimeout(resolve, 10)); }
      const load = worker.root.getObjectByName("ware_iron");
      if (!load?.visible) throw new Error("Actual carried iron is missing");
      scene.updateMatrixWorld(true);
      const stockBottom = new three.Box3().setFromObject(stock.root).min.y;
      if (Math.abs(stockBottom) > 1e-6) throw new Error(`Floating iron stock: ${stockBottom}`);
      capture("carry-stock-close", new three.Vector3(.2, .55, 0), new three.Vector3(2.8, 1.8, 3.8),
        { action, stockBottom, stockTriangles: stock.triangles() });
      capture("carry-stock-gameplay", new three.Vector3(.2, .4, 0), new three.Vector3(5, 6, 8));
      stock.dispose(); worker.root.visible = false;
      const building = createRomanBuilding(getBuildingDefinition(26), materials.materials, detailed);
      building.fitToGrid(); scene.add(building.root);
      building.update(0, { construction: 1, door: 0, inputStock: {}, outputStock: { iron: 6 }, working: false });
      building.root.updateMatrixWorld(true);
      const outputBounds = new three.Box3(), slots = new Set();
      building.root.traverse((object: any) => {
        if (!object.isMesh || !object.visible || object.userData.stock?.ware !== "iron") return;
        outputBounds.union(new three.Box3().setFromObject(object)); slots.add(object.userData.stock.slot);
      });
      if (slots.size !== 6) throw new Error(`Expected six output ingots, received ${slots.size}`);
      const target = outputBounds.getCenter(new three.Vector3());
      capture("smelter-output-close", target, new three.Vector3(-1.5, 1.25, 2), { quantity: slots.size });
      const bounds = new three.Box3().setFromObject(building.root), span = bounds.getSize(new three.Vector3()).length();
      capture("smelter-output-gameplay", bounds.getCenter(new three.Vector3()), new three.Vector3(-.65, .65, 1).multiplyScalar(span));
      building.dispose(); materials.dispose(); reflection.dispose(); renderer.dispose();
      return captures;
    }, detailed);
    for (const { name, png, ...facts } of captures) {
      const quality = detailed ? "high" : "minimal";
      writeFileSync(resolve(output, `${quality}-${name}.png`), Buffer.from(png, "base64"));
      reports.push({ quality, name, ...facts });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, reports, errors }, null, 2));
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  await browser.close(); await server.close();
}
