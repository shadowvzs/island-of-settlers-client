import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "runtime-a";
const remaining = process.argv.includes("--remaining");
const mixedShipsOnly = process.argv.includes("--mixed-ships-only");
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid coin cargo review run");
const output = resolve("../resources/project-reviews/coin-chest-2026-11-04", run);
mkdirSync(output, { recursive: true });
const paths = ["src/render-common/wares/ware-catalog.ts", "src/renderers/three/settlement/ware-models.ts",
  "src/renderers/three/settlement/coin-chest-model.ts", "src/renderers/three/settlement/coin-chest-instances.ts",
  "src/renderers/three/settlement/three-ships.ts", "src/renderers/three/settlement/three-harbour-lighters.ts",
  "src/renderers/three/settlement/three-harbour-shuttles.ts", "src/renderers/three/settlement/small-boat-coin-cargo.ts",
  "src/app/settlement/dock-porters.ts", "src/app/settlement/settlement-render-frames.ts",
  "src/shared/settlement/ship-cargo-presentation.ts", "src/renderers/three/three-worker-prop.ts",
  "src/renderers/three/three-worker.ts", "src/renderers/three/worker-coin-cargo.ts"];
const hashes = () => paths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
const before = hashes(), reports: any[] = [], errors: string[] = [];
let phase = "boot";
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/coin-cargo.html", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'></body>" }));
  await page.goto(`${url}coin-cargo.html`);
  await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/@id/three");
    const { RoomEnvironment } = await imp("/@id/three/examples/jsm/environments/RoomEnvironment.js");
    const { createThreeSettlementShips } = await imp("/src/renderers/three/settlement/three-ships.ts");
    const { createThreeHarbourLighters } = await imp("/src/renderers/three/settlement/three-harbour-lighters.ts");
    const { lighterPlaceAt, planLighters } = await imp("/src/shared/settlement/harbour-lighters.ts");
    const { shipFrame } = await imp("/src/shared/settlement/settlement-naval-ship-handling.ts");
    const { cargoPresentation } = await imp("/src/shared/settlement/ship-cargo-presentation.ts");
    const { planCargoHandling } = await imp("/src/shared/settlement/ship-cargo-handling.ts");
    const { dockPorters } = await imp("/src/app/settlement/dock-porters.ts");
    const { createSettlementRenderFrames } = await imp("/src/app/settlement/settlement-render-frames.ts");
    const { createWorkerPoser, createWorkerTextureLoader } = await imp("/src/renderers/three/three-worker.ts");
    const { createWorkerProp } = await imp("/src/renderers/three/three-worker-prop.ts");
    const { WORKER_SCALE } = await imp("/src/render-common/workers/worker-dimensions.ts");
    const { ThreeWorkerPack } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts");
    const { setArmourLod } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-armour.ts");
    const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1100, 850); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
    renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    document.body.append(renderer.domElement);
    const scene = new t.Scene(); scene.background = new t.Color("#bcc7ce");
    const pmrem = new t.PMREMGenerator(renderer), room = new RoomEnvironment(), reflection = pmrem.fromScene(room, .04);
    scene.environment = reflection.texture; scene.environmentIntensity = .6; room.dispose(); pmrem.dispose();
    scene.add(new t.HemisphereLight("#fff4dd", "#657b8d", 1.8));
    const sun = new t.DirectionalLight("#fff1dc", 2.3); sun.position.set(-5, 8, 5); scene.add(sun);
    const ground = new t.Mesh(new t.PlaneGeometry(50, 50), new t.MeshStandardMaterial({ color: "#7f9da9", roughness: .85 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.13; scene.add(ground);
    const camera = new t.PerspectiveCamera(35, 1100 / 850, .01, 100);
    const textures = createWorkerTextureLoader(renderer), base = new URL("workers/tripo/", location.href).href;
    const packs = [new ThreeWorkerPack(base, textures), new ThreeWorkerPack(base, textures, true)];
    const workers = await Promise.all(packs.map(pack => pack.load("roman", "roman-man-white")));
    for (const loaded of workers) { loaded.root.scale.setScalar(WORKER_SCALE); loaded.root.visible = false; scene.add(loaded.root); }
    let worker = workers[0], pack = packs[0];
    let pose: any, props: any, ships: any, lighters: any;
    const appearance = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0 };
    const frames = createSettlementRenderFrames([appearance]);
    const draw = (target: any, offset: any) => {
      camera.position.copy(target).add(offset); camera.lookAt(target); scene.updateMatrixWorld(true);
      renderer.render(scene, camera); renderer.getContext().finish();
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    };
    const reset = () => {
      ships?.dispose(); lighters?.dispose(); props?.dispose(); ships = undefined; lighters = undefined; props = undefined;
      workers.forEach(loaded => { loaded.root.visible = false; });
    };
    (window as any).coinCargoReview = {
      draw: async ({ detailed, kind }: any) => {
        reset(); worker = workers[detailed ? 0 : 1]; pack = packs[detailed ? 0 : 1];
        setArmourLod(worker.root, detailed ? 0 : 1);
        if (kind.startsWith("ship")) {
          ships = createThreeSettlementShips(detailed ? "high" : "minimal"); scene.add(ships.group);
          const cargo = kind === "ship-partial" ? { coins: 1 } : { coins: 300, planks: 30 };
          const vessel = { cargo, cargoCount: Object.values(cargo).reduce((sum, count) => sum + count, 0),
            cursor: 0, id: 1, phase: "sailing", route: [], timer: 0, x: 0, y: 0, yaw: 0, z: 0 };
          const original = JSON.stringify(vessel), frame = shipFrame(vessel);
          ships.update([frame], [], 0, { playerNation: "roman" }); await ships.ready;
          if (JSON.stringify(vessel) !== original) throw new Error("Rendering mutated economic ship state");
          ships.group.updateWorldMatrix(true, true);
          const hold = ships.group.getObjectByName("coin_cargo_chests");
          const target = new t.Box3().setFromObject(hold).getCenter(new t.Vector3());
          // Stay aft of the real sail plane, as in the verified partial-load close view.
          const offset = new t.Vector3(1.4, 1.5, 1.7);
          const stats = draw(target, offset);
          return { stats, manifest: frame.cargoManifest, economicUnchanged: true };
        }
        if (kind.startsWith("lighter")) {
          lighters = createThreeHarbourLighters(detailed); scene.add(lighters.group);
          const cargo = kind === "lighter-mixed" ? { coins: 300, planks: 30, stone: 20 } : { coins: 1000 };
          const plan = planLighters(4, 1, 6, 4, false), manifest = cargoPresentation(cargo, 4);
          let elapsed = 0, at: any;
          for (; elapsed < plan.seconds; elapsed += .05) {
            at = lighterPlaceAt(plan, 0, elapsed, false); if (at?.rowing && at.boxes === 4) break;
          }
          if (!at?.boxes) throw new Error("No laden lighter stage");
          const frame = { id: 1, x: 0, y: 0, z: 0, yaw: 0, phase: "loading", cargoCount: 1000,
            lighterWork: { boats: [{ alongside: { x: 0, z: 0 }, landing: { x: 4, z: 0 }, place: 0,
              route: [{ x: 4, z: 0 }, { x: 4, z: 4 }] }], elapsed, manifest, plan, unloading: false } };
          lighters.update([frame], elapsed, "roman");
          const boat = lighters.group.children[0], target = boat.position.clone().add(new t.Vector3(0, .35, 0));
          return { stats: draw(target, new t.Vector3(1.9, 1.7, 2.3)), manifest, boxes: at.boxes };
        }
        const count = kind === "porter-stack" ? 6500 : 1;
        const plan = planCargoHandling(count === 1 ? 1 : 26, 12, 0), manifest = cargoPresentation({ coins: count }, plan.boxes);
        const world = { cellsX: 32, cellsZ: 32, heights: new Float32Array(33 * 33) };
        const site = { id: 1, kind: "dock", workPier: { point: { x: 0, z: 12 }, shore: { x: 0, z: 8 }, shoreY: 0, y: 0 },
          porterRoute: [{ x: 0, z: 0 }, { x: 0, z: 8 }], cargoWork: { elapsed: 1, manifest, plan, unloading: false } };
        const actors = dockPorters(world, [site]), actor = actors[0];
        if (!actor?.ware?.startsWith("coinChest")) throw new Error("Actual dock porter did not receive coin packaging");
        frames.updateWorkers([actor], .05); const frame = frames.workers[0];
        worker.root.visible = true; pose = createWorkerPoser(worker); props = createWorkerProp(pack, worker, detailed);
        worker.root.position.set(actor.x, actor.y, actor.z); worker.root.rotation.y = actor.yaw;
        for (let attempt = 0; attempt < 30; attempt++) { pose(frame); props.update(frame); await new Promise(r => setTimeout(r, 10)); }
        pose(frame); props.update(frame); worker.root.updateMatrixWorld(true);
        const held = worker.root.children.find((child: any) => child.name === "coin_transport_chest" || child.name === "coin_cargo_stack");
        if (!held) throw new Error("Original chest prop missing");
        const errors = ["Left", "Right"].map(side => {
          const socket = worker.root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`);
          return socket.getWorldPosition(new t.Vector3()).distanceTo(new t.Vector3(...held.userData[`stoneSupport${side}`]));
        });
        const target = worker.root.position.clone().add(new t.Vector3(0, .62, 0));
        return { stats: draw(target, new t.Vector3(1.4, .85, 1.8)), carryingWare: frame.carryingWare, palmErrors: errors,
          bounds: new t.Box3().setFromObject(held).getSize(new t.Vector3()).toArray() };
      },
      dispose: () => { reset(); workers.forEach(loaded => loaded.dispose()); packs.forEach(owner => owner.dispose()); textures.dispose();
        ground.geometry.dispose(); ground.material.dispose(); reflection.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
    };
  });
  for (const detailed of [true, false]) for (const kind of ["ship-partial", "ship-mixed", "lighter-full", "lighter-mixed", "porter-single", "porter-stack"]) {
    if (mixedShipsOnly && kind !== "ship-mixed") continue;
    if (remaining && detailed && kind.startsWith("lighter")) continue;
    const quality = detailed ? "high" : "minimal", name = `${quality}-${kind}`;
    phase = name;
    const result = await page.evaluate(request => (window as any).coinCargoReview.draw(request), { detailed, kind });
    await page.screenshot({ path: resolve(output, `${name}.png`) });
    reports.push({ name, ...result });
    if (result.palmErrors) assert(result.palmErrors.every((error: number) => error < .015), `${name} palm contact ${result.palmErrors}`);
  }
  await page.evaluate(() => (window as any).coinCargoReview.dispose());
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ before, after: hashes(), reports, errors,
    scope: "Canonical ship/lighter runtime rendering, actual pier-porter schedule/frame/rig/prop; no live economy mutation, real UI sea voyage or inventory grant." }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Runtime coin cargo</title>
    <style>body{background:#222;color:#eee;font:16px sans-serif}img{width:1000px;max-width:95vw}</style>
    <h1>Runtime coin cargo</h1>${reports.map(row => `<figure><figcaption>${row.name}</figcaption><img src="${row.name}.png"></figure>`).join("")}`);
  console.log(JSON.stringify({ output, frames: reports.length, errors }));
} catch (error) {
  writeFileSync(resolve(output, "failure.json"), JSON.stringify({ phase, error: String(error), before,
    after: hashes(), reports, errors }, null, 2));
  throw error;
} finally { await browser?.close(); await server.close(); }
