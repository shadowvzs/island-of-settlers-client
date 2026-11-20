import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Drink crops in the real game (High and Minimal, close and gameplay zoom): one row per crop kind
 * with every visual state, injected as field frames next to the headquarters (the simulation of
 * rice, hives and palms lives in the drink chain rules). Usage: tsx tools/bench/drink-crop-review.ts
 */
const output = resolve(process.env.OUTPUT ?? resourcesPath("settlement-previews", "nation-drinks", "crops"));
mkdirSync(output, { recursive: true });
const KINDS = process.env.KINDS?.split(",") ?? ["palm", "vine", "rice", "hive"];
const NATIONAL_STATES = [
  { progress: .1, state: "growing", step: 0 }, { progress: .4, state: "growing", step: 0 },
  { progress: .85, state: "growing", step: 0 }, { progress: 1, state: "ripe", step: 0 },
  { harvest: .6, progress: 1, state: "ripe", step: 0 },
  { harvest: .9, progress: 1, state: "ripe", step: 0 },
  { progress: 0, state: "stubble", step: 1 }, { progress: .2, state: "growing", step: 1 }
];
const FLAX_STATES = [
  { progress: .1, state: "growing" }, { progress: .5, state: "growing" },
  { progress: 1, state: "ripe" }, { progress: .2, state: "drying" },
  { progress: .9, state: "drying" }, { progress: 0, state: "stubble" }
];
/** Field crops (vine, rice) and persistent plantations (hive, palm), one state per column. */
const FIELD_STATES = [
  { progress: 0.1, state: "growing" }, { progress: 0.4, state: "growing" }, { progress: 0.62, state: "growing" },
  { progress: 0.85, state: "growing" }, { progress: 1, state: "ripe" }, { harvest: 0.6, progress: 1, state: "ripe" },
  { progress: 0, state: "stubble" }
];
/** The palm row shows growth, then the harvest: shake, fall, bounce, gather. */
const PALM_HARVEST_STATES = [
  { progress: 0.5, state: "growing" }, { progress: 0.6, state: "fruiting" }, { progress: 1, state: "ripe" },
  { harvest: 0.2, progress: 1, state: "ripe" }, { harvest: 0.36, progress: 1, state: "ripe" },
  { harvest: 0.4, progress: 1, state: "ripe" }, { harvest: 0.7, progress: 1, state: "ripe" }
];
const PLANTATION_STATES = [
  { progress: 0.2, state: "growing" }, { progress: 0.7, state: "growing" }, { progress: 0.3, state: "fruiting" },
  { progress: 0.8, state: "fruiting" }, { progress: 1, state: "ripe" }, { harvest: 0.36, progress: 1, state: "ripe" },
  { harvest: 0.6, progress: 1, state: "ripe" }
];
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = "window.__islandReady = true";
      assert(source.includes(marker), "Expose actual runtime world at the existing readiness boundary");
      await route.fulfill({ response, body: source.replace(marker,
        "(window.__cropVisualWorld = world, window.__islandReady = true)") });
    });
    if (process.env.FLAT_FIXTURE === "1") {
      await page.route("**/crop-flat-fixture.html", route => route.fulfill({
        body: "<body></body>", contentType: "text/html"
      }));
      await page.goto(`${url}crop-flat-fixture.html`);
      await page.evaluate(async () => {
        const imp = (path: string) => import(/* @vite-ignore */ path);
        const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
        const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
        const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
        const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
        const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
        const { MATERIAL, MATERIAL_COUNT } = await imp("/src/shared/world/world-data.ts");
        const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96,
          erosionDroplets: 0, islandCount: 1, seed: 1234 });
        // The strategy camera aims at y=0. Keep the inspection ground there so tall crowns fit.
        world.heights.fill(0); world.seaLevel = -1; world.blocking.fill(0); world.walkCost.fill(10);
        world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
        world.props.count = 0; world.start = { x: 48.5, z: 48.5 };
        world.splat.fill(0);
        for (let index = 0; index < world.splat.length; index += MATERIAL_COUNT)
          world.splat[index + MATERIAL.grass] = 255;
        const roads = createRoadNetwork(world);
        const simulation = createSettlementSimulation({ roads, world });
        const saved = await createGameSave(world, simulation.saveState(), {
          animals: [], name: "Canonical crop visual fixture", savedAt: 1234, source: "generated"
        });
        await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
      });
      await page.goto(`${url}?quality=${quality}&reveal=1&time=day`);
    } else await page.goto(`${url}?quality=${quality}&seed=123&cache=0&reveal=1&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
      null, { timeout: 120_000 });
    await page.addStyleTag({ content: ".stats-overlay { display: none !important; }" });
    const rows = await page.evaluate(({ fieldStates, flaxStates, kinds, nationalStates, palmStates, plantationStates }) => {
      const live = (window as any).__settlement, simulation = live.simulation, hq = simulation.headquarters;
      const frames: any[] = [], centres: Array<{ kind: string; x: number; z: number; sites: any[] }> = [];
      kinds.forEach((kind, row) => {
        const z = Math.floor(hq.z + 6 + (row ? 1 + row * 2.2 : 0)) + 0.5;
        const statesByKind: Record<string, typeof fieldStates> = { berries: nationalStates, cacao: nationalStates,
          flax: flaxStates, hive: plantationStates, palm: palmStates,
          pomegranate: nationalStates, tea: nationalStates };
        const states = statesByKind[kind] ?? fieldStates;
        // Paddies lie side by side (shared dikes), with a second joined row of ripe ones behind.
        const spacing = kind === "rice" ? 1 : 1.6, left = Math.floor(hq.x) - 3.5;
        const sites = states.map((state, column) => ({ step: 0, ...state,
          id: 900000 + row * 100 + column, kind, owner: hq.uid, x: left + column * spacing, z }));
        frames.push(...sites);
        if (kind === "rice") for (let column = 0; column < 4; column++) frames.push({ ...states[4], id: 900090 + column,
          kind, owner: hq.uid, step: 0, x: left + column, z: z - 1 });
        centres.push({ kind, sites, x: left + (kind === "hive" ? 5 : (states.length - 1) / 2) * spacing, z });
      });
      const original = simulation.fieldFrames.bind(simulation);
      if (kinds.some(kind => ["pomegranate", "tea", "berries", "cacao", "flax"].includes(kind))) {
        const world = (window as any).__cropVisualWorld;
        for (const frame of frames) if (!world.walkCost[Math.floor(frame.z) * world.cellsX + Math.floor(frame.x)])
          throw new Error(`Crop visual fixture is not on walkable ground: ${frame.kind}/${frame.id}`);
      }
      simulation.fieldFrames = () => [...original(), ...frames];
      return centres;
    }, { fieldStates: FIELD_STATES, flaxStates: FLAX_STATES, kinds: KINDS,
      nationalStates: NATIONAL_STATES, palmStates: PALM_HARVEST_STATES, plantationStates: PLANTATION_STATES });
    for (const [zoom, scale] of [["gameplay", 1.5], ["close", 3]] as const) {
      for (const row of rows) {
        await page.evaluate(({ scale, x, z }) => (window as any).__settlement.focusGround(x, z, scale), { ...row, scale });
        await page.waitForTimeout(600);
        const path = resolve(output, `${quality}-${zoom}-${row.kind}.png`);
        // Close view: the centre of the most zoomed-in camera, at twice the pixel density.
        await page.screenshot({ clip: zoom === "close" ? { height: 500, width: 750, x: 375, y: 250 } : undefined,
          path, scale: zoom === "close" ? "device" : "css" });
        reports.push({ kind: row.kind, path, quality, zoom });
      }
    }
    if (process.env.EACH_STATE === "1") for (const row of rows) for (const [index, site] of row.sites.entries()) {
      await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 4), site);
      await page.waitForTimeout(300);
      const path = resolve(output, `${quality}-state-${row.kind}-${index}-${site.state}.jpg`);
      await page.screenshot({ clip: { height: 850, width: 1000, x: 250, y: 0 }, path,
        quality: 94, scale: "device", type: "jpeg" });
      reports.push({ fixture: "authored visual state, canonical field renderer", path, quality, site });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(`Drink crop review: ${output}`);
