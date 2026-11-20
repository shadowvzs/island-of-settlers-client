import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Bounded 2/5/9-landmass acceptance (`npx tsx tools/bench/commander-scale-acceptance.ts`).
 * Generates legal island-count fixtures in the browser, recruits a commander, adds a bounded idle
 * fleet, and measures native shared-simulation tick cost plus the commander hit-hook cost.
 * It does not render; renderer frame cost is reported as an exact unrun case.
 */
const output = process.env.OUT ?? resourcesPath("project-reviews", "commander-acceptance-2026-10-27");
mkdirSync(output, { recursive: true });
const cases = [2, 5, 9].map(islands => ({ islands, size: 256,
  save: JSON.parse(readFileSync(resourcesPath("project-reviews", "home-island-2026-10-27", "generated",
    `home-map-${islands}-landmasses-256.save.json`), "utf8")) }));
const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
const pageErrors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") pageErrors.push(message.text()); });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/commander-scale.html", route => route.fulfill({
    contentType: "text/html", body: "<body></body>"
  }));
  await page.goto(`${url}commander-scale.html`);
  const report = await page.evaluate(async (cases) => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const { readGameSave } = await imp("/src/shared/settlement/game-save.ts");
    const { planPlayableIslands } = await imp("/src/shared/world/generation/archipelago-rules.ts");
    const { labelLandmasses } = await imp("/src/shared/world/generation/plateaus.ts");
    const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
    const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
    const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
    const { isHomeBuilding } = await imp("/src/shared/settlement/settlement-home.ts");
    const { createCommanderSystem } = await imp("/src/shared/settlement/settlement-commander-state.ts");
    const { commanderMaximumHealth } = await imp("/src/shared/settlement/settlement-commander.ts");

    const measure = (run: () => void, repeats = 3) => {
      const values: number[] = [];
      for (let repeat = 0; repeat < repeats; repeat++) {
        run();
        const start = performance.now();
        run();
        values.push(performance.now() - start);
      }
      values.sort((a, b) => a - b);
      return { medianMs: values[Math.floor(values.length / 2)]!, values };
    };
    const waterCell = (world: any, seed: number) => {
      const cells: number[] = [];
      for (let index = 0; index < world.waterDepth.length; index++)
        if (world.waterDepth[index] > .35) cells.push(index);
      if (!cells.length) return null;
      const index = cells[(seed * 7919) % cells.length]!;
      return { x: index % world.cellsX + .5, z: Math.floor(index / world.cellsX) + .5 };
    };
    const addFleet = (save: any, world: any, count: number) => {
      const point = waterCell(world, 3);
      if (!point) return 0;
      const ships = save.naval.fleet.ships;
      for (let index = 0; index < count; index++) {
        ships.push({ cargo: {}, cargoCount: 0, cursor: 0, id: index + 1, phase: "idle", route: [],
          timer: 0, x: point.x + index * .25, y: world.seaLevel, yaw: 0, z: point.z });
      }
      save.naval.fleet.nextShip = count + 1;
      return ships.length;
    };
    const buildFixture = async ({ islands, save, size }: { islands: number; save: any; size: number }) => {
      const generationStart = performance.now();
      const { map } = await readGameSave(save), world = map.world;
      const generationMs = performance.now() - generationStart;
      const labels = labelLandmasses({ cellsX: size, cellsZ: size }, world.heights);
      const landmasses = labels.landmasses.length;
      if (landmasses !== islands) throw new Error(`Expected exactly ${islands} landmasses, got ${landmasses}`);
      const sites = planPlayableIslands({ cellsX: size, cellsZ: size }, 1234, false, islands).length;
      let simulation: any;
      const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) =>
        simulation?.isOccupied(x, z) ?? false });
      simulation = createSettlementSimulation({
        developmentAllowed: true, initialSettlers: 30, initialStock: {
          beer: 20, coins: 50, mead: 20, wine: 20, hammer: 2, planks: 100, shield: 20, shovel: 2, stone: 100, sword: 20
        }, playerLevel: () => 13, playerNation: "viking", roads, world,
        restoredHome: save.settlement.buildings.find(isHomeBuilding)
      });
      const restored = simulation.loadState(save.settlement);
      if (!restored.ok) throw new Error(restored.reason);
      if (labelLandmasses(world, world.heights).landmasses.length !== islands)
        throw new Error("Restoring the fixture changed its connected landmass count");
      Object.assign(simulation.headquarters.inventory, { beer: 20, coins: 50, mead: 20, wine: 20, hammer: 2,
        planks: 100, shield: 20, shovel: 2, stone: 100, sword: 20 });
      const home = simulation.headquarters;
      const aligned = (value: number, side: number) => side % 2 === 0 ? Math.round(value) : Math.round(value) + .5;
      let lodge: any = null;
      const [lodgeWidth, lodgeDepth] = getBuildingDefinition(62).gridFootprint;
      for (let radius = 5; radius < 40 && !lodge; radius++) for (let step = 0; step < 64 && !lodge; step++) {
        const angle = step * Math.PI / 32;
        const x = aligned(home.x + Math.cos(angle) * radius, lodgeWidth);
        const z = aligned(home.z + Math.sin(angle) * radius, lodgeDepth);
        const placed = simulation.placeBuilding(62, x, z);
        if (!placed.ok || !placed.building) continue;
        Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
        if (!simulation.connectRoads(home.access, placed.building.access)) {
          simulation.demolishBuilding(placed.building.uid); continue;
        }
        lodge = placed.building;
      }
      if (!lodge) throw new Error(`No lodge plot on ${islands} islands`);
      const recruited = simulation.recruitCommander(lodge.uid);
      if (!recruited.ok) throw new Error(recruited.reason);
      simulation.levelUpCommander(lodge.uid);
      const baseSave = simulation.saveState();
      const commander = simulation.commanderState()!;
      const fieldSave = structuredClone(baseSave);
      const fieldSoldier = fieldSave.military.soldiers.find((entry: any) => entry.commanderId === commander.id)!;
      const fieldActor = fieldSave.actors.find((entry: any) => entry.uid === fieldSoldier.actor)!;
      Object.assign(fieldSoldier, { building: -3, stationed: false });
      Object.assign(fieldActor, { action: "idle", building: lodge.uid, mounted: true, path: [], pathIndex: 0,
        phase: "militaryField", visible: true, x: home.x + 8, y: home.y, z: home.z + 8 });
      fieldSave.military.commander = { ...fieldSave.military.commander, location: "field" };
      const fleetSave = structuredClone(fieldSave);
      const ships = addFleet(fleetSave, world, 16);
      const measureMode = (save: any) => {
        const loaded = simulation.loadState(save);
        if (!loaded.ok) throw new Error(loaded.reason);
        return measure(() => {
          for (let tick = 0; tick < 400; tick++) simulation.update(.05);
        });
      };
      const base = measureMode(baseSave);
      const field = measureMode(fieldSave);
      const fleet = measureMode(fleetSave);
      return { base, commander, field, fleet, fleetDeltaMs: fleet.medianMs - field.medianMs,
        generationMs, landmassSizes: labels.landmasses.slice(0, 12).map((entry: any) => entry.size), landmasses,
        lodge: { uid: lodge.uid }, ships, sites, size, soldierRank: fieldSoldier.rank,
        stored: simulation.militaryStoredTroops() };
    };
    const auraBench = () => {
      const xPositions = [0, 5, 20];
      const actors = Array.from({ length: 2000 }, (_, index) => ({
        action: "idle", animationTime: 0, building: -1, home: -1, job: "Soldier", path: [], pathIndex: 0,
        phase: index < 3 ? "militaryField" : "militaryReserve", timer: 0, uid: index + 1, visible: index < 3,
        ware: null, x: xPositions[Math.min(index, 2)], y: 0, yaw: 0, z: 0
      }));
      const context: any = { actors, buildings: [{ access: { x: 0, z: 0 }, construction: 1,
        doorThreshold: { x: 0, z: 0 }, militaryFaction: undefined, typeId: 62, uid: 10, y: 0 }],
        options: { developmentAllowed: true, world: { seed: 1 } }, playerNation: "viking" };
      const soldiers = new Map<number, any>([
        [1, { actor: 1, building: -3, commanderId: "commander-bench", combat: { cooldown: 0, faction: 0,
          hp: commanderMaximumHealth(2), type: "cavalry" }, rank: 0, stationed: false }],
        [2, { actor: 2, building: -3, combat: { cooldown: 0, faction: 0, hp: 125, type: "shield" }, rank: 0,
          stationed: false }],
        [3, { actor: 3, building: -3, combat: { cooldown: 0, faction: 1, hp: 125, type: "shield" }, rank: 0,
          stationed: false }]
      ]);
      const system = createCommanderSystem(context, soldiers);
      system.restore({ healingSeconds: 0, homeLodgeUid: 10, id: "commander-bench", level: 2, location: "field",
        name: "Bench", nation: "viking", recoverySeconds: 0, xp: 30 });
      const commander = soldiers.get(1)!, ally = soldiers.get(2)!, enemy = soldiers.get(3)!;
      const start = performance.now();
      for (let index = 0; index < 100_000; index++)
        system.modifyHit({ attacker: index % 2 ? ally : commander, defender: enemy, ranged: index % 3 === 0,
          random: () => .99 });
      const totalMs = performance.now() - start;
      return { actors: actors.length, calls: 100_000, nsPerCall: totalMs * 1e6 / 100_000, totalMs };
    };
    const results = [];
    for (const entry of cases) {
      try {
        const fixture = await buildFixture(entry);
        results.push({ islands: entry.islands, ok: true, ...fixture });
      } catch (error) {
        results.push({ islands: entry.islands, ok: false, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { aura: auraBench(), rendererFrame: "unrun (CPU simulation and hit-hook only)", results };
  }, cases);
  writeFileSync(resolve(output, "scale.json"), `${JSON.stringify({ errors: pageErrors, report }, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 1).slice(0, 6000));
  assert(report.results.every(result => result.ok), "Every exact-landmass commander fixture must pass");
  if (pageErrors.length) throw new Error(pageErrors.join("\n"));
} finally {
  await browser.close();
  await server.close();
}
