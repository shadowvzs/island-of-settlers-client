import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { MATERIAL_BUILDING_GROUPS } from "../../src/shared/settlement/advanced-material-production";
import { travelTo } from "../../src/shared/settlement/archipelago";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { ORE } from "../../src/shared/world/world-data";
import { economyColonyFixture } from "./economy-colony-fixture";
import { huntingWorld } from "./hunting-world";

/** Small adversarial fixtures for the measured lane: each one is bounded to one hour. */
export const FIXTURE_START = 2_000_000;

const placeAll = (
  simulation: ReturnType<typeof createSettlementSimulation>,
  buildings: readonly (readonly [type: number, x: number, z: number])[]
) => {
  for (const [type, x, z] of buildings) {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
    if (!placed.ok || !placed.building) throw new Error(placed.reason);
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    if (!simulation.connectRoads(simulation.headquarters.access, placed.building.access))
      throw new Error(`no road to building ${type}`);
  }
};

const islandSave = async (
  name: string, buildings: readonly (readonly [type: number, x: number, z: number])[],
  initialSettlers: number, initialStock: Record<string, number>,
  prepareWorld?: (world: ReturnType<typeof huntingWorld>) => void
) => {
  const world = huntingWorld();
  prepareWorld?.(world);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers, initialStock });
  placeAll(simulation, buildings);
  return createGameSave(world, simulation.saveState(), {
    name, savedAt: FIXTURE_START, source: "generated", animals: []
  });
};

/** A coal seam under the given mine origin, enough ore for the whole fixture. */
const coalSeam = (world: ReturnType<typeof huntingWorld>, x = 20, z = 18) => {
  world.mineZones = [{ id: 1, ore: ORE.coal, cellCount: 4, centreX: x + 1, centreZ: z + 1,
    richness: 1, surveyed: true }];
  world.oreAmount.fill(0);
  for (let row = z; row < z + 2; row++) for (let column = x; column < x + 2; column++) {
    world.mineZone[row * world.cellsX + column] = 1;
    world.oreAmount[row * world.cellsX + column] = 2_000;
  }
};

/**
 * A sawmill on a finite log stock. The measured lane takes one skip before the logs run out; the
 * guard must stop further skips and let real ticks deplete the remaining stock.
 */
export const lateStockSave = () => islandSave("Late finite log stock", [[33, 30, 18]], 14,
  { hammer: 2, logs: 90, planks: 40, saw: 2, stone: 20 });

/**
 * A coal mine fed first from a finite fish stock and then from a large meat stock. The recipe's
 * input changes mid-replay (alternative food), which the measured flow cannot extrapolate as one rate.
 */
export const inputChangeSave = () => islandSave("Miner alternative food change", [[11, 20, 18]], 14,
  { fish: 140, hammer: 2, meat: 400, pickaxe: 2, planks: 20, stone: 20 }, coalSeam);

/**
 * Three completed residences raise the limit to 180 and nearly triple the birth rate. The replay
 * approaches the population limit, where births stop instead of repeating the measured birth rate.
 */
export const populationBoundarySave = () => islandSave("Population limit inside a skip",
  [[57, 34, 16], [58, 40, 24], [59, 34, 32]], 100,
  { hammer: 2, planks: 60, stone: 60 });

/**
 * A small colony that draws food from the home stock every minute, plus the home it draws from.
 * The home's 180 food runs out late in the replay while the colony keeps asking for supplies.
 */
export const colonyDrawSource = async () => {
  const home = await islandSave("Supply home", [[33, 30, 18]], 8,
    { fish: 60, hammer: 2, logs: 12, meat: 60, bread: 60, planks: 30, saw: 1, stone: 30 });
  const group = MATERIAL_BUILDING_GROUPS[0]!;
  const { simulation, world } = economyColonyFixture(group);
  // The colony fixture's roads leave little room: find the first free plot inside its territory.
  let mine: ReturnType<typeof simulation.placeBuilding>["building"];
  for (let z = 16; z <= 36 && !mine; z += 2) for (let x = 14; x <= 34 && !mine; x += 2) {
    coalSeam(world, x, z);
    const [width, depth] = getBuildingDefinition(11).gridFootprint;
    const placed = simulation.placeBuilding(11, x + width / 2, z + depth / 2);
    if (!placed.ok || !placed.building) continue;
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    if (!simulation.connectRoads(simulation.headquarters.access, placed.building.access)) continue;
    mine = placed.building;
  }
  if (!mine) throw new Error("no colony plot for the supply mine");
  const colony = await createGameSave(world, simulation.saveState(), {
    name: "Supply colony", savedAt: FIXTURE_START, source: "generated", animals: []
  });
  // The fixture's only pickaxe staffs its quarry; give the supply mine its own tool.
  const harbour = colony.settlement.buildings.find(building => building.typeId === 39);
  const pool = colony.settlement.storagePools.pools.find(entry => entry.id === harbour?.storagePoolId);
  if (pool) pool.available.pickaxe = (pool.available.pickaxe ?? 0) + 2;
  const setup = simulation.colony()!;
  home.archipelago = { active: null, version: 1, colonies: [{ expeditionId: 7,
    island: setup.island, status: "conquered", conqueredAt: FIXTURE_START,
    nextOreShipAt: FIXTURE_START + 3_600_000, save: colony }] };
  return travelTo(home.archipelago, home, null) as GameSaveV1;
};
