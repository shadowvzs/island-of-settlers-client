import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "charburner-save");
await mkdir(output, { recursive: true });
const world = huntingWorld(), fee = getConstructionCost(27);
const stock = { hammer: 1, shovel: 1, logs: 6, grain: 0, planks: fee.planks, stone: fee.stone };
const initial = createSettlementSimulation({ world, roads: createRoadNetwork(world),
  initialSettlers: 20, initialStock: stock });
const raw = await createGameSave(world, initial.saveState(), { name: "Finite paid charcoal pile",
  source: "generated", savedAt: 1_000_000, animals: [] });
raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]! };
const session = await createNaturalProgressionSession(raw), { sim } = session;
const [width, depth] = getBuildingDefinition(27).gridFootprint;
const placed = sim.placeBuilding(27, 26 + width % 2 / 2, 12 + depth % 2 / 2);
assert(placed.ok && placed.building);
assert(sim.connectRoads(sim.headquarters.access, placed.building.access));
const boundaries = new Map<string, GameSaveV1>();
const phases = ["building", "burning", "uncovering"];
let ticks = 0;
for (; ticks < 48_000; ticks++) {
  sim.update(.05);
  const field = sim.fieldFrames().find(field => field.kind === "charcoal");
  if (field && phases.includes(field.state) && !boundaries.has(field.state) &&
    (field.state !== "building" || field.step >= 2)) {
    const saved = await session.save();
    boundaries.set(field.state, saved);
    await writeFile(resolve(output, `${field.state}.json`), JSON.stringify(saved));
  }
  if (sim.headquarters.inventory.coal === 6) break;
}
assert.equal(boundaries.size, 3, "The actual worker must reach all three partial charcoal stages");
assert.equal(sim.headquarters.inventory.coal, 6, "Six finite logs become exactly six delivered coal");
const reports = [];
for (const [stage, source] of [["continuous", await session.save()], ...boundaries.entries()] as const) {
  const branch = await createNaturalProgressionSession(source);
  assert.deepEqual(branch.sim.saveState(), source.settlement, `${stage}: complete state restores exactly`);
  let branchTicks = 0;
  for (; branchTicks < 48_000 && branch.sim.headquarters.inventory.coal !== 6; branchTicks++) branch.sim.update(.05);
  assert.equal(branch.sim.headquarters.inventory.coal, 6, `${stage}: exact finite coal output`);
  assert.equal(branch.sim.headquarters.inventory.logs ?? 0, 0);
  assert.equal(branch.sim.headquarters.inventory.grain ?? 0, 0);
  for (let i = 0; i < 4000; i++) branch.sim.update(.05);
  assert.equal(branch.sim.headquarters.inventory.coal, 6, "No repeated coal without fresh logs");
  assert.equal(branch.sim.population().people, 20 + branch.sim.settlerBirths());
  const final = await branch.save();
  const restored = await createNaturalProgressionSession(final);
  assert.deepEqual(restored.sim.saveState(), final.settlement);
  assert.equal(new Set(final.settlement.fields.map(field => field.id)).size, final.settlement.fields.length);
  await writeFile(resolve(output, `${stage}-final.json`), JSON.stringify(final));
  reports.push({ branchTicks, coal: branch.sim.headquarters.inventory.coal, stage,
    fields: final.settlement.fields, people: branch.sim.population().people, births: branch.sim.settlerBirths() });
}
await writeFile(resolve(output, "report.json"), JSON.stringify({ fee, stock, ticks, reports,
  scope: "Authored level14, exact paid construction and six finite logs; actual build/burn/uncover state machine, independent full-save branches; CPU only"
}, null, 2));
console.log(output);
