import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { PRODUCTION_RULES } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { requiredMineOre } from "../../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { flaxOwned } from "./flax-p08-ledger";
import { createNaturalProgressionSession } from "./natural-progression-session";

const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/economy-mine-food");
await mkdir(output, { recursive: true });
const persist = async (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2));
const receipts = [];
for (const type of [10, 11, 12, 13]) for (const food of ["fish", "meat", "bread"]) {
  const world = huntingWorld(), rule = PRODUCTION_RULES[type]!, product = rule.outputs[0]!;
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const x = 26 + width % 2 / 2, z = 16 + depth % 2 / 2;
  const cell = Math.floor(z) * world.cellsX + Math.floor(x);
  world.mineZone.fill(0); world.oreAmount.fill(0);
  world.mineZone[cell] = 1; world.oreAmount[cell] = 2;
  world.mineZones = [{ id: 1, ore: requiredMineOre(type)!, cellCount: 1, centreX: x,
    centreZ: z, richness: 1, surveyed: true }];
  const fee = getConstructionCost(type), stock = { hammer: 1, pickaxe: 1, planks: fee.planks,
    stone: fee.stone, [food]: 3 };
  const initial = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 20,
    initialStock: stock });
  const raw = await createGameSave(world, initial.saveState(), { name: `Finite paid mine${type}/${food}`,
    source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]!, talents: {} };
  const session = await createNaturalProgressionSession(raw), { sim } = session;
  const placed = sim.placeBuilding(type, x, z);
  assert(placed.ok && placed.building, placed.reason ?? `Mine${type} placement`);
  const uid = placed.building.uid;
  assert(sim.connectRoads(sim.headquarters.access, placed.building.access));
  await persist(`${type}-${food}-initial.json`, await session.save());
  let committed = false;
  for (let tick = 0; tick < 16000; tick++) {
    sim.update(.05);
    const worker = sim.frames().find(actor => actor.building === uid && actor.phase === "work" &&
      actor.consumed?.[food] === 1);
    if (!worker) continue;
    assert.equal(sim.buildings().find(building => building.uid === uid)!.construction, 1);
    for (const other of rule.inputs.filter(ware => ware !== food)) assert.equal(worker.consumed?.[other] ?? 0, 0);
    assert.equal(session.world.oreAmount[cell], 2, "Paid first cycle has not extracted prematurely");
    committed = true; break;
  }
  assert(committed, `${type}/${food} starts actual paid mine work`);
  const paid = await session.save(); await persist(`${type}-${food}-committed.json`, paid);
  const endpoints = [];
  for (const branch of ["continuous", "restored"]) {
    const current = branch === "continuous" ? session : await createNaturalProgressionSession(paid);
    for (let tick = 0; tick < 8000; tick++) current.sim.update(.05);
    const final = await current.save(), mine = current.sim.buildings().find(building => building.uid === uid)!;
    assert.equal(flaxOwned(final, product), 2, "Exactly two extracted products including all physical/private ownership");
    assert.equal(current.sim.headquarters.inventory[product], 2, "Actual mine output physically delivered to HQ");
    assert.equal(flaxOwned(final, food), 1, "Only two alternative foods consumed; surplus remains after depletion");
    for (const other of rule.inputs.filter(ware => ware !== food)) assert.equal(flaxOwned(final, other), 0);
    assert.equal(current.world.oreAmount[cell], 0);
    assert.equal(current.world.oreAmount.reduce((sum, amount) => sum + amount, 0), 0);
    assert.equal(mine.cycle, 2, "Depleted deposit stops further cycles despite remaining food");
    assert.equal(flaxOwned(final, "planks"), 0, "Construction planks paid exactly");
    assert.equal(flaxOwned(final, "stone"), type === 10 ? 2 : 0, "Construction stone paid exactly");
    assert.equal(current.sim.population().people, 20 + current.sim.settlerBirths());
    assert.equal(new Set(final.settlement.actors.map(actor => actor.uid)).size, final.settlement.actors.length);
    await persist(`${type}-${food}-${branch}-final.json`, final);
    endpoints.push({ branch, cycles: mine.cycle, oreRemaining: 0, foodRemaining: 1,
      headquartersOutput: current.sim.headquarters.inventory[product], people: current.sim.population().people,
      births: current.sim.settlerBirths() });
  }
  receipts.push({ type, food, product, finiteStock: stock, actualConstructionCost: fee, endpoints });
}
const report = { provenance: "Authored level14 synthetic world,20 people,finite exact mine construction fee,builder hammer,miner pickaxe,three selected foods and two ore. Actual paid construction and canonical full-save/resource-runtime restore; no input grants or completed-building injection.",
  cases: receipts.length, receipts };
await persist("report.json", report); console.log(JSON.stringify(report));
