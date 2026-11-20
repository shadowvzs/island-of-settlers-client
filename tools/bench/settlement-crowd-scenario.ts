import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../../src/render-common/buildings/building-courtyard";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

const SIZE = 64;
const SITE_TYPE = 33;
const SITE_MATERIALS = 40;

const createWorld = () => ({
  blocking: new Uint8Array(SIZE ** 2), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  cellsX: SIZE, cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), mineZone: new Uint16Array(SIZE ** 2),
  mineZones: [], oreAmount: new Uint8Array(SIZE ** 2),
  props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() },
  seaLevel: -1, seed: 3, start: { x: 25, z: 20 }, walkCost: new Uint8Array(SIZE ** 2).fill(10)
}) as unknown as WorldData;

/** Uses the game's stock contacts, so construction sites receive wares at their laid-out stock bays. */
export const createCrowdScenario = (settlers: number) => {
  const world = createWorld();
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const isOccupied = (x: number, z: number) => simulation?.isOccupied(x, z) ?? false;
  const roads = createRoadNetwork(world, { isBlocked: isOccupied });
  simulation = createSettlementSimulation({
    canWorkerEnterPlot: (b, p) => isBuildingCourtyardPointWalkable(b.typeId, b.x, b.z, b.rotation, p, b.output, b.input),
    initialSettlers: settlers, initialStock: { hammer: 8, logs: 300, planks: 300, stone: 300 },
    resourceTargets: () => [], roads, stockContact: createIslandStockContacts(world, isOccupied), world
  });
  const [width, depth] = getBuildingDefinition(SITE_TYPE).gridFootprint;
  const sites = [[33, 20], [25, 28]].map(([x, z]) => {
    const placed = simulation!.placeBuilding(SITE_TYPE, x! + width % 2 / 2, z! + depth % 2 / 2);
    if (!placed.ok) throw new Error(placed.reason);
    simulation!.connectRoads(simulation!.headquarters.access, placed.building!.access);
    placed.building!.required = { planks: SITE_MATERIALS, stone: SITE_MATERIALS };
    return placed.building!;
  });
  return { simulation, sites };
};
