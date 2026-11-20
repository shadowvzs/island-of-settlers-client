import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { buildingLevelCost } from "../../src/shared/settlement/building-levels";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { Goods } from "../../src/shared/settlement/settlement-types";
import { flaxFastWorld } from "../../tests/helpers/flax-fast-island";
import { createNaturalProgressionSession } from "./natural-progression-session";

export const createFlaxP08Fixture = async () => {
  const world = flaxFastWorld();
  const stock: Goods = { hammer: 8, flax: 64, ironOre: 96, planks: 120, stone: 80 };
  for (let level = 0; level < 4; level++) for (const type of [60, 61])
    for (const [ware, count] of Object.entries(buildingLevelCost(type, level))) stock[ware] = (stock[ware] ?? 0) + count;
  let initial: SettlementSimulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => initial?.isOccupied(x, z) ?? false });
  initial = createSettlementSimulation({ world, roads, initialSettlers: 30, initialStock: stock, playerLevel: () => 14 });
  for (const [type, x, z] of [[60, 14.5, 22.5], [61, 26, 22], [36, 42.5, 32]]) {
    const placed = initial.placeBuilding(type!, x!, z!);
    assert(placed.ok && placed.building, `Explicit producer plot ${type}`);
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    assert(initial.connectRoads(initial.headquarters.access, placed.building.access));
    if (type === 36) { initial.setShipyardMode(placed.building.uid, "ships"); initial.setProductionPaused(placed.building.uid, true); }
  }
  const raw = await createGameSave(world, initial.saveState(), { name: "Authored finite flax upgrade matrix",
    source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[13]!, talents: {} };
  const session = await createNaturalProgressionSession(raw), { sim } = session;
  // A real paid harbour gives the load matrix a coastal delivery endpoint. No visitors are purchased.
  const home = sim.headquarters;
  let harbour: ReturnType<typeof sim.buildings>[number] | undefined;
  for (const rotation of [0, 1, 2, 3]) {
    const footprint = getBuildingDefinition(39).gridFootprint;
    const [width, depth] = rotation % 2 ? [footprint[1]!, footprint[0]!] : footprint;
    for (let z = 5; z < 59 && !harbour; z++) for (let x = 5; x < 59 && !harbour; x++) {
      const point = { x: x + width % 2 / 2, z: z + depth % 2 / 2 };
      if (sim.validatePlacement(39, point.x, point.z, rotation)) continue;
      const placed = sim.placeBuilding(39, point.x, point.z, rotation);
      if (!placed.ok || !placed.building) continue;
      if (!sim.connectRoads(home.access, placed.building.access)) { sim.demolishBuilding(placed.building.uid); continue; }
      harbour = placed.building;
    }
    if (harbour) break;
  }
  assert(harbour, "Authored coast must support a real harbour");
  for (let tick = 0; tick < 18_000 && harbour.construction < 1; tick++) sim.update(.05);
  assert.equal(harbour.construction, 1, "Finite paid harbour completes");
  return { authored: "Synthetic 64² built producer fixture, finite explicit stock, authored level14; NOT earned progression",
    harbour: harbour.uid, stock, save: await session.save() };
};
