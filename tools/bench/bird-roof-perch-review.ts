import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Native review of roof ridge perches on the real settlement buildings: two occupation-roof
 * buildings (Woodcutter 17, Nursery 20) are placed in a generated game, three birds land on each
 * ridge through the production bird motion, and the actual renderer is captured High and Minimal.
 * Presentation only; no save or simulation state is claimed.
 */
const output = resolve(process.env.OUT ?? "../../captures/bird-ridge");
const nations = (process.env.NATIONS ?? "roman,maya").split(",");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
mkdirSync(output, { recursive: true });
const report: any = { scope: "Generated island, native renderer/domain; assisted completed placement and a controlled perched bird frame. Review only.",
  cases: [], errors: [] };
const { server, url } = await startDevServer(), browser = await launchBrowser();
let activePage: import("playwright-core").Page | undefined;
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    activePage = page;
    page.setDefaultTimeout(180000);
    page.on("pageerror", error => report.errors.push({ quality, error: error.message }));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = "window.__islandReady = true";
      assert(source.includes(marker), "Runtime review hook marker changed");
      await route.fulfill({ response, body: source.replace(marker,
        "window.__birdRidgeReview = { birds, camera, environment, renderer }; window.__islandReady = true") });
    });
    await page.goto(`${url}?quality=${quality}&seed=77&size=128&landform=peninsula&mountains=0&forest=0&reveal=1&cache=0&skipLogin=1&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__birdRidgeReview && (window as any).__settlement),
      null, { timeout: 180000 });
    for (const nation of nations) {
      const setup = await page.evaluate(async nation => {
        const live = (window as any).__settlement, sim = live.simulation, hook = (window as any).__birdRidgeReview;
        if (!sim.setPlayerNation(nation)) throw new Error(`Nation migration refused: ${nation}`);
        const { getBuildingDefinition } = await import(/* @vite-ignore */ String("/src/render-common/buildings/building-catalog.ts"));
        const placeFinished = (type: number) => {
          const [width, depth] = getBuildingDefinition(type).gridFootprint;
          for (let radius = 7; radius <= 30; radius++) for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
              const x = Math.floor(sim.headquarters.x) + dx + width % 2 / 2;
              const z = Math.floor(sim.headquarters.z) + dz + depth % 2 / 2;
              const placed = sim.placeBuilding(type, x, z);
              if (!placed.ok) continue;
              Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
              if (sim.connectRoads(sim.headquarters.access, placed.building.access)) return placed.building;
              sim.demolishBuilding(placed.building.uid);
            }
          throw new Error(`No connected fixture site for ${type}`);
        };
        const buildings = [placeFinished(17), placeFinished(20)];
        live.removeFog?.();
        const { createBirdBuildingAvoidance } = await import(/* @vite-ignore */ String("/src/render-common/birds/bird-building-avoidance.ts"));
        const { createFlock } = await import(/* @vite-ignore */ String("/src/render-common/birds/bird-flock.ts"));
        const { updateBird } = await import(/* @vite-ignore */ String("/src/render-common/birds/bird-motion.ts"));
        const { createBirdFrameWriter } = await import(/* @vite-ignore */ String("/src/render-common/birds/bird-frame-writer.ts"));
        const { createBirdFrame, createBirdHistory, createBirdPool } =
          await import(/* @vite-ignore */ String("/src/render-common/birds/bird-pool.ts"));
        const { getBirdRoofPerch, getRoofSlot } = await import(/* @vite-ignore */ String("/src/render-common/birds/bird-roof-perches.ts"));
        const { BIRD_SPECIES } = await import(/* @vite-ignore */ String("/src/render-common/birds/bird-species.ts"));
        const { createRandom } = await import(/* @vite-ignore */ String("/src/shared/world/rng.ts"));
        const avoidance = createBirdBuildingAvoidance(), field = hook.birds.habitat;
        avoidance.refresh(sim.buildings(), nation);
        const capacity = 8, pool = createBirdPool(capacity), history = createBirdHistory(capacity);
        const frame = createBirdFrame(capacity), flocks: any[] = [], perches: any[] = [];
        let nextBird = 0;
        const flockSpecies = [0, 3];
        for (const [index, building] of buildings.entries()) {
          const species = flockSpecies[index % flockSpecies.length]!, size = BIRD_SPECIES[species].size;
          let count = 3, roof: any = null;
          for (; count >= 1; count--) {
            roof = getBirdRoofPerch({ ...building, nation }, size, count);
            if (roof) break;
          }
          if (!roof) throw new Error(`No ridge perch for ${nation} type ${building.typeId}`);
          const flock = createFlock();
          Object.assign(flock, { active: true, landX: roof.x, landY: roof.y, landZ: roof.z,
            mode: "land", roof, size: count, species, x: roof.x - 3, y: roof.y + 2, z: roof.z });
          for (let member = 0; member < count; member++) {
            const bird = nextBird + member;
            flock.members[member] = bird;
            pool.flock[bird] = index; pool.species[bird] = species; pool.appear[bird] = 1;
            pool.x[bird] = roof.x - 3;
            pool.z[bird] = roof.z + (member - (count - 1) / 2) * .5;
            pool.y[bird] = roof.y + 2;
            pool.rateFactor[bird] = 1; pool.flapBoost[bird] = 1; pool.speedFactor[bird] = 1;
            pool.shade[bird] = .95 + (member % 3) * .05;
          }
          nextBird += count;
          flocks.push(flock);
          perches.push({ uid: building.uid, typeId: building.typeId, count,
            slots: [...Array(count)].map((_, member) => {
              const slot = getRoofSlot(roof, member, count);
              return { x: +slot.x.toFixed(3), y: +slot.y.toFixed(3), z: +slot.z.toFixed(3) };
            }),
            surfaceY: +roof.surfaceY.toFixed(3), heading: +roof.heading.toFixed(3) });
        }
        const context = { buildings: avoidance, field, random: createRandom(17), step: 1 / 30, time: 0 };
        for (let step = 0; step < 450; step++) {
          context.time += 1 / 30;
          for (const flock of flocks) {
            flock.modeTime += 1 / 30;
            for (let member = 0; member < flock.size; member++)
              updateBird(pool, flock.members[member]!, flock, context);
          }
        }
        for (let bird = 0; bird < nextBird; bird++)
          if (pool.settle[bird]! !== 1) throw new Error(`Bird ${bird} did not settle`);
        createBirdFrameWriter(pool, history, frame, field)(1);
        sim.update = () => {};
        hook.birds.setEnabled(false);
        hook.birds.update = () => frame;
        (window as any).__birdRidgeFrame = frame;
        const centre = buildings.reduce((sum: any, building: any) => ({
          x: sum.x + building.x / buildings.length, z: sum.z + building.z / buildings.length
        }), { x: 0, z: 0 });
        Object.assign(hook.camera, { centerX: centre.x, centerZ: centre.z, zoom: 2.2 });
        return { nation, perches, birds: frame.count, camera: { ...hook.camera },
          buildings: buildings.map((building: any) => ({
            uid: building.uid, typeId: building.typeId, x: building.x, z: building.z
          })) };
      }, nation);
      const entry: any = { quality, ...setup, captures: [] };
      report.cases.push(entry);
      let lastClip: any = undefined;
      for (const building of setup.buildings) {
        const perch = setup.perches.find((entry: any) => entry.uid === building.uid);
        await page.evaluate(({ uid, zoom }) => {
          const live = (window as any).__settlement, hook = (window as any).__birdRidgeReview;
          const target = live.simulation.buildings().find((entry: any) => entry.uid === uid);
          live.focusGround(target.x, target.z, zoom);
          Object.assign(hook.camera, { centerX: target.x, centerZ: target.z, zoom });
        }, { uid: building.uid, zoom: 3 });
        await page.waitForTimeout(250);
        const clip = await page.evaluate(({ surfaceY, uid }) => {
          const live = (window as any).__settlement, hook = (window as any).__birdRidgeReview;
          const target = live.simulation.buildings().find((entry: any) => entry.uid === uid);
          const point = hook.renderer.projectToViewport(target.x, surfaceY, target.z);
          return { x: Math.max(0, Math.round(point.x - 320)), y: Math.max(0, Math.round(point.y - 300)),
            width: 640, height: 560 };
        }, { uid: building.uid, surfaceY: perch.surfaceY });
        const name = `${nation}-${quality}-type${building.typeId}-close.png`;
        await page.screenshot({ path: resolve(output, name), clip });
        entry.captures.push(name);
        lastClip = clip;
      }
      await page.evaluate(() => { (window as any).__birdRidgeFrame.count = 0; });
      await page.waitForTimeout(200);
      const noBirds = `${nation}-${quality}-nobirds.png`;
      await page.screenshot({ path: resolve(output, noBirds), clip: lastClip });
      entry.captures.push(noBirds);
      await page.evaluate((count: number) => { (window as any).__birdRidgeFrame.count = count; }, setup.birds);
      await page.evaluate(() => {
        const live = (window as any).__settlement, hook = (window as any).__birdRidgeReview;
        const buildings = live.simulation.buildings().filter((entry: any) => [17, 20].includes(entry.typeId));
        const x = buildings.reduce((sum: number, entry: any) => sum + entry.x, 0) / Math.max(1, buildings.length);
        const z = buildings.reduce((sum: number, entry: any) => sum + entry.z, 0) / Math.max(1, buildings.length);
        live.focusGround(x, z, 1.5);
        Object.assign(hook.camera, { centerX: x, centerZ: z, zoom: 1.5 });
      });
      await page.waitForTimeout(250);
      const pair = `${nation}-${quality}-pair.png`;
      await page.screenshot({ path: resolve(output, pair) });
      entry.captures.push(pair);
      writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
      console.log(`${nation}/${quality}: ${setup.birds} perched birds, ${entry.captures.join(", ")}`);
    }
    await page.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
