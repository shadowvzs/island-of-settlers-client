import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve(process.env.OUT ?? "../resources/project-reviews/verification-completion-2026-11-05/worker-portals");
const cases = [
  { nation: "chinese", id: 0, levels: [1, 5] },
  { nation: "indigenous", id: 0, levels: [1, 5] },
  { nation: "indigenous", id: 6, levels: [1, 5] },
  { nation: "indigenous", id: 14, levels: [1, 5] },
  { nation: "indigenous", id: 18, levels: [1, 5] },
  { nation: "indigenous", id: 32, levels: [1, 5] },
  { nation: "indigenous", id: 36, levels: [1, 3, 5] },
  { nation: "indigenous", id: 61, levels: [1, 5] },
  { nation: "persian", id: 36, levels: [1, 5] },
  { nation: "persian", id: 6, levels: [1, 5] },
  { nation: "persian", id: 29, levels: [1, 5] },
  { nation: "persian", id: 58, levels: [1, 5] },
  { nation: "persian", id: 61, levels: [1, 5] }
];
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}building-showcase.html?nation=${item.nation}&building=${item.id}&quality=${quality}&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    for (const level of item.levels) {
      const result = await page.evaluate(async ({ id, level, nation, packPath, quality }) => {
        const imp = (path: string) => import(/* @vite-ignore */ path);
        const p = (window as any).__buildingPreview;
        p.renderer.setAnimationLoop(null);
        await p.selectBuilding(id, level);
        await (window as any).__buildingResidentReady;
        const model = p.model();
        const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
        const { getRomanBuildingWorldSizing } = await imp("/src/render-common/buildings/building-world-sizing.ts");
        const { WORKER_SCALE } = await imp("/src/render-common/workers/worker-dimensions.ts");
        const { settlerNation } = await imp("/src/render-common/workers/worker-nation.ts");
        const { createWorkerPoser, createWorkerTextureLoader } = await imp("/src/renderers/three/three-worker.ts");
        const { createWorkerProp } = await imp("/src/renderers/three/three-worker-prop.ts");
        const { ThreeWorkerPack } = await imp(packPath);
        const { WORKER_ASSET_BASE } = await imp("/src/render-common/workers/worker-assets.ts");
        const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
        const { makeBuilding } = await imp("/src/shared/settlement/settlement-placement.ts");
        const { entrancePath, exitPath } = await imp("/src/shared/settlement/settlement-entrance.ts");
        const { moveActor, setActorPath } = await imp("/src/shared/settlement/settlement-paths.ts");
        const { updateDoorActivity } = await imp("/src/shared/settlement/settlement-door-activity.ts");
        const { scale } = getRomanBuildingWorldSizing(getBuildingDefinition(id));
        model.root.scale.setScalar(scale);
        model.root.updateMatrixWorld(true);
        const world = { cellsX: 48, cellsZ: 48, heights: new Float32Array(49 ** 2),
          blocking: new Uint8Array(48 ** 2), walkCost: new Uint8Array(48 ** 2).fill(10),
          props: { count: 0, types: new Uint8Array(), scale: new Float32Array(),
            x: new Float32Array(), z: new Float32Array() } };
        const context: any = { actors: [], buildings: [], nextBuilding: 0, occupied: new Uint8Array(48 ** 2),
          options: { roads: createRoadNetwork(world), world }, playerNation: nation, reservations: new Set() };
        const [width, depth] = getBuildingDefinition(id).gridFootprint;
        const building = makeBuilding(context, id, 24 + width % 2 / 2, 24 + depth % 2 / 2);
        Object.assign(building, { construction: 1, workshopUpgrade: { level: level - 1 } });
        context.buildings.push(building);
        for (let z = Math.floor(building.z - building.depth / 2); z < building.z + building.depth / 2; z++)
          for (let x = Math.floor(building.x - building.width / 2); x < building.x + building.width / 2; x++)
            context.occupied[z * 48 + x] = 1;
        const actor: any = { ...building.access, action: "walk", animationTime: 0, building: building.uid,
          home: building.uid, job: "Carrier", path: [], pathIndex: 0, phase: "enterDelivery", timer: 0,
          uid: 1, visible: true, ware: null, y: 0, yaw: Math.PI };
        context.actors.push(actor);
        const samples: any[] = [];
        let elapsed = 0;
        const record = (name: string) => samples.push({ name, door: building.door,
          x: actor.x - building.x, z: actor.z - building.z, yaw: actor.yaw, elapsed });
        record("closed-approach");
        setActorPath(actor, entrancePath(building), "enterDelivery");
        let recordedOpen = false, arrived = false;
        for (let tick = 0; tick < 400 && !arrived; tick++) {
          arrived = moveActor(context, actor, .05);
          updateDoorActivity(context, .05);
          elapsed += .05;
          if (building.door === 1 && !recordedOpen) { record("open-crossing"); recordedOpen = true; }
        }
        if (!arrived) throw new Error("Worker did not enter");
        record("inside-threshold");
        setActorPath(actor, exitPath(building), "exitDelivery");
        arrived = false;
        for (let tick = 0; tick < 400 && !arrived; tick++) {
          arrived = moveActor(context, actor, .05);
          updateDoorActivity(context, .05);
          elapsed += .05;
        }
        if (!arrived) throw new Error("Worker did not exit");
        actor.phase = "inside"; actor.visible = false;
        for (let tick = 0; tick < 40; tick++) updateDoorActivity(context, .05);
        record("closed-after-exit");
        if (building.door !== 0) throw new Error("Door failed to close");
        if (id === 6 || id === 61) {
          const { createIslandStockContacts } = await imp("/src/app/settlement/island-stock-contacts.ts");
          const { canWorkerEnterBuildingPlot } = await imp("/src/app/settlement/island-simulation-hooks.ts");
          const { updateCarrier } = await imp("/src/shared/settlement/settlement-logistics.ts");
          const { getProductionRule } = await imp("/src/shared/settlement/production-rules.ts");
          context.options.stockContact = createIslandStockContacts(world, undefined, () => nation);
          context.options.canWorkerEnterPlot = (plot: any, point: any) => canWorkerEnterBuildingPlot(plot, point, nation);
          context.transfers = [];
          const home = makeBuilding(context, 0, 8, 8);
          home.construction = 1; context.buildings.push(home);
          const wares: string[] = [...new Set<string>(getProductionRule(id, nation).inputs)].reverse();
          building.input = Object.fromEntries(wares.map(ware => [ware, 5]));
          samples.length = 0;
          for (const ware of wares) {
            Object.assign(actor, building.access, { home: home.uid, path: [], pathIndex: 0,
              phase: "deliver", ware, visible: true });
            actor.delivery = { destination: building.uid, source: home.uid, ware };
            building.incoming[ware] = 1;
            const captured = new Set<string>();
            for (let tick = 0; tick < 1600 && actor.ware; tick++) {
              updateCarrier(context, actor, .05); elapsed += .05;
              const transfer = actor.wareTransfer;
              let state = "";
              if (transfer?.direction === "putdown") state = transfer.progress >= .5 ? "half" : "start";
              if (!actor.ware) state = "committed";
              if (!state || captured.has(state)) continue;
              captured.add(state);
              const contact = context.options.stockContact(building, "input", ware, 5);
              samples.push({ name: `${ware}-${state}`, door: 0, elapsed,
                x: actor.x - building.x, z: actor.z - building.z,
                yaw: actor.yaw, carryingWare: actor.ware, carriedWareScale: actor.wareScale,
                input: { ...building.input },
                stockTarget: { x: contact.stock.x - building.x, z: contact.stock.z - building.z },
                wareTransfer: transfer && { ...transfer,
                  target: { ...transfer.target, x: transfer.target.x - building.x,
                    z: transfer.target.z - building.z } } });
            }
            if (actor.ware || building.input[ware] !== 6) throw new Error(`Input transfer failed: ${ware}`);
          }
        }
        const textures = createWorkerTextureLoader(p.renderer);
        const pack = new ThreeWorkerPack(new URL(WORKER_ASSET_BASE + "tripo/", location.href).href,
          textures, quality === "minimal");
        const manifest = await (await fetch(WORKER_ASSET_BASE + "tripo/manifest.json")).json();
        const bodyNation = settlerNation(nation);
        const entry = manifest.workers.find((entry: any) => entry.nation === bodyNation);
        const worker = await pack.load(bodyNation, entry.variant);
        worker.root.scale.setScalar(WORKER_SCALE);
        worker.setTeamColor("#2760ba");
        p.scene.add(worker.root);
        const pose = createWorkerPoser(worker);
        const held = createWorkerProp(pack, worker, quality === "high");
        const doorX = building.doorThreshold.x - building.x, doorZ = building.doorThreshold.z - building.z;
        p.camera.position.set(doorX + 1.7, 1.5, doorZ + 3.3);
        p.controls.target.set(doorX, .65, doorZ - .15); p.controls.update();
        (window as any).__portalReview = {
          capture: async (index: number, rear = false, construction = 1, side = false) => {
            const sample = samples[index];
            const frame = { nation: bodyNation, propNation: nation, variant: entry.variant,
              action: "walk", animationTime: sample.elapsed,
              gaitPhase: sample.elapsed % 1, runBlend: 0, selected: false, target: null,
              x: sample.x, y: .005, z: sample.z, heading: sample.yaw, workerJob: "Carrier",
              carryingWare: sample.carryingWare, carriedWareScale: sample.carriedWareScale,
              wareTransfer: sample.wareTransfer };
            if (sample.wareTransfer) frame.action = "putdown_material";
            worker.root.position.set(sample.x, .005, sample.z);
            worker.root.rotation.y = sample.yaw;
            worker.root.visible = construction === 1 && sample.name !== "closed-after-exit";
            pose(frame); held.update(frame);
            await new Promise(resolve => setTimeout(resolve, 30));
            pose(frame); held.update(frame);
            model.update(0, { construction, door: sample.door, working: false,
              inputStock: sample.input ?? {}, outputStock: {} });
            p.camera.position.set(doorX + 1.7, 1.5, doorZ + 3.3);
            p.controls.target.set(doorX, .65, doorZ - .15);
            if (sample.stockTarget) {
              const target = sample.stockTarget;
              p.camera.position.set(target.x + Math.sign(target.x) * 2.8, 2, target.z + 3.3);
              p.controls.target.set(target.x, .6, target.z);
            }
            p.controls.update();
            if (rear) {
              p.camera.position.set(4, 3, -6);
              p.controls.target.set(0, 1.3, 0); p.controls.update();
            }
            if (side) {
              const awning = model.recipe.parts.find((part: any) => part.shape === "persian-striped-awning");
              if (awning) {
                const [x, y, z] = awning.position.map((value: number) => value * scale);
                p.camera.position.set(x + Math.sign(x) * 3.5, y + 1.2, z + 3);
                p.controls.target.set((x + sample.x) / 2, y * .55, (z + sample.z) / 2);
                p.controls.update();
              }
            }
            p.renderer.render(p.scene, p.camera);
          },
          dispose: () => { held.dispose(); p.scene.remove(worker.root); worker.dispose(); pack.dispose(); textures.dispose(); }
        };
        return { samples, bodyNation, variant: entry.variant, triangles: model.triangles(false), scale,
          awnings: model.recipe.parts.filter((part: any) => part.shape === "persian-striped-awning").length };
      }, { ...item, level, quality,
        packPath: `/@fs${resolve("../island-of-settlers-worker-generation/src/game-three-worker.ts")}` });
      for (let index = 0; index < result.samples.length; index++) {
        await page.evaluate(index => (window as any).__portalReview.capture(index), index);
        await page.screenshot({ path: resolve(output,
          `${item.nation}-${item.id}-L${level}-${quality}-${result.samples[index]!.name}.png`) });
      }
      await page.evaluate(index => (window as any).__portalReview.capture(index, true), result.samples.length - 1);
      await page.screenshot({ path: resolve(output, `${item.nation}-${item.id}-L${level}-${quality}-rear.png`) });
      if (item.nation === "persian" && result.awnings) {
        await page.evaluate(() => (window as any).__portalReview.capture(1, false, 1, true));
        await page.screenshot({ path: resolve(output,
          `${item.nation}-${item.id}-L${level}-${quality}-awning-worker-side.png`) });
      }
      if (item.id === 36 && item.nation === "indigenous") {
        await page.evaluate(() => (window as any).__portalReview.capture(3, false, .6));
        await page.screenshot({ path: resolve(output,
          `${item.nation}-${item.id}-L${level}-${quality}-construction.png`) });
      }
      await page.evaluate(() => (window as any).__portalReview.dispose());
      reports.push({ nation: item.nation, id: item.id, level, quality, ...result });
      console.log(JSON.stringify({ nation: item.nation, id: item.id, level, quality, captured: true }));
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed: true, reports,
    scope: "Canonical movement/door state and production worker bodies rendered with actual national models; isolated fixture, not game UI." }, null, 2));
} catch (error) {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed: false, reports, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify({ passed: true, cases: reports.length, output }));
