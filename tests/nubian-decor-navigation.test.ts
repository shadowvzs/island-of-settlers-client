import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { FLAX_FARM_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it.each([0, 1, 2, 3])("Nubian flax farmer reaches its fields and returns flax at rotation %i", rotation => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    initialSettlers: 24,
    initialStock: { hammer: 4, planks: 100, stone: 100 },
    playerNation: "nubian",
    roads,
    world
  });
  const [width, depth] = getBuildingDefinition(FLAX_FARM_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(FLAX_FARM_TYPE_ID, Math.floor(20 - width / 2) + width / 2,
    Math.floor(10 - depth / 2) + depth / 2, rotation);
  expect(placed.ok, placed.reason).toBe(true);
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  let observedFieldWork = false;
  for (let tick = 0; tick < 30000; tick++) {
    simulation.update(.05);
    if (simulation.frames().some(actor => actor.job === "Flax grower" && actor.phase === "work"))
      observedFieldWork = true;
    if (simulation.buildings().some(building => (building.output.flax ?? 0) > 0 ||
      (building.inventory.flax ?? 0) > 0)) break;
  }
  expect(observedFieldWork).toBe(true);
  expect(simulation.buildings().some(building => (building.output.flax ?? 0) > 0 ||
    (building.inventory.flax ?? 0) > 0)).toBe(true);
}, 30000);
