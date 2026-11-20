import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BLOCKING, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const setup = () => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: { planks: 50, stone: 50 } });
  const tree = () => {
    world.props.count = 1; world.props.types[0] = PROP.palmTree;
    world.props.x[0] = 33.55; world.props.z[0] = 34.8; world.props.scale[0] = 1;
    world.blocking[34 * 64 + 33] = BLOCKING.prop;
  };
  return { world, simulation, roads, tree };
};

it("clears vegetation beside the entrance centre so the full road width can leave a new tower", () => {
  const { roads, simulation, tree, world } = setup();
  tree();
  const placed = simulation.placeBuilding(4, 32.5, 32);
  expect(placed.ok, placed.reason).toBe(true);
  expect(world.props.types[0]).toBe(PROP_REMOVED);
  expect(roads.planRoad(simulation.home()!.access, placed.building!.access)).not.toBeNull();
});

it("repairs the same sealed entrance on loading an old unfinished site", () => {
  const { roads, simulation, tree, world } = setup();
  const placed = simulation.placeBuilding(4, 32.5, 32);
  expect(placed.ok, placed.reason).toBe(true);
  tree();
  expect(roads.planRoad(simulation.home()!.access, placed.building!.access)).toBeNull();
  expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  expect(world.props.types[0]).toBe(PROP_REMOVED);
  expect(roads.planRoad(simulation.home()!.access, placed.building!.access)).not.toBeNull();
});
