import type { ColonyIsland } from "../../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

/**
 * A settlement simulation on a generated colony island (settlement-colony*.test.ts). Files using it
 * mock `generate-world` with `cachedGenerateWorldModule` because production code generates the island.
 */
export const colony = (island: ColonyIsland, now = () => 5000, settlers = 2) => {
  const world = chooseColonyWorld(island);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: settlers,
    initialStock: {}, now, roads, world });
  return { simulation, world };
};
export const troops = (count: number) => Array.from({ length: count }, () => ({ hp: 125, rank: 1, type: "shield" as const }));
