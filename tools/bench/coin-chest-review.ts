import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid coin chest review run");
const output = resolve("../resources/project-reviews/coin-chest-2026-11-04", run);
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/logistics/coin-chest.ts", "src/renderers/three/settlement/coin-chest-model.ts",
  "src/renderers/three/settlement/coin-chest-materials.ts"].map(path => ({ path,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: any[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/coin-chest.html", route => route.fulfill({ contentType: "text/html",
    body: "<body style='margin:0'></body>" }));
  await page.goto(`${url}coin-chest.html`);
  await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/@id/three");
    const { RoomEnvironment } = await imp("/@id/three/examples/jsm/environments/RoomEnvironment.js");
    const { createCoinChestModel } = await imp("/src/renderers/three/settlement/coin-chest-model.ts");
    const { createRomanHandcart } = await imp("/src/renderers/three/settlement/roman-handcart.ts");
    const { createWorkerHandcartGrip } = await imp("/src/renderers/three/worker-handcart-grip.ts");
    const { createWorkerPoser, createWorkerTextureLoader } = await imp("/src/renderers/three/three-worker.ts");
    const { WORKER_SCALE } = await imp("/src/render-common/workers/worker-dimensions.ts");
    const { HANDCART } = await imp("/src/render-common/logistics/handcart-rules.ts");
    const { ThreeWorkerPack } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts");
    const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1100, 850); renderer.setPixelRatio(1);
    renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = t.SRGBColorSpace; document.body.append(renderer.domElement);
    const scene = new t.Scene(); scene.background = new t.Color("#c5cbb9");
    const pmrem = new t.PMREMGenerator(renderer), room = new RoomEnvironment();
    const reflection = pmrem.fromScene(room, .04); scene.environment = reflection.texture;
    scene.environmentIntensity = .6; room.dispose(); pmrem.dispose();
    scene.add(new t.HemisphereLight("#fff4dd", "#6b765c", 1.7));
    const sun = new t.DirectionalLight("#fff1db", 2.4); sun.position.set(-3, 5, 4);
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .002;
    Object.assign(sun.shadow.camera, { left: -2, right: 2, bottom: -2, top: 3, near: .1, far: 20 });
    scene.add(sun);
    const ground = new t.Mesh(new t.PlaneGeometry(15, 15), new t.MeshStandardMaterial({ color: "#909a79", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.001; ground.receiveShadow = true; scene.add(ground);
    const camera = new t.PerspectiveCamera(35, 1100 / 850, .01, 60);
    const textures = createWorkerTextureLoader(renderer);
    const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, textures);
    const worker = await pack.load("roman", "roman-man-white");
    worker.root.scale.setScalar(WORKER_SCALE); worker.root.visible = false; scene.add(worker.root);
    const pose = createWorkerPoser(worker), grip = createWorkerHandcartGrip(worker.root);
    let chest: any, cart: any;
    const draw = (target: any, offset: any) => {
      camera.position.copy(target).add(offset); camera.lookAt(target);
      scene.updateMatrixWorld(true); renderer.render(scene, camera); renderer.getContext().finish();
    };
    (window as any).coinChestReview = {
      select: async (request: any) => {
        chest?.dispose(); cart?.dispose(); cart = undefined; worker.root.visible = false;
        const { detailed, lid, units } = request;
        renderer.shadowMap.enabled = detailed; sun.castShadow = detailed;
        chest = createCoinChestModel({ detailed, lid, units }); scene.add(chest.root);
        const face = chest.root.getObjectByName("face");
        if (face) {
          const image = face.material.map.image;
          const started = performance.now();
          while (!face.material.map.image?.complete) {
            if (performance.now() - started > 10000) throw new Error("Coin chest face bitmap failed");
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          await (face.material.map.image ?? image).decode();
        }
        return { triangles: chest.triangles, visualCoins: chest.visualCoins,
          units: chest.packing.length, bounds: new t.Box3().setFromObject(chest.root).min.toArray() };
      },
      draw: (view: string) => {
        if (view === "top") draw(new t.Vector3(0, .14, 0), new t.Vector3(.25, .85, .55));
        else if (view === "gameplay") draw(new t.Vector3(0, .15, 0), new t.Vector3(2.4, 2.8, 3.3));
        else draw(new t.Vector3(0, .29, 0), new t.Vector3(.95, .8, 1.25));
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      },
      cart: (detailed: boolean) => {
        cart = createRomanHandcart(detailed); scene.add(cart.root);
        chest.root.rotation.y = Math.PI / 2; chest.root.position.set(0, .427, -.045);
        worker.root.visible = true; worker.root.position.set(0, 0, HANDCART.carrierOffset);
        const frame = { nation: "roman", variant: "roman-man-white", action: "walk", animationTime: .3,
          gaitPhase: .3, runBlend: 0, heading: 0, x: 0, y: 0, z: HANDCART.carrierOffset, target: null,
          workerJob: "Carrier", selected: false, carryingWare: null };
        grip.reset(); pose(frame); worker.root.updateMatrixWorld(true);
        worker.root.position.y -= new t.Box3().setFromObject(worker.root).min.y;
        grip.apply(cart.root);
        draw(new t.Vector3(0, .5, .15), new t.Vector3(1.65, 1.35, 2.15));
        const box = new t.Box3().setFromObject(chest.root);
        return { width: box.max.x - box.min.x, length: box.max.z - box.min.z,
          bottom: box.min.y, palmError: grip.contactError(cart.root),
          cartSlotWidth: .46, cartSlotLength: .68 };
      },
      dispose: () => {
        chest?.dispose(); cart?.dispose(); grip.reset(); worker.dispose(); pack.dispose(); textures.dispose();
        ground.geometry.dispose(); ground.material.dispose(); reflection.dispose(); renderer.dispose(); renderer.forceContextLoss();
      }
    };
  });
  for (const detailed of [true, false]) {
    const quality = detailed ? "high" : "minimal";
    const shots = [{ units: 250, lid: "open", view: "oblique" }, { units: 250, lid: "open", view: "top" },
      { units: 250, lid: "open", view: "gameplay" }, { units: 50, lid: "open", view: "top" },
      { units: 150, lid: "open", view: "top" }, { units: 1, lid: "open", view: "top" },
      { units: 0, lid: "open", view: "oblique" },
      { units: 250, lid: "closed", view: "oblique" }, { units: 250, lid: "closed", view: "cart" }];
    for (const request of shots) {
      const metrics = await page.evaluate(request => (window as any).coinChestReview.select(request), { detailed, ...request });
      const stats = request.view === "cart" ? await page.evaluate(detailed => (window as any).coinChestReview.cart(detailed), detailed)
        : await page.evaluate(view => (window as any).coinChestReview.draw(view), request.view);
      const name = `${quality}-${request.units}-${request.lid}-${request.view}`;
      await page.screenshot({ path: resolve(output, `${name}.png`) });
      if (request.view === "cart") {
        assert(stats.width < stats.cartSlotWidth && stats.length < stats.cartSlotLength);
        assert(Math.abs(stats.bottom - .427) < 1e-6);
        assert(stats.palmError.every((error: number) => error < .025));
      }
      reports.push({ name, ...metrics, stats });
    }
  }
  await page.evaluate(() => (window as any).coinChestReview.dispose());
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ sources, reports, errors,
    scope: "Private source model, exact count/partial fill, real cart bed and posed cart puller; future hand-carried chest pose, ship-slot integration and live coin logistics are not implemented." }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Coin chest source review</title>
    <style>body{font:16px sans-serif;background:#222;color:#eee}img{max-width:95vw;width:1000px}figure{margin:24px}</style>
    <h1>Coin chest: private High/Minimal model review</h1>${reports.map(row =>
    `<figure><figcaption>${row.name} · ${row.triangles} triangles · ${row.visualCoins} visible / ${row.units} actual</figcaption><img src="${row.name}.png"></figure>`).join("")}`);
  console.log(JSON.stringify({ output, frames: reports.length, errors }));
} finally { await browser.close(); await server.close(); }
