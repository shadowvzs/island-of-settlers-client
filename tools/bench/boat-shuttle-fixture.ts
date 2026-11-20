import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { planShuttle, SHUTTLE_ROW_SPEED } from "../../src/shared/settlement/harbour-shuttle-plan";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { flushSavedOccupancy, savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD } from "../../src/shared/world/world-data";

/** A complete authored game world, with two unconnected harbours on a navigable natural-width coast. */
export const boatShuttleFixture = async (nation: "japanese" | "nubian" | "roman" | "viking" = "roman", maximumMixedCargo = false) => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 128,
    erosionDroplets: 0, forest: 0, islandCount: 1, mountains: 0, rivers: 0, seed: 20261028 });
  const beachHeight = (x: number) => {
    if (x < 20) return 2;
    if (x < 25) return 2 - (x - 20) * .35;
    if (x < 29) return -.1 - (x - 25) * .5;
    return -2;
  };
  for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x <= world.cellsX; x++)
    world.heights[z * (world.cellsX + 1) + x] = world.seaLevel + beachHeight(x);
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const index = z * world.cellsX + x, land = x < 25;
    world.walkCost[index] = land ? 10 : 0;
    world.blocking[index] = land ? 0 : 1;
    world.waterDepth[index] = land ? 0 : 2;
    world.buildClass[index] = land ? BUILD.large : 0;
    world.buildCap[index] = land ? BUILD.large : 0;
    world.slopeClass[index] = 0;
  }
  world.props.count = 0;
  world.start = { x: 10.5, z: 16.5 };
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ developmentAllowed: true, initialSettlers: 30,
    initialStock: {}, playerNation: nation, roads, world });
  const state = simulation.saveState(), occupied = savedOccupancy(state);
  const context = { nextBuilding: state.nextBuilding, options: { world } } as SettlementContext;
  const source = makeBuilding(context, 39, 20, 30, 0);
  const destination = makeBuilding(context, 39, 20, 55, 0);
  for (const building of [source, destination]) {
    Object.assign(building, { construction: 1, foundationProgress: 1, idleSettlers: 4,
      input: {}, inventory: {}, output: {}, required: {} });
    state.buildings.push(building);
    for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
      for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
        occupied[z * world.cellsX + x] = 1;
  }
  flushSavedOccupancy(state);
  state.nextBuilding = context.nextBuilding;
  state.buildings.find(building => building.typeId === 0)!.idleSettlers! -= 8;
  source.inventory = { boat: 1, stone: 6 };
  const restored = simulation.loadState(state);
  if (!restored.ok) throw new Error(restored.reason);
  if (!simulation.transferWare(source.uid, destination.uid, "stone", 3))
    throw new Error("The real shuttle transfer command was refused");
  if (maximumMixedCargo) {
    // Explicit finite authored grant: normal service selects one ware and does not emit mixed four-box loads.
    for (let tick = 0; tick < 100 && !simulation.saveState().naval.fleet.shuttles?.jobs.length; tick++) simulation.update(.05);
    const mixed = simulation.saveState(), job = mixed.naval.fleet.shuttles!.jobs[0]!;
    if (!job || job.phase !== "loading") throw new Error("Maximum-cargo fixture did not claim its real boat/paddler");
    const target = mixed.buildings.find(building => building.uid === job.destinationUid)!;
    for (const ware of ["planks", "logs", "cloth"]) { job.cargo[ware] = 1; target.incoming[ware] = 1; }
    job.plan = planShuttle(job.cargo, { route: job.sourceRoute }, { route: job.destinationRoute },
      job.plan.outbound * SHUTTLE_ROW_SPEED);
    job.timer = job.plan.loading;
    const applied = simulation.loadState(mixed);
    if (!applied.ok) throw new Error(applied.reason);
  }
  const save = await createGameSave(world, simulation.saveState(), {
    animals: [], name: "Boat shuttle native acceptance", savedAt: 1_793_160_000_000, source: "authored"
  });
  return { destination: { uid: destination.uid, x: destination.x, z: destination.z },
    save, simulation, source: { uid: source.uid, x: source.x, z: source.z }, world };
};

export const boatShuttleJob = (save: GameSaveV1) => save.settlement.naval.fleet.shuttles?.jobs[0];
