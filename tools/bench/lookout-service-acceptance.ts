import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { buildingLevelCost } from "../../src/shared/settlement/building-levels";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { FOG } from "../../src/shared/world/world-data";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "lookout-service");
await mkdir(output, { recursive: true });
const reports = [];
for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
  const world = huntingWorld(128);
  world.fog.fill(FOG.hidden); world.permanentFog = world.fog.slice();
  let initial: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => initial?.isOccupied(x, z) ?? false });
  const stock = { hammer: 4, planks: 100, stone: 100, spyglass: 1, bow: 3 };
  for (const [ware, count] of Object.entries(buildingLevelCost(14, 0)))
    (stock as Record<string, number>)[ware] = ((stock as Record<string, number>)[ware] ?? 0) + count;
  initial = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: stock, playerLevel: () => 14, playerNation: nation });
  const [width, depth] = getBuildingDefinition(14).gridFootprint;
  const placed = initial.placeBuilding(14, 24 + width % 2 / 2, 22 + depth % 2 / 2);
  assert(placed.ok && placed.building);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  assert(initial.connectRoads(initial.headquarters.access, placed.building.access));
  const raw = await createGameSave(world, initial.saveState(), { name: "Authored finite Lookout service",
    source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]! };
  const missing = structuredClone(raw);
  missing.settlement.buildings.find(building => building.uid === initial.headquarters.uid)!.inventory.spyglass = 0;
  const refusal = await createHeadlessIsland(missing);
  for (let i = 0; i < 300; i++) refusal.simulation.update(.05);
  assert.equal(refusal.simulation.buildings().find(building => building.uid === placed.building!.uid)!.worker, undefined);
  assert.equal(refusal.simulation.headquarters.inventory.bow, 3);
  let session = await createHeadlessIsland(raw);
  let ticks = 0;
  const tower = () => session.simulation.buildings().find(building => building.uid === placed.building!.uid)!;
  const until = (predicate: () => boolean) => {
    for (let i = 0; i < 18_000; i++) {
      session.simulation.update(.05); ticks++;
      if (predicate()) return true;
    }
    return false;
  };
  assert(until(() => session.simulation.frames().some(actor => actor.uid === tower().worker && actor.phase === "inside")));
  const scoutUid = tower().worker!;
  assert.equal(session.simulation.frames().find(actor => actor.uid === scoutUid)!.tool, "spyglass");
  assert.equal(session.simulation.headquarters.inventory.spyglass, 0);
  assert.equal(session.simulation.headquarters.inventory.bow, 3);
  const staffed = await session.save();
  session = await createHeadlessIsland(staffed);
  assert.deepEqual(session.simulation.saveState(), staffed.settlement);
  // The simulation charts in its tick (A13 phase 2): the lookout explores, it grants no live sight.
  const explored = () => session.world.fog.reduce((count, fog) => count + Number(fog !== FOG.hidden), 0);
  session.simulation.update(.05);
  const baseExplored = explored();
  assert(baseExplored > 0);
  assert(session.simulation.requestWorkshopUpgrade(tower().uid));
  assert(until(() => tower().workshopUpgrade?.level === 1));
  const upgradedExplored = explored();
  assert(upgradedExplored > baseExplored, JSON.stringify({ baseExplored, tower: tower(), upgradedExplored,
    scout: session.simulation.frames().find(actor => actor.uid === scoutUid) }));
  const upgraded = await session.save();
  session = await createHeadlessIsland(upgraded);
  assert.deepEqual(session.simulation.saveState(), upgraded.settlement);
  assert.equal(explored(), upgradedExplored);
  assert(session.simulation.demolishBuilding(tower().uid));
  assert(until(() => !session.simulation.frames().some(actor => actor.uid === scoutUid)));
  assert.equal(session.simulation.headquarters.inventory.spyglass, 1);
  assert.equal(session.simulation.headquarters.inventory.bow, 3);
  const final = await session.save();
  const restored = await createHeadlessIsland(final);
  assert.deepEqual(restored.simulation.saveState(), final.settlement);
  assert.equal(restored.world.fog.filter(fog => fog !== FOG.hidden).length, upgradedExplored);
  await writeFile(resolve(output, `${nation}-staffed.json`), JSON.stringify(staffed));
  await writeFile(resolve(output, `${nation}-upgraded.json`), JSON.stringify(upgraded));
  await writeFile(resolve(output, `${nation}-final.json`), JSON.stringify(final));
  reports.push({ baseExplored, nation, scoutUid, ticks, upgradedExplored });
  await writeFile(resolve(output, "report.json"), JSON.stringify({ reports,
    scope: "Authored completed Lookout/level14/finite stock; actual spyglass staffing, paid upgrade, simulation-owned charting and physical return; CPU only"
  }, null, 2));
  console.log(nation);
}
