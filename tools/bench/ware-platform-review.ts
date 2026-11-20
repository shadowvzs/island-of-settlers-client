import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { WARE_IDS } from "../../src/render-common/wares/ware-catalog";
import { launchBrowser, startDevServer } from "./browser";
import { renderWareIcon, setupWareIconRenderer } from "./ware-icon-renderer";

const output = resolve(process.env.WARE_PLATFORM_REVIEW_OUTPUT ?? "../resources/project-reviews/ware-platform-current");
const canonicalWares = new Set<string>(WARE_IDS);
const wares = process.env.WARES?.split(",") ?? WARE_IDS;
assert(wares.every(id => canonicalWares.has(id)), "Review wares must be canonical IDs");
const carryWares = process.env.CARRY_WARES?.split(",") ?? ["iron", "leather", "hides", "pig", "boat", "wine",
  "logs", "planks", "hardwoodLogs", "hardwoodPlanks", "cedarLogs", "cedarPlanks", "walnutLogs",
  "walnutPlanks", "mahoganyLogs", "mahoganyPlanks"];
assert(carryWares.every(id => canonicalWares.has(id)), "Carried wares must be canonical IDs");
const carryViews = process.env.CARRY_VIEWS?.split(",") ?? ["front"];
assert(carryViews.every(view => view === "front" || view === "back"), "Choose front/back carry views");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/ware-platform-review.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}ware-platform-review.html`);
  if (process.env.CARRY_ONLY !== "1") {
  await page.evaluate(setupWareIconRenderer);
  for (const detailed of [true, false]) {
    const quality = detailed ? "high" : "minimal";
    await page.evaluate(async detailed => {
      const { createWareModel } = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/ware-models.ts"));
      (window as any).__wareIcons.createWareIconModel = (id: string, materials: any) => createWareModel(id, detailed, materials);
    }, detailed);
    for (const id of wares) {
      const result = await page.evaluate(renderWareIcon, id);
      writeFileSync(resolve(output, `${quality}-${id}.png`), Buffer.from(result.png, "base64"));
      reports.push({ quality, ...result.stats });
    }
    await page.route(`**/canonical-${quality}-*.png`, route => {
      const file = new URL(route.request().url()).pathname.split("canonical-")[1]!;
      return route.fulfill({ path: resolve(output, file), contentType: "image/png" });
    });
    const cards = wares.map(id => `<figure><img src="${url}canonical-${quality}-${id}.png"><figcaption>${id}</figcaption></figure>`);
    await page.setContent(`<style>body{background:#eee2c9;color:#392c20;font:14px Georgia;margin:12px}main{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}figure{margin:0;text-align:center;border:1px solid #a98c61;background:#fff7e8}img{width:125px;height:125px;display:block;margin:auto}</style><main>${cards.join("")}</main>`);
    await page.evaluate(async () => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: resolve(output, `${quality}-all-canonical-wares.png`), fullPage: true });
  }
  }
  await page.goto(`${url}ware-platform-review.html`);
  for (const detailed of [true, false]) {
    const captures = await page.evaluate(async ({ carryViews, carryWares, detailed }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/@id/three");
      const { ThreeWorkerPack } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts");
      const { createWorkerPoser, createWorkerTextureLoader } = await imp("/src/renderers/three/three-worker.ts");
      const { createWorkerProp } = await imp("/src/renderers/three/three-worker-prop.ts");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createWareModel } = await imp("/src/renderers/three/settlement/ware-models.ts");
      const { getWareCarryAction } = await imp("/src/render-common/wares/ware-catalog.ts");
      const { WORKER_SCALE } = await imp("/src/render-common/workers/worker-dimensions.ts");
      const renderer = new three.WebGLRenderer({ antialias: detailed, preserveDrawingBuffer: true });
      renderer.setSize(900, 750); renderer.toneMapping = three.ACESFilmicToneMapping;
      const scene = new three.Scene(); scene.background = new three.Color("#c6d0be");
      scene.add(new three.HemisphereLight("#fff1db", "#667854", 2));
      const sun = new three.DirectionalLight("#fff1db", 2.5); sun.position.set(-4, 8, 6); scene.add(sun);
      const floor = new three.Mesh(new three.PlaneGeometry(20, 20), new three.MeshStandardMaterial({ color: "#829766" }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.001; scene.add(floor);
      const camera = new three.PerspectiveCamera(35, 900 / 750, .01, 100);
      const materials = createRomanMaterials(detailed);
      const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, createWorkerTextureLoader(renderer));
      const manifest = await fetch("workers/tripo/manifest.json").then(response => response.json());
      const entry = manifest.workers.find((candidate: any) => candidate.nation === "roman");
      const worker = await pack.load(entry.nation, entry.variant);
      worker.root.scale.setScalar(WORKER_SCALE); scene.add(worker.root);
      const pose = createWorkerPoser(worker), prop = createWorkerProp(pack, worker, detailed);
      const captures: any[] = [];
      for (const ware of carryWares) {
        const stock = createWareModel(ware, detailed, materials.materials);
        stock.root.scale.setScalar(WORKER_SCALE); stock.root.updateMatrixWorld(true);
        if (ware === "pig") {
          const { waitForImportedPigTextures } = await imp("/src/renderers/three/buildings/imported-pig.ts");
          await waitForImportedPigTextures();
        }
        const bottom = new three.Box3().setFromObject(stock.root).min.y;
        stock.root.position.set(.7, -bottom, 0); scene.add(stock.root);
        const action = getWareCarryAction(ware);
        const frame: any = { nation: entry.nation, variant: entry.variant, x: 0, y: 0, z: 0, heading: 0,
          selected: false, action, animationTime: .35, gaitPhase: 0, runBlend: 0, target: null,
          carryingWare: ware, workerJob: "Carrier" };
        for (let tick = 0; tick < 25; tick++) { pose(frame); prop.update(frame); await new Promise(resolve => setTimeout(resolve, 10)); }
        const load = worker.root.getObjectByName(`ware_${ware}`);
        if (!load?.visible) throw new Error(`${ware}: actual carried mesh missing`);
        scene.updateMatrixWorld(true);
        const stockBottom = new three.Box3().setFromObject(stock.root).min.y;
        if (Math.abs(stockBottom) > 1e-6) throw new Error(`${ware}: floating stock ${stockBottom}`);
        for (const view of carryViews) {
          const facing = view === "back" ? -1 : 1;
          camera.position.set(2.8 * facing, 1.8, 3.8 * facing); camera.lookAt(.2, .55, 0);
          renderer.render(scene, camera); renderer.getContext().finish();
          captures.push({ ware, action, stockBottom, view,
            png: renderer.domElement.toDataURL("image/png").split(",")[1] });
        }
        stock.root.removeFromParent();
        stock.dispose();
      }
      prop.dispose(); worker.dispose(); pack.dispose(); materials.dispose();
      floor.geometry.dispose(); floor.material.dispose();
      renderer.dispose();
      return captures;
    }, { carryViews, carryWares, detailed });
    for (const { png, ...capture } of captures) {
      const suffix = capture.view === "back" ? "-back" : "";
      writeFileSync(resolve(output, `${detailed ? "high" : "minimal"}-carry-stock-${capture.ware}${suffix}.png`),
        Buffer.from(png, "base64"));
      reports.push({ detailed, ...capture });
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  await browser.close(); await server.close();
}
