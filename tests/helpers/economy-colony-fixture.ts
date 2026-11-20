import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { MATERIAL_BUILDING_GROUPS } from "../../src/shared/settlement/advanced-material-production";
import { colonyIslandOffers } from "../../src/shared/settlement/colony-expedition-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { PROP } from "../../src/shared/world/world-data";
import { fakeColonyConquest } from "./fake-colony-conquest";
import { huntingWorld } from "./hunting-world";

export const economyColonyFixture = (group: typeof MATERIAL_BUILDING_GROUPS[number], renewable = false) => {
  const world = huntingWorld();
  world.colonyResourceTier = group.tier;
  world.colonyStoneDeposits = [{ id: 0, x: 14, z: 20, remaining: 2, material: group.stone }];
  world.seaLevel = .5;
  world.start = { x: 10, z: 31 };
  for (let z = 40; z <= 64; z++) for (let x = 0; x <= 64; x++) world.heights[z * 65 + x] = -1;
  for (let z = 40; z < 64; z++) for (let x = 0; x < 64; x++) {
    const cell = z * 64 + x;
    world.walkCost[cell] = 0;
    world.blocking[cell] = 1;
    world.buildClass[cell] = 0;
  }
  world.props.count = 1;
  world.props.types[0] = PROP[group.tree];
  world.props.x[0] = 22;
  world.props.z[0] = 23;
  world.props.scale[0] = 1;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const stock = { axe: 1, pickaxe: 1, saw: 1, shovel: 1, planks: 20, stone: 20 };
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 12, initialStock: stock,
    homeBuilding: 39, now: () => 1_000_000, canWorkerEnterPlot: () => true });
  const island = { ...colonyIslandOffers(1234)[0]!, resourceTier: group.tier };
  expect(simulation.startColony({ island, landed: stock, troops: [] }).ok).toBe(true);
  // Conquest is faked so the cycles this fixture hosts measure the economy only.
  fakeColonyConquest(simulation);
  const place = (type: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width % 2 / 2, z + depth % 2 / 2);
    expect(placed.ok, placed.reason).toBe(true);
    const building = placed.building!;
    Object.assign(building, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
    return building;
  };
  if (renewable) place(group.forester, 15, 17);
  place(group.woodcutter, 22, 17);
  const sawmill = place(33, 27, 25);
  sawmill.workshopUpgrade = { level: group.tier };
  expect(simulation.setProductionMode(sawmill.uid, group.planks)).toBe(true);
  place(group.quarry, 22, 34);
  // Explicit authored finite-resource fixture; real workers/roads/stock contacts process it.
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  return { place, simulation, world };
};
