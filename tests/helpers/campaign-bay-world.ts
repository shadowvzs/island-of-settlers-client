import { HARBOUR_TYPE_ID } from "../../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./hunting-world";

/** A complete (saveable) 64² world with the sea along its south edge, like `edgeBayWorld`. */
const SIZE = 64, SHORE = 48;
export const bayWorld = () => {
  const world = huntingWorld(SIZE);
  for (let z = SHORE; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) world.heights[z * (SIZE + 1) + x] = -2;
  for (let z = SHORE; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    world.walkCost[z * SIZE + x] = 0;
    world.blocking[z * SIZE + x] = 1;
  }
  world.start = { x: 32.5, z: 36.5 };
  return world;
};

/** The landing harbour plot a campaign map of `bayWorld` names. */
export const bayHarbourPlot = () => {
  const world = bayWorld();
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, clockStart: 0,
    homeBuilding: HARBOUR_TYPE_ID, initialSettlers: 0, roads, world });
  const home = simulation.home()!;
  return { rotation: home.rotation, x: home.x, z: home.z };
};
