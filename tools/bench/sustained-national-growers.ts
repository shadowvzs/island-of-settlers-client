import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { NATION_DRINK_CHAINS } from "../../src/shared/settlement/nation-drinks";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { flaxOwned } from "./flax-p08-ledger";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const out = resourcesPath("project-reviews", "acceptance-2026-10-28", "sustained-economy", "national-growers");
mkdirSync(out, { recursive: true });
const receipts = [];
for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
  const world = huntingWorld();
  world.waterDepth.fill(0); world.waterSurface.fill(world.seaLevel); world.lakeWater?.fill(0);
  const initial = createSettlementSimulation({ world, roads: createRoadNetwork(world), playerNation: nation,
    initialSettlers: 20, initialStock: { water: 250, shovel: 1, scythe: 1, planks: 20, stone: 20 } });
  for (const type of [5, 6]) {
    const [w, d] = getBuildingDefinition(type).gridFootprint;
    const placed = initial.placeBuilding(type, (type === 5 ? 24 : 36) + w % 2 / 2, 18 + d % 2 / 2);
    assert(placed.ok && placed.building, placed.reason ?? "Authored national chain placement");
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    assert(initial.connectRoads(initial.headquarters.access, placed.building.access));
  }
  const raw = await createGameSave(world, initial.saveState(), { name: `Finite ${nation} drink chain`, source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]!, talents: {} };
  const produced: Record<string, number> = {};
  const cycles: Record<number, number> = {}, used: Record<string, number> = {}, hourly = [];
  const session = await createNaturalProgressionSession(raw, (site, inputs, output) => {
    if (output) produced[output] = (produced[output] ?? 0) + 1;
    cycles[site.typeId] = (cycles[site.typeId] ?? 0) + 1;
    for (const [ware, amount] of Object.entries(inputs)) used[ware] = (used[ware] ?? 0) + amount;
  });
  assert.equal(session.sim.playerNation(), nation);
  for (let hour = 1; hour <= 6; hour++) {
    for (let tick = 0; tick < 72_000; tick++) session.sim.update(.05);
    const save = await session.save();
    const chain = NATION_DRINK_CHAINS[nation];
    const owned = Object.fromEntries([chain.raw, chain.drink, "water"].map(ware => [ware, flaxOwned(save, ware)]));
    assert.equal(owned[chain.drink], produced[chain.drink] ?? 0);
    assert.equal(owned[chain.raw], (produced[chain.raw] ?? 0) - (used[chain.raw] ?? 0));
    assert.equal(owned.water, 250 - (used.water ?? 0));
    hourly.push({ hour, cycles: { ...cycles }, consumed: { ...used }, owned,
      statuses: session.sim.buildings().map(site => ({ type: site.typeId, status: site.status })) });
    if (hour === 3 || hour === 6) writeFileSync(resolve(out, `${nation}-${hour}h.save.json`), JSON.stringify(save));
    if (hour === 6) {
      const restored = await createNaturalProgressionSession(save);
      assert.deepEqual(restored.sim.saveState(), session.sim.saveState());
    }
  }
  assert((cycles[5] ?? 0) > 20 && (cycles[6] ?? 0) > 20);
  receipts.push({ nation, hours: 6, cycles, produced, hourly });
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ status: receipts.length === 4 ? "passed" : "running", receipts,
    grants: 0, paidImports: 0, scope: "Authored finite level14 completed two-building chains; actual field growth, carriers, maker and canonical resources for six game hours per nation. Exact water/raw/drink ownership and settlement restore; not earned construction." }, null, 2));
  console.log(`PASS ${nation} six-hour finite national chain ${JSON.stringify(cycles)}`);
}
