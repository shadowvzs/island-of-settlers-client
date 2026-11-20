import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/woodcutter-cargo-review");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/woodcutter-cargo-review.html", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><body style='margin:0'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}woodcutter-cargo-review.html`);
    const result = await page.evaluate(async quality => {
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { ThreeWorkerPack } = await import(/* @vite-ignore */ String("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts"));
      const { createWorkerPoser, createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { createWorkerProp } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts"));
      const { createSettlementRenderFrames } = await import(/* @vite-ignore */ String("/src/app/settlement/settlement-render-frames.ts"));
      const { createSettlementSimulation } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-simulation.ts"));
      const { createRoadNetwork } = await import(/* @vite-ignore */ String("/src/shared/settlement/road-network.ts"));
      const { createIslandStockContacts } = await import(/* @vite-ignore */ String("/src/app/settlement/island-stock-contacts.ts"));
      const { isBuildingCourtyardPointWalkable } = await import(/* @vite-ignore */ String("/src/render-common/buildings/building-courtyard.ts"));
      const { createRomanBuilding } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/roman-building.ts"));
      const { createRomanMaterials } = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/roman-materials.ts"));
      const { createWareModel } = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/ware-models.ts"));
      const { getBuildingDefinition } = await import(/* @vite-ignore */ String("/src/render-common/buildings/building-catalog.ts"));
      const { WORKER_SCALE } = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
      const { BUILD, PROP } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
      const detailed = quality === "high", renderer = new three.WebGLRenderer({ antialias: detailed });
      renderer.setSize(innerWidth, innerHeight); renderer.toneMapping = three.ACESFilmicToneMapping;
      document.body.append(renderer.domElement);
      const scene = new three.Scene(); scene.background = new three.Color("#b7c5b7");
      scene.add(new three.HemisphereLight("#fff1db", "#667854", 2));
      const sun = new three.DirectionalLight("#fff1db", 2.5); sun.position.set(-4, 8, 6); scene.add(sun);
      const floor = new three.Mesh(new three.PlaneGeometry(80, 80),
        new three.MeshStandardMaterial({ color: "#829766", roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
      const camera = new three.PerspectiveCamera(35, innerWidth / innerHeight, .01, 100), size = 40;
      const world: any = { cellsX: size, cellsZ: size, seaLevel: -1, seed: 1, start: { x: 5.5, z: 5.5 },
        heights: new Float32Array((size + 1) ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
        blocking: new Uint8Array(size ** 2), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
        mineZones: [], oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2),
        slopeClass: new Uint8Array(size ** 2), props: { count: 1, types: new Uint8Array([PROP.broadleafTree]),
          scale: new Float32Array([1]), x: new Float32Array([17]), z: new Float32Array([12]) } };
      let simulation: any;
      const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
      simulation = createSettlementSimulation({ world, roads, initialSettlers: 3,
        stockContact: createIslandStockContacts(world), canWorkerEnterPlot: (building: any, point: any) =>
          isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
            point, building.output, building.input) });
      const placed = simulation.placeBuilding(17, 12, 8);
      if (!placed.ok) throw new Error(placed.reason);
      const home = placed.building; home.construction = 1; home.required = {};
      if (!simulation.connectRoads(simulation.headquarters.access, home.access)) throw new Error("No fixture road");
      const materials = createRomanMaterials(detailed);
      const house = createRomanBuilding(getBuildingDefinition(17), materials.materials, detailed);
      house.fitToGrid(); house.root.position.set(home.x, home.y, home.z); scene.add(house.root);
      const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, createWorkerTextureLoader(renderer));
      const manifest = await fetch("workers/tripo/manifest.json").then(response => response.json());
      const entry = manifest.workers.find((candidate: any) => candidate.nation === "roman");
      const worker = await pack.load(entry.nation, entry.variant); worker.root.scale.setScalar(WORKER_SCALE);
      scene.add(worker.root);
      const pose = createWorkerPoser(worker), prop = createWorkerProp(pack, worker, detailed);
      const frames = createSettlementRenderFrames([{ nation: entry.nation, variant: entry.variant } as any]);
      const canonical = createWareModel("logs", detailed, materials.materials);
      canonical.root.scale.setScalar(WORKER_SCALE); canonical.root.updateMatrixWorld(true);
      const target = new three.Box3().setFromObject(canonical.root).getSize(new three.Vector3()).toArray();
      const captures: any[] = [], phases = new Set<string>();
      const sizeOf = (load: any) => {
        const undo = load.getObjectByName("ware_geometry").getWorldQuaternion(new three.Quaternion()).invert();
        const box = new three.Box3();
        load.traverse((mesh: any) => { if (!mesh.isMesh) return;
          const positions = mesh.geometry.getAttribute("position");
          for (let vertex = 0; vertex < positions.count; vertex++) box.expandByPoint(new three.Vector3()
            .fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld).applyQuaternion(undo)); });
        return box.getSize(new three.Vector3()).toArray();
      };
      for (let tick = 0; tick < 5000; tick++) {
        simulation.update(.05); frames.updateWorkers(simulation.frames(), .05);
        const actor = simulation.frames().find((candidate: any) => candidate.job === "Woodcutter");
        if (!actor) continue; phases.add(actor.phase);
        const frame = frames.workers[actor.uid];
        const puttingDown = actor.wareTransfer?.ware === "logs" && actor.wareTransfer.direction === "putdown" &&
          actor.wareTransfer.progress >= .5;
        let label: string | null = puttingDown ? "actual-stock-putdown" : null;
        if (actor.ware === "logs" && actor.phase === "outputWalk") label = "round-shoulder-carry";
        if (!label || captures.some(capture => capture.label === label)) {
          if (captures.length === 2 && (home.output.logs ?? 0) > 0) break;
          continue;
        }
        worker.root.position.set(actor.x, actor.y, actor.z); worker.root.rotation.y = actor.yaw;
        for (let wait = 0; wait < 20; wait++) { pose(frame); prop.update(frame);
          await new Promise(resolve => setTimeout(resolve, 10)); }
        house.update(0, { construction: 1, door: home.door, working: home.working,
          outputStock: home.output, inputStock: home.input });
        worker.root.updateMatrixWorld(true);
        const load = worker.root.getObjectByName("ware_logs"), actual = sizeOf(load);
        const error = Math.max(...actual.map((value: number, axis: number) => Math.abs(value - target[axis])));
        if (error > 1e-5) throw new Error(`Actual ${actor.phase} log deformation: ${error}`);
        if (Math.max(...Object.values(actor.wareScale as Record<string, number>)) -
          Math.min(...Object.values(actor.wareScale as Record<string, number>)) > 1e-8)
          throw new Error("Log must remain uniformly scaled");
        camera.position.set(actor.x + 2.5, actor.y + 2, actor.z - 3.2); camera.lookAt(actor.x, actor.y + .65, actor.z);
        renderer.render(scene, camera); renderer.getContext().finish();
        captures.push({ label, png: renderer.domElement.toDataURL("image/png").split(",")[1],
          phase: actor.phase, action: frame.action, size: actual, target, error,
          scale: actor.wareScale, contact: actor.stockContact, transfer: actor.wareTransfer });
      }
      if (captures.length !== 2 || !(home.output.logs > 0))
        throw new Error(`Incomplete actual Woodcutter delivery ${[...phases].join(",")} ${JSON.stringify(simulation.frames())}`);
      house.update(0, { construction: 1, door: 0, working: false,
        outputStock: { logs: 6 }, inputStock: {} }); house.root.updateMatrixWorld(true);
      const stockBounds = Array.from({ length: 6 }, (_, slot) => new three.Box3()
        .setFromObject(house.root.getObjectByName(`stock_output_${slot}_logs`)));
      const supportErrors = stockBounds.map((box: any, slot: number) => Math.abs(box.min.y -
        (slot < 2 ? home.y : stockBounds[slot - 2]!.max.y)));
      if (Math.max(...supportErrors) > 1e-6) throw new Error(`Floating stock logs ${supportErrors.join(",")}`);
      worker.root.visible = false;
      camera.position.set(home.x - 4.5, home.y + 3.8, home.z + 6);
      camera.lookAt(home.x, home.y + 1, home.z); renderer.render(scene, camera);
      renderer.getContext().finish();
      captures.push({ label: "grounded-six-log-stock", png: renderer.domElement.toDataURL("image/png").split(",")[1],
        supportErrors, bounds: stockBounds.map((box: any) => ({ min: box.min.toArray(), max: box.max.toArray() })) });
      return { quality, stock: home.output.logs, phases: [...phases], captures, supportErrors };
    }, quality);
    for (const capture of result.captures) writeFileSync(resolve(output, `${quality}-${capture.label}.png`),
      Buffer.from(capture.png, "base64"));
    assert.deepEqual(errors, []);
    reports.push({ ...result, captures: result.captures.map(({ png, ...capture }: any) => capture), errors });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports.map((report: any) => ({ quality: report.quality, stock: report.stock,
    captures: report.captures.map((capture: any) => ({ label: capture.label,
      phase: capture.phase, action: capture.action, error: capture.error,
      maximumSupportGap: capture.supportErrors ? Math.max(...capture.supportErrors) : undefined })) }))));
} finally { await browser.close(); await server.close(); }
