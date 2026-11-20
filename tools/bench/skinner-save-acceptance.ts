import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { GameRuntimeState } from "../../src/app/settlement/game-session";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createCamera } from "../../src/render-common/camera-state";
import { createAnimalManager } from "../../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../../src/render-common/wildlife/nav/island-nav";
import { SPECIES } from "../../src/render-common/wildlife/wildlife-species";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "skinner-save");
await mkdir(output, { recursive: true });
const reports = [];
for (const kind of ["pig", "carcass"] as const) {
  const world = huntingWorld(), fee = getConstructionCost(3);
  const stock = { hammer: 1, cleaver: 1, pig: kind === "pig" ? 1 : 0, planks: fee.planks, stone: fee.stone };
  const initial = createSettlementSimulation({ world, roads: createRoadNetwork(world),
    initialSettlers: 20, initialStock: stock });
  const raw = await createGameSave(world, initial.saveState(), { name: `Finite Skinner ${kind}`,
    source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]! };
  let session = await createNaturalProgressionSession(raw);
  const [width, depth] = getBuildingDefinition(3).gridFootprint;
  const placed = session.sim.placeBuilding(3, 26 + width % 2 / 2, 12 + depth % 2 / 2);
  assert(placed.ok && placed.building);
  const uid = placed.building.uid;
  assert(session.sim.connectRoads(session.sim.headquarters.access, placed.building.access));
  if (kind === "carcass") {
    for (let i = 0; i < 16_000 && placed.building.construction < 1; i++) session.sim.update(.05);
    assert.equal(placed.building.construction, 1);
    const source = await session.save();
    // An explicitly authored single carcass, created by the real animal lifecycle, not a resource hook.
    const animals = createAnimalManager(session.world, createIslandNav(session.world, []));
    animals.update(session.sim.gameNow() / 1000, createCamera(30, 18, 1));
    assert(animals.placeAnimal(SPECIES.deer, 32, 18));
    const id = animals.debug.pool.active.findIndex(Boolean);
    assert(id >= 0);
    animals.killAnimal(id);
    (source.runtime as GameRuntimeState).animals = animals.saveState();
    await writeFile(resolve(output, "authored-carcass.json"), JSON.stringify(source));
    session = await createNaturalProgressionSession(source);
  }
  let committed = false;
  for (let i = 0; i < 16_000; i++) {
    session.sim.update(.05);
    const actor = session.sim.frames().find(actor => actor.building === uid && actor.phase === "work");
    if (!actor) continue;
    if (kind === "carcass" && actor.target?.kind !== "carcass") continue;
    if (kind === "pig" && actor.consumed?.pig !== 1) continue;
    committed = true; break;
  }
  assert(committed, `Actual ${kind} work must begin`);
  const paid = await session.save();
  await writeFile(resolve(output, `${kind}-working.json`), JSON.stringify(paid));
  for (const branch of ["continuous", "restored"]) {
    const current = branch === "continuous" ? session : await createNaturalProgressionSession(paid);
    assert.deepEqual(current.sim.saveState(), paid.settlement);
    for (let i = 0; i < 12_000; i++) current.sim.update(.05);
    assert.equal(current.sim.headquarters.inventory.hides, 1, `${kind}/${branch}: one hide delivered`);
    assert.equal(current.sim.headquarters.inventory.pig ?? 0, 0);
    assert.equal(current.sim.population().people, 20 + current.sim.settlerBirths());
    const final = await current.save();
    const restored = await createHeadlessIsland(final);
    assert.deepEqual(restored.simulation.saveState(), final.settlement);
    await writeFile(resolve(output, `${kind}-${branch}-final.json`), JSON.stringify(final));
    reports.push({ branch, kind, hides: current.sim.headquarters.inventory.hides,
      people: current.sim.population().people, births: current.sim.settlerBirths() });
  }
}
await writeFile(resolve(output, "report.json"), JSON.stringify({ reports,
  scope: "Authored finite level14; actual paid Skinner construction, one pig or canonical authored animal carcass, physical work/delivery and full-save continuation; CPU only"
}, null, 2));
console.log(output);
