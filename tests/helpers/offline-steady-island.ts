import { expect } from "vitest";

import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { placeProp } from "../../src/shared/world/editing/prop-placement";
import { ORE, PROP, PROP_REMOVED, type WorldData } from "../../src/shared/world/world-data";
import { huntingWorld } from "./hunting-world";

const STEADY_START = 10_000_000;
/**
 * Real ticks before the fixture is saved. The HQ horse-traffic merge (3c4128a3) changed exact HQ door
 * traffic: the hour's exact water moved 228 -> 230 and measured skips missed it by 11 of 10.9 allowed
 * (was 8). 20 min instead of 15 starts the hour further into the steady regime (worst 0.64 of tolerance).
 * 30 min (red-tests-2): after 20 min the forest is still in transition. The first measured 15 min
 * fell 27 trees against 16 forester plantings (net -11), the rest of the hour only -5.7 per 15 min,
 * so a jump extrapolating the start lost 35-40 trees where exact lost 28 (tolerance 5). From 30 min
 * the woodcutter already lives mostly on the plantation: trees fast 12/15 vs exact 11.
 */
const WARM_UP_MS = 1_800_000;
const MINE = { x: 20, z: 18 }, ORE_PER_CELL = 40;

const addCoalSeam = (world: WorldData) => {
  world.mineZones = [{ id: 1, ore: ORE.coal, cellCount: 4, centreX: 21, centreZ: 19, richness: 1, surveyed: true }];
  world.oreAmount.fill(0);
  for (let z = MINE.z; z < MINE.z + 2; z++) for (let x = MINE.x; x < MINE.x + 2; x++) {
    world.mineZone[z * world.cellsX + x] = 1;
    world.oreAmount[z * world.cellsX + x] = ORE_PER_CELL;
  }
};

const addForest = (world: WorldData) => {
  for (let z = 30; z <= 46; z += 2) for (let x = 44; x <= 58; x += 2)
    placeProp(world, { kind: PROP.broadleafTree, seed: x * 131 + z, x: x + .5, z: z + .5 });
};

const addBoulders = (world: WorldData) => {
  for (const [x, z] of [[4, 52], [9, 54], [13, 50]] as const)
    placeProp(world, { kind: PROP.largeRock, seed: x * 977 + z, x: x + .5, z: z + .5 });
};

/**
 * A small developed home island with steady chains: a well, a sawmill on a large log stock, a coal
 * mine fed from a fish stock, a woodcutter and a forester at a natural forest, and a quarry whose
 * boulders rest and respawn.
 */
export const steadyIslandSave = async () => {
  const world = huntingWorld();
  addCoalSeam(world);
  addForest(world);
  addBoulders(world);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 30, initialStock: {
    axe: 2, fish: 400, hammer: 2, logs: 400, pickaxe: 2, planks: 40, saw: 2, shovel: 2, stone: 40 } });
  const place = (type: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  };
  place(11, MINE.x, MINE.z);
  place(33, 30, 18);
  place(35, 20, 30);
  place(17, 38, 34);
  place(20, 48, 22);
  place(19, 4, 42);
  const fresh = await createGameSave(world, simulation.saveState(), {
    name: "Steady offline island", savedAt: STEADY_START - WARM_UP_MS, source: "generated", animals: [] });
  // Staff, tools and first deliveries settle in real ticks first: the island is mid-cycle when saved.
  return advanceOfflineGame(fresh, STEADY_START, () => {}, { exact: true, eventCore: false });
};

const addGoods = (total: Record<string, number>, goods: Record<string, number> | undefined) => {
  for (const [ware, count] of Object.entries(goods ?? {})) total[ware] = (total[ware] ?? 0) + count;
};

/**
 * Every ware the island holds, as the offline ledger counts it. Shared storage stock lives in the
 * storage pools since 6443243c5 (a saved storage `inventory` keeps only local wares).
 */
export const heldGoods = (state: SettlementSaveV1) => {
  const total: Record<string, number> = {};
  for (const pool of state.storagePools?.pools ?? []) addGoods(total, pool.available);
  for (const building of state.buildings) {
    addGoods(total, building.inventory); addGoods(total, building.input); addGoods(total, building.output);
  }
  for (const actor of state.actors) {
    if (actor.ware) addGoods(total, { [actor.ware]: actor.wareUnits ?? 1 });
    else if (actor.productionOutput) addGoods(total, actor.consumed);
  }
  return total;
};

export const standingTreeCount = (world: WorldData) => {
  let count = 0;
  for (let id = 0; id < world.props.count; id++)
    if (world.props.types[id] !== PROP_REMOVED && world.props.types[id] === PROP.broadleafTree) count++;
  return count;
};

export const oreLeft = (world: WorldData) => world.oreAmount.reduce((sum, amount) => sum + amount, 0);
