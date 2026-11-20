import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { createGameSave, readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { claimBuilding, makeBuilding } from "../../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { reconcileStorageAccess } from "../../src/shared/settlement/shared-storage";
import { buildFixtureRecord } from "./home-map-island-fixture-lib";
import { packSparseCells, savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";

// Generate a new current-codec scenario; never reinterpret or patch an old save version.
const output = resolve(process.argv[2] ?? "/tmp/home-fleet-current-2026-11-05");
await mkdir(output, { recursive: true });
const referencePath = resolve("../resources/project-reviews/acceptance-2026-10-28/home-fresh24-tail-boundary.save.json");
const original = await readFile(referencePath);
const reference = JSON.parse(original.toString("utf8"));
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const { bytes, record } = await buildFixtureRecord(9);
const loaded = await readGameSave(JSON.parse(bytes.toString("utf8")));
const world = loaded.map.world;
const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
assert(simulation.loadState(loaded.settlement).ok);
Object.assign(simulation.headquarters.inventory, { bow: 3, hammer: 20, planks: 400, shovel: 20, spyglass: 2, stone: 400 });
const sites = record.summary.world.playableSites;
// Existing fleet helper predates shared storage. Use canonical placement and current reconciliation.
const placeHarbour = (index: number) => {
  const state = simulation.saveState();
  const context = { ...state, occupied: savedOccupancy(state).slice(), options: { world } } as unknown as SettlementContext;
  const pose = sites[index]!.harbour;
  const harbour = makeBuilding(context, 39, pose.x, pose.z, pose.rotation);
  Object.assign(harbour, { construction: 1, foundationProgress: 1, idleSettlers: 10,
    inventory: { hammer: 2, planks: 200, shovel: 2, spyglass: 1, stone: 200 }, required: {}, status: "Harbour" });
  claimBuilding(context, harbour);
  const home = context.buildings.find(building => building.typeId === 0)!;
  assert((home.idleSettlers ?? 0) >= 10);
  home.idleSettlers! -= 10;
  reconcileStorageAccess(context);
  const restoredState = JSON.parse(JSON.stringify({ ...state, buildings: context.buildings,
    storagePools: context.storagePools, nextBuilding: context.nextBuilding, occupied: packSparseCells(context.occupied) }));
  const result = simulation.loadState(restoredState);
  assert(result.ok, JSON.stringify(result));
  return harbour.uid;
};
const sourceUid = placeHarbour(0);
const destinationUid = placeHarbour(1);
const source = simulation.buildings().find(building => building.uid === sourceUid)!;
const destination = simulation.buildings().find(building => building.uid === destinationUid)!;
source.workshopUpgrade = { level: 2 };
destination.workshopUpgrade = { level: 2 };
Object.assign(source.inventory, { hammer: 20, planks: 212, shovel: 20, spyglass: 1, stone: 200 });
Object.assign(destination.inventory, { hammer: 2, shovel: 2, logs: 12 });
simulation.debugEnsureFreeShips(sourceUid, 24);
const scoutOrder = simulation.queueSeaExploration(sourceUid);
assert.notEqual(scoutOrder, null);
for (let index = 0; index < 12; index++) {
  assert.notEqual(simulation.queueSeaTransport(sourceUid, destinationUid, { planks: 1 }), null);
  assert.notEqual(simulation.queueSeaTransport(destinationUid, sourceUid, { logs: 1 }), null);
}
let probes = 0;
for (const _ of simulation.prewarmCoastalGeometry()) probes++;
for (let tick = 0; tick < 300; tick++) simulation.update(.05);
const save = await createGameSave(world, simulation.saveState(), {
  animals: [], name: "Current canonical nine-landmass / 24-ship fleet", savedAt: 1_000_000, source: "generated"
});
assert.equal(save.version, 4);
const restored = await createHeadlessIsland(save);
assert.deepEqual(restored.simulation.saveState(), save.settlement, "Strict restore must preserve complete settlement");
const ships = save.settlement.naval.fleet.ships;
assert.equal(ships.filter(ship => !ship.visitor).length, 24);
assert.equal(record.summary.world.landmassCount, 9);
const serialized = JSON.stringify(save);
await writeFile(resolve(output, "fleet-24-9.save.json"), serialized);
const manifest = {
  origin: "New canonical generation, not migration or byte-equivalence to historical v1 checkpoint",
  generator: record.options, baseFixtureSHA256: sha(bytes), strictVersion: save.version,
  sha256: sha(serialized), landmasses: record.summary.world.landmassCount, preparationTicks: 300, probes,
  harbourSites: [sites[0]!.harbour, sites[1]!.harbour], harbourUids: [sourceUid, destinationUid],
  ownShips: 24, visitorShips: ships.filter(ship => ship.visitor).length,
  requestedLoads: { outboundPlanks: 12, returnLogs: 12 }, missionOrders: { scout: scoutOrder, founder: null },
  reference: { path: referencePath, sha256: sha(original), version: reference.version,
    ownShips: reference.settlement.naval.fleet.ships.filter((ship: { visitor?: boolean }) => !ship.visitor).length },
  note: "Canonical current defaults and actual generated shore sites; historical tail poses/tick are intentionally not fabricated."
};
assert.equal(sha(await readFile(referencePath)), manifest.reference.sha256, "Historical reference immutable");
await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
