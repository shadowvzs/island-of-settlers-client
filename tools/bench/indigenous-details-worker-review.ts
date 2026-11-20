import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gallerySourceGuard } from "./building-gallery-source";
import { captureIndigenousQuarryDoors } from "./indigenous-quarry-door-capture";

/** Real recruited L5 well/quarry/forester workers at all four rotations; no synthetic poses. */
const wellOnly = process.argv[2] === "well-b";
const quarryOnly = ["quarry-c", "quarry-c16"].includes(process.argv[2] ?? "");
const suffix = quarryOnly ? "quarry-doors-c" : "working";
const output = resolve("../resources/project-reviews/indigenous-details-2026-11-05",
  wellOnly ? "working-well-b" : suffix);
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard();
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const nation of ["indigenous"]) for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on("request", request => guard.request(request.url()));
    const errors: string[] = [], missingResources: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() === 404) missingResources.push(response.url()); });
    page.on("console", message => { if (message.type() === "error" && /shader|WebGL|THREE.*Error/i.test(message.text()))
      errors.push(message.text()); });
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/pilot-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.goto(`${url}pilot-fixture.html`);
    const fixture = await page.evaluate(async ({ nation, quality, quarryOnly, wellOnly }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { leveledBuildingRecipe } = await imp("/src/render-common/buildings/levels/leveled-building-recipe.ts");
      const wellRecipe = leveledBuildingRecipe(getBuildingDefinition(35), nation, quality === "high", 5);
      const canopy = wellRecipe.parts.filter((part: any) =>
        part.occupationRoof === "gable" && part.surface === "cloth-water");
      if (!quarryOnly && canopy.length !== 1) throw new Error("Final L5 well recipe must retain its actual canopy");
      const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
      const { nationDrinkChain } = await imp("/src/shared/settlement/nation-drinks.ts");
      const chain = nationDrinkChain(nation);
      const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
      const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
      const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
      const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
      const { placeProp } = await imp("/src/shared/world/editing/prop-placement.ts");
      const { PROP } = await imp("/src/shared/world/world-data.ts");
      settingsStorage.writeFog(false);
      const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100, seed: 1234 });
      world.heights.fill(1); world.blocking.fill(0); world.walkCost.fill(10);
      world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
      world.start = { x: 48.5, z: 48.5 }; world.props.count = 0;
      let simulation: any;
      const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
      simulation = createSettlementSimulation({ initialSettlers: 80, initialStock: { axe: 8, bow: 8, cleaver: 8, coal: 20,
        crucible: 8, fishingRod: 8, grain: 20, ironOre: 20, pickaxe: 8, pig: 6, planks: 80, rollingPin: 8, saw: 8,
        shovel: 8, stone: 80, tongs: 8, water: 20, flour: 20, cloth: 64, [chain.raw]: 4 }, playerNation: nation, roads, world });
      const plots: any[] = [];
      const place = (type: number, x0: number, z0: number, rotation: number) => {
        const [width, depth] = getBuildingDefinition(type).gridFootprint;
        const x = x0 + width % 2 / 2, z = z0 + depth % 2 / 2;
        const result = simulation.placeBuilding(type, x, z, rotation);
        if (!result.ok) throw new Error(`${type}: ${result.reason}`);
        Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
        plots.push({ access: result.building.access, rotation, type, uid: result.building.uid, x, z });
      };
      let types = [35, 19, 20];
      if (wellOnly) types = [35];
      if (quarryOnly) types = [19];
      for (const [row, type] of types.entries()) for (let rotation = 0; rotation < 4; rotation++) {
        place(type, 26 + rotation * 14, 25 + row * 16, rotation);
        const plot = plots.at(-1);
        for (let level = 2; level <= 5; level++) {
          const upgraded = simulation.debugRaiseBuildingLevel(plot.uid);
          if (!upgraded.ok || upgraded.level !== level) throw new Error(`${type}: level ${level} failed`);
        }
        plot.level = 5;
        if (quarryOnly) {
          const boulder = placeProp(world, { kind: PROP.largeRock, seed: 177 + rotation,
            x: plot.x + 6, z: plot.z + 5 });
          if (typeof boulder !== "number") throw new Error(`Quarry boulder refused: ${boulder}`);
        }
      }
      // Roads are laid after every plot is claimed, so no road crosses a later plot.
      for (const plot of plots)
        if (!simulation.connectRoads(simulation.headquarters.access, plot.access)) throw new Error(`${plot.type}: no road`);
      const entries: number[] = [];
      const entryTicks = quarryOnly ? 0 : 9000;
      for (let tick = 0; tick < entryTicks && entries.length < plots.length; tick++) {
        simulation.update(.05);
        for (const actor of simulation.frames())
          if (actor.phase === "enterAssigned" && !entries.includes(actor.building)) entries.push(actor.building);
      }
      const saved = await createGameSave(world, simulation.saveState(),
        { animals: [], name: "Indigenous open windlass well review", savedAt: Date.now(), source: "generated" });
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
      return { canopy: canopy.map((part: any) => ({ position: part.position, size: part.size })), entries, plots };
    }, { nation, quality, quarryOnly, wellOnly });
    const missing = fixture.plots.filter((plot: any) => !fixture.entries.includes(plot.uid)).map((plot: any) => plot.type);
    if (!quarryOnly) assert.deepEqual(missing, [], `${nation}: every reviewed building is entered by its worker`);
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("window.__islandReady = true"), "runtime readiness marker must be instrumented");
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "(window.__pilotReview = { camera, settlement, detail: graphics.detail, nation: playerNation, simulation: settlement?.simulation }, window.__islandReady = true)") });
    });
    await page.goto(`${url}?quality=${quality}`);
    try {
      await page.waitForFunction(() => Boolean((window as any).__pilotReview), null, { timeout: 180000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({ text: document.body.innerText,
        ready: (window as any).__islandReady, pilot: Boolean((window as any).__pilotReview) }));
      writeFileSync(resolve(output, `${nation}-${quality}-failure.json`), JSON.stringify({ errors, diagnostics }, null, 2));
      throw error;
    }
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const loaded = await page.evaluate(() => ({ nation: (window as any).__pilotReview.nation,
      simulationNation: (window as any).__pilotReview.simulation.playerNation(),
      detail: (window as any).__pilotReview.detail }));
    assert.equal(loaded.nation, nation);
    assert.equal(loaded.simulationNation, nation);
    assert.equal(loaded.detail, quality);
    for (const plot of wellOnly || quarryOnly ? [] : fixture.plots) {
      await page.evaluate(({ x, z }) => Object.assign((window as any).__pilotReview.camera,
        { centerX: x, centerZ: z - 1, tilt: 0, yaw: 0, zoom: 2.1 }), plot);
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(output, `${nation}-${quality}-${plot.type}-${plot.rotation}-entry.png`) });
    }
    const phases: unknown[] = quarryOnly
      ? await captureIndigenousQuarryDoors(page, fixture.plots, quality, output) : [];
    for (const wellPlot of fixture.plots.filter((plot: any) => plot.type === 35)) {
    for (const target of wellOnly ? ["pickup", "carry"] : ["lowering", "pickup", "carry"]) {
      const sample = await page.evaluate(({ target, uid }) => {
        const simulation = (window as any).__pilotReview.simulation;
        // Advance the real simulation to a phase boundary, then pause its clock for both photos.
        const advance = (window as any).__wellReviewAdvance ??= simulation.update.bind(simulation);
        simulation.update = () => {};
        const matches = (actor: any) => {
          if (actor.building !== uid) return false;
          if (target === "lowering") return actor.phase === "wellWork" && actor.wellWork?.elapsed >= 1.4 && actor.wellWork.elapsed < 1.7;
          if (target === "raising") return actor.phase === "wellWork" && actor.wellWork?.elapsed >= 12.3 && actor.wellWork.elapsed < 12.6;
          if (target === "pickup") return actor.phase === "wellBucketPickup" && actor.wareTransfer?.progress >= .2;
          if (target === "carry") return actor.phase === "wellOutputWalk";
          return actor.phase === "outputPutdown" && actor.wareTransfer?.progress >= .2;
        };
        for (let tick = 0; tick < 16000; tick++) {
          const actor = simulation.frames().find(matches);
          if (actor) return { actorId: actor.uid, phase: actor.phase, position: [actor.x, actor.y, actor.z],
            work: actor.wellWork?.elapsed, workStyle: actor.wellWork?.style ?? "windlass", transfer: actor.wareTransfer?.progress, ware: actor.ware };
          advance(.025);
        }
        throw new Error(`Well ${uid} never reached ${target}`);
      }, { target, uid: wellPlot.uid });
      assert.equal(sample.workStyle, "windlass");
      const rendered = await page.evaluate(actorId => {
        const settlement = (window as any).__pilotReview.settlement;
        settlement.update(.5);
        settlement.update(.5);
        const worker = settlement.workerFrames.find((frame: any) => frame.actorId === actorId);
        return worker && { x: worker.x, z: worker.z, action: worker.action };
      }, sample.actorId);
      assert(rendered, `well ${target}: real worker is rendered`);
      assert(Math.hypot(rendered.x - sample.position[0], rendered.z - sample.position[2]) < .15,
        `well ${target}: rendered body follows real simulation contact`);
      phases.push({ target, rotation: wellPlot.rotation, ...sample, rendered });
      for (const [view, yaw] of [["front", wellPlot.rotation * Math.PI / 2]] as const) {
        await page.evaluate(({ x, yaw, z }) => Object.assign((window as any).__pilotReview.camera,
          { centerX: x, centerZ: z - .15, tilt: 0, yaw, zoom: 3.5 }), { ...wellPlot, yaw });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.screenshot({ path: resolve(output, `${nation}-${quality}-35-${wellPlot.rotation}-${target}-${view}.png`) });
      }
    }
    }
    reports.push({ canopy: fixture.canopy, entries: fixture.entries.length, errors, missingResources,
      nation, quality, loaded, phases, plots: fixture.plots });
    assert.deepEqual(errors, []);
    assert.deepEqual(missingResources, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"),
    JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
const source = guard.finish();
writeFileSync(resolve(output, "source.json"), JSON.stringify(source, null, 2));
assert(source.stable, source.errors.join("\n"));
console.log(`Indigenous working review: ${reports.length} quality reports; all browser/server FULL CLOSED.`);
