import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readGameSave } from "../../src/shared/settlement/game-save";
import { createBoatRoutePlanner } from "../../src/shared/settlement/harbour-boat-route";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { flushSavedOccupancy, savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import { createSeaMask } from "../../src/shared/settlement/settlement-sea-navigation";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { resourcesPath } from "./resources-path";

const output = process.env.OUT ?? resourcesPath("project-reviews", "boat-shuttle-2026-10-28");
mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(resourcesPath("project-reviews", "home-island-2026-10-27", "manifest.json"), "utf8"));
const reports: unknown[] = [];
const fleetCount = Number(process.env.BOAT_FLEET ?? 0);
for (const count of [2, 5, 9]) {
  const record = manifest.fixtures.find((record: any) => record.requestedLandmasses === count);
  const game = JSON.parse(readFileSync(resourcesPath("project-reviews", "home-island-2026-10-27", record.path), "utf8"));
  const { map, settlement } = await readGameSave(game), world = map.world;
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ developmentAllowed: true, roads, world });
  if (!simulation.loadState(settlement).ok) throw new Error("Natural fixture restore failed");
  const base = simulation.saveState(), sourcePose = record.summary.world.playableSites[0].harbour;
  const make = (pose: SettlementPoint & { rotation: number }, uid: number) => {
    const building = makeBuilding({ nextBuilding: uid, options: { world } } as SettlementContext,
      39, pose.x, pose.z, pose.rotation);
    Object.assign(building, { construction: 1, foundationProgress: 1, idleSettlers: 4,
      input: {}, inventory: {}, output: {}, required: {} });
    return building;
  };
  let chosen: { source: ReturnType<typeof make>; destination: ReturnType<typeof make> } | undefined;
  let candidates = 0;
  const refusals: Record<string, number> = {};
  for (const distance of [8, 10, 12, 16, 20, 24, 28, 32]) {
    if (chosen) break;
    for (let step = 0; step < 24 && !chosen; step++) for (let rotation = 0; rotation < 4 && !chosen; rotation++) {
      const angle = step / 24 * Math.PI * 2;
      const pose = { rotation, x: Math.round(sourcePose.x + Math.cos(angle) * distance),
        z: Math.round(sourcePose.z + Math.sin(angle) * distance) };
      if (pose.x < 5 || pose.z < 5 || pose.x > world.cellsX - 5 || pose.z > world.cellsZ - 5) continue;
      simulation.loadState(base);
      if (!simulation.harbourBerthPreview(39, pose.x, pose.z, rotation)) continue;
      candidates++;
      const state = structuredClone(base), source = make(sourcePose, state.nextBuilding++),
        destination = make(pose, state.nextBuilding++);
      state.buildings.push(source, destination);
      state.buildings.find(building => building.typeId === 0)!.idleSettlers! -= 8;
      let overlap = false;
      const occupied = savedOccupancy(state);
      for (const building of [source, destination])
        for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
          for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++) {
            const index = z * world.cellsX + x;
            if (occupied[index] || world.walkCost[index] === 0) overlap = true;
            occupied[index] = 1;
          }
      flushSavedOccupancy(state);
      if (overlap) { refusals.plot = (refusals.plot ?? 0) + 1; continue; }
      source.inventory = { boat: 1, stone: 6 };
      const loaded = simulation.loadState(state);
      if (!loaded.ok) {
        refusals[loaded.reason ?? "restore"] = (refusals[loaded.reason ?? "restore"] ?? 0) + 1;
        continue;
      }
      const sourceStatus = simulation.harbourShuttleStatus(source.uid);
      if (sourceStatus?.reason !== "idle") {
        const reason = sourceStatus?.reason ?? "missing";
        refusals[reason] = (refusals[reason] ?? 0) + 1;
        if (reason === "no-route" && refusals[reason] === 1) {
          const sites = simulation.shipSites().filter(site => site.kind === "jetty");
          const points = sites.map(site => site.workPier!.contact);
          const planner = createBoatRoutePlanner(world, createSeaMask(world));
          const route = points.length === 2 ? planner.route(points[0]!, points[1]!) : null;
          console.log({ diagnostic: count, points, routeLength: route && planner.routeLength(route) });
        }
        continue;
      }
      if (!simulation.transferWare(source.uid, destination.uid, "stone", 3)) continue;
      for (let tick = 0; tick < 100; tick++) simulation.update(.05);
      if (simulation.saveState().naval.fleet.shuttles?.jobs.length)
        chosen = { source, destination };
    }
  }
  const started = performance.now(), timings: number[] = [];
  const phases = new Set<string>();
  let yieldingTicks = 0;
  if (chosen && fleetCount > 0) {
    const liveSource = simulation.buildings().find(building => building.uid === chosen.source.uid)!;
    liveSource.inventory.boat = 2;
    liveSource.inventory.planks = fleetCount;
    liveSource.idleSettlers = (liveSource.idleSettlers ?? 0) + 4;
    simulation.headquarters.idleSettlers! -= 4;
    assert(simulation.debugEnsureFreeShips(liveSource.uid, fleetCount));
    for (let ship = 0; ship < fleetCount; ship++)
      assert.notEqual(simulation.queueSeaTransport(liveSource.uid, chosen.destination.uid, { planks: 1 }), null);
  }
  let ticks = 0;
  if (chosen) for (; ticks < 30000; ticks++) {
    const job = simulation.saveState().naval.fleet.shuttles?.jobs[0];
    if (!job && (!fleetCount || (simulation.seaOrders().length === 0 &&
      simulation.ships().every(ship => ship.phase === "idle")))) break;
    if (job) phases.add(job.phase);
    if (job?.yielding) yieldingTicks++;
    const start = performance.now();
    simulation.update(.05);
    timings.push(performance.now() - start);
  }
  const final = simulation.saveState();
  const source = final.buildings.find(building => building.uid === chosen?.source.uid),
    destination = final.buildings.find(building => building.uid === chosen?.destination.uid);
  const result = { actualLandmasses: record.summary.world.landmassCount, candidates, count, refusals,
    delivered: destination?.inventory.stone ?? 0, eligible: Boolean(chosen), fleetCount, phases: [...phases],
    seaPlanks: destination?.inventory.planks ?? 0, seaOrders: simulation.seaOrders().length,
    ships: simulation.ships().map(ship => ({ id: ship.id, phase: ship.phase })), yieldingTicks,
    rowers: source?.idleSettlers, sourceStone: source?.inventory.stone, ticks,
    wallMs: performance.now() - started,
    maxTickMs: Math.max(0, ...timings), meanTickMs: timings.reduce((sum, time) => sum + time, 0) / Math.max(1, ticks) };
  reports.push(result);
  writeFileSync(resolve(output, `natural-scale-${fleetCount}.json`), JSON.stringify(reports, null, 2));
  console.log(result);
  assert.equal(result.actualLandmasses, count);
  assert(result.eligible, `No naturally eligible nearby harbour pair found on ${count} landmasses`);
  assert.equal(result.delivered, 3);
  assert.equal(result.sourceStone, 3);
  assert.equal(result.rowers, fleetCount ? 8 : 4);
  assert.equal(result.seaPlanks, fleetCount);
  assert.equal(result.seaOrders, 0);
}
