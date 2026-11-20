import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { PRODUCTION_RULES } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { flaxOwned } from "./flax-p08-ledger";
import { createNaturalProgressionSession } from "./natural-progression-session";

const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/economy-selected-recipes");
await mkdir(output, { recursive: true });
const persist = async (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2));
const owned = (save: GameSaveV1, ware: string) => flaxOwned(save, ware) +
  save.settlement.actors.filter(actor => actor.phase !== "retired" && actor.tool === ware).length;
const receipts = [];
for (const type of [8, 25]) for (const product of PRODUCTION_RULES[type]!.outputs) {
  const world = huntingWorld(), rule = PRODUCTION_RULES[type]!, fee = getConstructionCost(type);
  const stock: Record<string, number> = { hammer: 1, [rule.tool!]: 1, planks: fee.planks, stone: fee.stone };
  for (const ware of rule.inputs) stock[ware] = (stock[ware] ?? 0) + 1;
  const initial = createSettlementSimulation({ world, roads: createRoadNetwork(world),
    initialSettlers: 20, initialStock: stock });
  const raw = await createGameSave(world, initial.saveState(), { name: `Finite paid ${type}/${product}`,
    source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]!, talents: {} };
  const session = await createNaturalProgressionSession(raw), { sim } = session;
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = sim.placeBuilding(type, 26 + width % 2 / 2, 12 + depth % 2 / 2);
  assert(placed.ok && placed.building, placed.reason ?? "Place finite workshop");
  const uid = placed.building.uid;
  assert(sim.connectRoads(sim.headquarters.access, placed.building.access));
  if (type === 25) assert(sim.setProductionMode(uid, product));
  await persist(`${type}-${product}-initial.json`, await session.save());
  let committed = false;
  for (let tick = 0; tick < 16000; tick++) {
    sim.update(.05);
    const worker = sim.frames().find(actor => actor.building === uid && actor.phase === "work" &&
      rule.inputs.every(ware => (actor.consumed?.[ware] ?? 0) === 1));
    if (worker) {
      assert.equal(sim.buildings().find(building => building.uid === uid)!.construction, 1);
      if (type === 25) assert.equal(sim.buildings().find(building => building.uid === uid)!.selectedOutput, product);
      committed = true; break;
    }
  }
  assert(committed, `${type}/${product} reaches actual paid production`);
  const paid = await session.save(); await persist(`${type}-${product}-committed.json`, paid);
  const endpoints = [];
  for (const branch of ["continuous", "restored"]) {
    const current = branch === "continuous" ? session : await createNaturalProgressionSession(paid);
    const expectedOutput = (stock[product] ?? 0) + 1;
    for (let tick = 0; tick < 8000; tick++) current.sim.update(.05);
    const final = await current.save(), site = current.sim.buildings().find(building => building.uid === uid)!;
    assert.equal(owned(final, product), expectedOutput, `${product}: exactly one completed output plus original tools`);
    const attachedTools = final.settlement.actors.filter(actor => actor.phase !== "retired" && actor.tool === product).length;
    assert.equal(current.sim.headquarters.inventory[product], expectedOutput - attachedTools, `${product} physically delivered to HQ; original equipped tools remain attached`);
    assert.equal(site.cycle, 1, "Exhausted finite input permits one cycle only");
    for (const ware of new Set(rule.inputs)) assert.equal(owned(final, ware), 0, `All finite ${ware} consumed`);
    for (const other of rule.outputs.filter(ware => ware !== product))
      assert.equal(owned(final, other), stock[other] ?? 0, `No unintended ${other}`);
    assert.equal(current.sim.population().people, 20 + current.sim.settlerBirths());
    assert.equal(new Set(final.settlement.actors.map(actor => actor.uid)).size, final.settlement.actors.length);
    await persist(`${type}-${product}-${branch}-final.json`, final);
    endpoints.push({ branch, cycle: site.cycle, headquartersOutput: current.sim.headquarters.inventory[product],
      people: current.sim.population().people, births: current.sim.settlerBirths() });
  }
  receipts.push({ type, product, finiteStock: stock, actualConstructionCost: fee, endpoints });
}
const report = { provenance: "Authored level14, finite synthetic world and exact construction+one-cycle ingredients; actual paid construction, real carriers/stock contacts/worker entry. No stock grants, fake completed buildings or input injection during work.",
  cases: receipts.length, receipts };
await persist("report.json", report); console.log(JSON.stringify(report));
