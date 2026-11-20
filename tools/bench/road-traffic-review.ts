import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/road-traffic");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}building-showcase.html?building=0&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    const result = await page.evaluate(async quality => {
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null); preview.model().root.visible = false;
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const roadLayers = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/three-roads.ts"));
      const network = await import(/* @vite-ignore */ String("/src/shared/settlement/road-network.ts"));
      const motion = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-paths.ts"));
      const rendering = await import(/* @vite-ignore */ String("/src/app/settlement/settlement-render-frames.ts"));
      const workerRendering = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const props = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts"));
      const dimensions = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
      const packs = await import(/* @vite-ignore */ String("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts"));
      const assets = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-assets.ts"));
      const catalog = await import(/* @vite-ignore */ String("/src/render-common/buildings/building-catalog.ts"));
      const buildingModels = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/roman-building.ts"));
      const buildingMaterials = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/roman-materials.ts"));
      const markers = await import(/* @vite-ignore */ String("/src/renderers/three/buildings/building-road-marker.ts"));
      const world = { cellsX: 32, cellsZ: 32, heights: new Float32Array(33 ** 2),
        walkCost: new Uint8Array(32 ** 2).fill(10), blocking: new Uint8Array(32 ** 2), props: { count: 0 } };
      const roads = network.createRoadNetwork(world);
      roads.addRoad({ x: 6, z: 8 }, { x: 12, z: 8 });
      roads.addRoad({ x: 12, z: 8 }, { x: 12, z: 13 });
      const layer = roadLayers.createThreeRoads(world, quality as any);
      layer.update(roads.segments()); preview.scene.add(layer.root);
      const textures = workerRendering.createWorkerTextureLoader(preview.renderer);
      const pack = new packs.ThreeWorkerPack(new URL(assets.WORKER_ASSET_BASE + "tripo/", location.href).href, textures);
      const manifest = await (await fetch(assets.WORKER_ASSET_BASE + "tripo/manifest.json")).json();
      const members: any[] = [], templates: any[] = [];
      for (const entry of manifest.workers.filter((entry: any) => entry.nation === "roman").slice(0, 2)) {
        const worker = await pack.load(entry.nation, entry.variant);
        worker.root.scale.setScalar(dimensions.WORKER_SCALE); worker.setTeamColor("#2462bc");
        preview.scene.add(worker.root);
        members.push({ worker, pose: workerRendering.createWorkerPoser(worker), held: props.createWorkerProp(pack, worker, quality === "high") });
        templates.push({ nation: entry.nation, variant: entry.variant, visible: true,
          x: 0, y: 0, z: 0, heading: 0, action: "carry_shoulder", selected: false,
          animationTime: 0, gaitPhase: 0, runBlend: 0, target: null });
      }
      const actors = [
        { uid: 0, x: 6, z: 8, path: roads.route({ x: 6, z: 8 }, { x: 12, z: 13 })!.points, ware: "logs" },
        { uid: 1, x: 12, z: 13, path: roads.route({ x: 12, z: 13 }, { x: 6, z: 8 })!.points, ware: "planks" }
      ].map(actor => ({ ...actor, y: 0, yaw: 0, visible: true, job: "Carrier", phase: "deliver",
        action: "carry", home: 0, building: 0, pathIndex: 0, timer: 0, animationTime: 0 }));
      const context = { actors, buildings: [], occupied: new Uint8Array(32 ** 2), options: { world, roads } };
      const frames = rendering.createSettlementRenderFrames(templates);
      frames.updateWorkers(actors, 0);
      const camera = new three.OrthographicCamera(-4.5, 4.5, 3.125, -3.125, .01, 100);
      camera.position.set(15, 10, 17); camera.lookAt(9.5, .25, 10);
      const captures: any[] = [], positions: any[] = [];
      let minimum = Infinity, maximumHeadingStep = 0;
      for (let tick = 0; tick < 600; tick++) {
        for (const actor of actors) if (actor.visible) {
          const yaw = actor.yaw;
          if (motion.moveActor(context, actor as any, .05)) actor.visible = false;
          maximumHeadingStep = Math.max(maximumHeadingStep, Math.abs(yaw - actor.yaw));
          if ((actor as any).queueWait) throw new Error("Unexpected carrier passing pause");
        }
        frames.updateWorkers(actors as any, .05);
        members.forEach((member, index) => {
          const frame = frames.workers[index];
          if (!frame) { member.worker.root.visible = false; return; }
          member.worker.root.visible = !!frame.visible;
          member.worker.root.position.set(frame.x, frame.y, frame.z);
          member.worker.root.rotation.y = frame.heading;
          member.pose(frame); member.held.update(frame);
        });
        if (actors.every(actor => actor.visible)) minimum = Math.min(minimum,
          Math.hypot(actors[0]!.x - actors[1]!.x, actors[0]!.z - actors[1]!.z));
        positions.push({ tick, actors: actors.map(actor => ({ x: actor.x, z: actor.z, yaw: actor.yaw })) });
        if ([50, 82, 90, 104].includes(tick)) {
          preview.renderer.render(preview.scene, camera);
          captures.push({ tick, png: preview.renderer.domElement.toDataURL("image/png").split(",")[1] });
        }
      }
      if (minimum < .34 || maximumHeadingStep > .300001 || actors.some(actor => actor.visible))
        throw new Error(`Invalid rounded road travel: ${minimum}, ${maximumHeadingStep}`);
      const materials = buildingMaterials.createRomanMaterials(quality === "high");
      const markerPack = markers.createBuildingRoadMarkers();
      const solidChecks: any[] = [];
      for (const type of [0, 35]) {
        const model = buildingModels.createRomanBuilding(catalog.getBuildingDefinition(type), materials.materials, quality === "high");
        model.fitToGrid();
        const sign = markerPack.create();
        for (const turns of [0, 1, 2, 3]) {
          const frame = { type, id: `test-${type}`, construction: 1, working: false, door: 0,
            rotation: turns * Math.PI / 2, x: 0, y: 0, z: 0 };
          model.update(frame, 0); model.root.rotation.y = frame.rotation;
          markerPack.update(sign, frame, { sample: () => 0 });
          model.root.updateMatrixWorld(true); sign.updateMatrixWorld(true);
          const signBounds: any[] = [];
          sign.getObjectByName("building_road_signpost")!.traverse((object: any) => {
            if (object.isMesh && object.name !== "building_signpost_icon_front" && object.name !== "building_signpost_icon_back")
              signBounds.push(new three.Box3().setFromObject(object));
          });
          let intersections = 0;
          const triangle = new three.Triangle();
          model.root.traverse((object: any) => {
            if (!object.isMesh || !object.visible) return;
            let parent = object.parent;
            while (parent) { if (!parent.visible) return; parent = parent.parent; }
            const geometry = object.geometry, positions = geometry.getAttribute("position"), index = geometry.index;
            for (let vertex = 0; vertex < (index?.count ?? positions.count); vertex += 3) {
              for (const [corner, offset] of [[triangle.a, 0], [triangle.b, 1], [triangle.c, 2]]) {
                const id = index ? index.getX(vertex + offset) : vertex + offset;
                corner.fromBufferAttribute(positions, id).applyMatrix4(object.matrixWorld);
              }
              if (signBounds.some(box => box.intersectsTriangle(triangle))) intersections++;
            }
          });
          if (intersections) throw new Error(`${type} rotation ${turns}: sign intersects ${intersections} building triangles`);
          solidChecks.push({ type, turns, intersections });
        }
        model.dispose();
      }
      markerPack.dispose(); materials.dispose();
      for (const member of members) { member.held.dispose(); member.worker.dispose(); }
      pack.dispose(); textures.dispose(); layer.dispose();
      return { captures, positions, minimum, maximumHeadingStep, solidChecks, width: network.ROAD_WIDTH };
    }, quality);
    assert.deepEqual(errors, []);
    for (const capture of result.captures) writeFileSync(resolve(output, `${quality}-passing-${capture.tick}.png`),
      Buffer.from(capture.png!, "base64"));
    writeFileSync(resolve(output, `${quality}-review.json`), JSON.stringify({ ...result, captures: result.captures.map(({ tick }) => tick), errors }, null, 2));
    console.log(quality, result.minimum, result.maximumHeadingStep, result.solidChecks);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
