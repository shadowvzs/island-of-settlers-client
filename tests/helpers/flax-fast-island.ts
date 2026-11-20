import { STARTER_STOCK } from "@shared/catalog/balance";

import { advanceOfflineEconomyGame, type OfflineEconomyMetrics } from "../../src/app/settlement/offline-economy";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD } from "../../src/shared/world/world-data";
import { edgeBayWorld } from "./edge-bay-settlement";
import { huntingWorld } from "./hunting-world";

/** The 64×64 hunting fixture with the south bay's coast and a complete edge for map saves. */
export const flaxFastWorld = () => {
  const world = huntingWorld(), bay = edgeBayWorld();
  world.heights.set(bay.heights);
  world.walkCost.set(bay.walkCost);
  world.blocking.set(bay.blocking);
  world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large);
  world.slopeClass.fill(0);
  world.start = { x: 32.5, z: 36.5 };
  return world;
};

export interface FlaxFastIsland {
  farmUid: number;
  raw: GameSaveV1;
  save: GameSaveV1;
  simulation: ReturnType<typeof createSettlementSimulation>;
  weaverUid: number;
  world: ReturnType<typeof flaxFastWorld>;
  yardUid: number;
}

/**
 * A real new-game stock chain: Flax Farm, Weaver and Ships-mode Shipyard, roads and workers.
 * Saved before the shipwright starts a site, so tests can exercise both the fast site and a saved
 * partial site without mixing a native active receipt.
 */
export const flaxFastIsland = async (ticks = 850): Promise<FlaxFastIsland> => {
  const world = flaxFastWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 30,
    initialStock: { ...STARTER_STOCK } });
  const hq = simulation.headquarters, uids = new Map<number, number>();
  for (const typeId of [60, 61, 36]) {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    let placed = false;
    for (let dz = -14; dz <= 20 && !placed; dz++) for (let dx = -20; dx <= 20 && !placed; dx++) {
      const x = Math.floor(hq.x) + dx + (width % 2 ? 0.5 : 0);
      const z = Math.floor(hq.z) + dz + (depth % 2 ? 0.5 : 0);
      if (simulation.validatePlacement(typeId, x, z, 0)) continue;
      const result = simulation.placeBuilding(typeId, x, z, 0);
      if (!result.ok || !simulation.connectRoads(hq.access, result.building!.access)) continue;
      Object.assign(result.building!, { construction: 1, foundationProgress: 1, required: {},
        input: {}, output: {} });
      if (typeId === 36) simulation.setShipyardMode(result.building!.uid, "ships");
      uids.set(typeId, result.building!.uid);
      placed = true;
    }
    if (!placed) throw new Error(`Flax fast fixture could not place building ${typeId}`);
  }
  const initialYard = simulation.buildings().find(building => building.uid === uids.get(36))!;
  let pausedForSetup = false;
  for (let tick = 0; tick < ticks; tick++) {
    // Movement/door timing changes must not turn a fixed warm-up count into a paid active hull.
    // Pause new work as soon as the real shipwright is staffed, before it reaches its work site.
    if (!pausedForSetup && initialYard.worker !== undefined) {
      if (simulation.saveState().naval.active.length) throw new Error("Fixture created work before its setup pause");
      simulation.setProductionPaused(initialYard.uid, true); pausedForSetup = true;
    }
    simulation.update(.05);
  }
  if (pausedForSetup) simulation.setProductionPaused(initialYard.uid, false);
  if (simulation.saveState().naval.active.length)
    throw new Error("Flax fast fixture must be saved outside a native shipwright receipt");
  const save = await createGameSave(world, simulation.saveState(), { name: "flax fast fixture",
    savedAt: 1_000_000, source: "generated", animals: [] });
  // One fast hour creates the four real saved flax plots without a native shipwright receipt.
  const settled = await advanceOfflineEconomyGame(save, save.savedAt + 3600_000, () => {}, {
    economy: true, economyCalibrationSeconds: 0
  });
  settled.settlement.naval.fleet.ships = [];
  settled.settlement.naval.fleet.nextShip = 1;
  settled.settlement.naval.sites = [];
  settled.settlement.naval.active = [];
  settled.settlement.naval.nextSite = 1;
  const yard = settled.settlement.buildings.find(building => building.typeId === 36)!;
  yard.input = {}; yard.output = {}; yard.incoming = {};
  return { farmUid: uids.get(60)!, raw: save, save: settled, simulation, weaverUid: uids.get(61)!,
    world, yardUid: uids.get(36)! };
};

export const runFlaxFast = async (save: GameSaveV1, seconds: number) => {
  let metrics: OfflineEconomyMetrics | undefined;
  const next = await advanceOfflineEconomyGame(save, save.savedAt + seconds * 1000, () => {}, {
    economy: true, economyCalibrationSeconds: 0,
    onEconomyMetrics: value => { metrics = value; }
  });
  return { metrics: metrics!, save: next };
};
