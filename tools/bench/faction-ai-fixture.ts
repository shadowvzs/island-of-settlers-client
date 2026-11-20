import type { createRoadNetwork } from "../../src/shared/settlement/road-network";
import type { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { createMapScenario, MapScenario } from "../../src/shared/world/map-scenario";
import type { WorldData } from "../../src/shared/world/world-data";

/**
 * EAI2a gate fixture (enemy economy AI plan §7 P2): a flat 64² colony map whose four computer factions (1-4) each
 * hold a garrisoned tower in a corner and send two field soldiers to the middle, where they meet the other factions
 * and learn of them (A13 knowledge, read by the economy AI's strategic layer). `mode` is every faction's AI mode;
 * "none" is the same map as it played before EAI2a; "develop" (EAI3a) also raises a stocked depot per faction, whose
 * strategic layer then scores its build program (no planner places yet). Types only: the bench passes the modules of the checkout it
 * measures (base or lane), the tests their static imports.
 */
export interface FactionAiFixtureModules {
  createMapScenario: typeof createMapScenario;
  createRoadNetwork: typeof createRoadNetwork;
  createSettlementSimulation: typeof createSettlementSimulation;
}

export type FactionAiFixtureMode = "develop" | "maintain" | "none";

const SIZE = 64;
const BUILD_LARGE = 4;
const WALK_COST = 10;
const TOWER = 1;
const CORNERS = [[52, 12], [12, 52], [52, 52], [32, 54]] as const;
const MIDDLE = [[30, 30], [34, 30], [30, 34], [34, 34]] as const;
/** `develop` (EAI3a): each faction's stocked depot beside its tower, so its strategic layer scores real goals. */
const DEPOTS = [[44, 12], [12, 44], [44, 52], [24, 54]] as const;
const DEPOT_KIT = { settlers: 6, stock: { axe: 2, hammer: 2, logs: 10, planks: 30, shovel: 1, stone: 20 } };
/**
 * `develop` (EAI3-accept): a small wood beside each depot (a 9×13 block, a tree every 3 cells), so
 * its woodcutters find trees in reach as on a live island; clear of the towers and the middle.
 */
const FORESTS = [[30, 6], [18, 36], [48, 36], [14, 57]] as const;
const FOREST_SIZE = [9, 13] as const;
const FOREST_STEP = 3;
const BROADLEAF_TREE = 0;
const PROP_BLOCKING = 3;

const plantForests = (world: WorldData) => {
  const cells = FORESTS.flatMap(([left, top]) => {
    const trees: [number, number][] = [];
    for (let z = top; z < Math.min(SIZE - 1, top + FOREST_SIZE[1]); z += FOREST_STEP)
      for (let x = left; x < left + FOREST_SIZE[0]; x += FOREST_STEP) trees.push([x, z]);
    return trees;
  });
  world.props = { count: cells.length, scale: new Float32Array(cells.length).fill(1),
    types: new Uint8Array(cells.length).fill(BROADLEAF_TREE), x: Float32Array.from(cells, ([x]) => x + .5),
    z: Float32Array.from(cells, ([, z]) => z + .5) } as WorldData["props"];
  for (const [x, z] of cells) world.blocking[z * SIZE + x] = PROP_BLOCKING;
};

/** A flat, open, buildable island (the authored-scenario test world). */
const flatWorld = () => ({
  blocking: new Uint8Array(SIZE * SIZE), buildClass: new Uint8Array(SIZE * SIZE).fill(BUILD_LARGE), cellsX: SIZE,
  cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), mineZone: new Uint16Array(SIZE * SIZE), mineZones: [],
  oreAmount: new Uint8Array(SIZE * SIZE),
  props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() },
  seaLevel: -1, seed: 9, start: { x: 10.5, z: 10.5 }, walkCost: new Uint8Array(SIZE * SIZE).fill(WALK_COST)
}) as unknown as WorldData;

const scenarioOf = (modules: FactionAiFixtureModules, mode: FactionAiFixtureMode): MapScenario => {
  const factions = CORNERS.map((_, index) => index + 1);
  return {
    ...modules.createMapScenario(), headquarters: { rotation: 0, x: 10, z: 10 }, kind: "colony",
    ...(mode === "none" ? {} : { factionAi: factions.map(faction => ({ faction, mode })) }),
    buildings: CORNERS.map(([x, z], index) => ({ defenders: 0, faction: index + 1,
      garrison: [{ count: 2, rank: 0, type: "archer" as const }], id: 100 + index, rotation: 0, type: TOWER, x, z })),
    units: MIDDLE.flatMap(([x, z], index) => [0, 1].map(offset => ({
      faction: index + 1, group: index, heading: 0, id: 200 + index * 2 + offset, rank: 0,
      type: offset ? "archer" as const : "shield" as const, x: x + offset, z
    })))
  };
};

/** A fresh simulation of the fixture map. */
export const createFactionAiFixture = (modules: FactionAiFixtureModules, mode: FactionAiFixtureMode) => {
  const world = flatWorld();
  if (mode === "develop") plantForests(world);
  world.scenario = scenarioOf(modules, mode);
  // Roads route round buildings, as on a live island (`island-settlement.ts`): computer sites get road links.
  let simulation: ReturnType<FactionAiFixtureModules["createSettlementSimulation"]> | undefined;
  const roads = modules.createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = modules.createSettlementSimulation({ roads, world });
  if (mode === "develop") DEPOTS.forEach(([x, z], index) => {
    const placed = simulation!.aiPlace(index + 1, { typeId: 0, x, z }, DEPOT_KIT);
    if (!placed.ok) throw new Error(`Fixture depot of faction ${index + 1}: ${placed.reason}`);
  });
  return { simulation: simulation!, world };
};
