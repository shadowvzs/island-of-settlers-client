import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { FactionAiStyle } from "../../src/shared/world/scenario-faction-ai";
import { BLOCKING, ORE, PROP, type WorldData } from "../../src/shared/world/world-data";
import { economyCampaignScenario } from "./economy-factions";
import { huntingWorld } from "./hunting-world";

/**
 * The P4 military fixture (enemy economy AI plan §7 P4, lane EAI4a): a flat 160² island whose `develop` faction
 * (`MILITARY_AI`) starts from a stocked depot far from the player's headquarters, with forest belts beside it, a few
 * large rocks for its quarry and an iron deposit near its border. Generated islands put iron 50-65 cells from their
 * depot spots and seal small territories with single trees, so the whole chain is tested on authored ground; the
 * reference maps keep testing the P3 economy.
 */
export const MILITARY_AI = 2;
export const MILITARY_DEPOT = { typeId: 0, x: 110, z: 110 };
const SIZE = 160;
const FORESTS = [{ maxX: 150, maxZ: 135, minX: 128, minZ: 88 }, { maxX: 100, maxZ: 150, minX: 84, minZ: 130 }];
const TREE_STEP = 3;
const ROCKS = [[96, 104], [99, 118], [124, 120]] as const;
const IRON = { maxX: 116, maxZ: 80, minX: 108, minZ: 72 };
const ORE_AMOUNT = 200;
const IRON_ZONE = 1;

/** The start kit of a whole military economy: settlers, every chain worker's tool, wares, food and two soldiers. */
export const MILITARY_KIT = {
  settlers: 30,
  soldiers: [{ count: 2, rank: 0, type: "shield" as const }],
  stock: {
    axe: 4, bread: 20, cleaver: 2, cloth: 30, crucible: 2, fish: 30, hammer: 6, logs: 30, pickaxe: 4, planks: 220,
    rollingPin: 2, saw: 4, scythe: 3, shovel: 4, stone: 180, tongs: 3
  }
};

const addProp = (world: WorldData, type: number, x: number, z: number) => {
  const index = world.props.count++;
  world.props.types[index] = type;
  world.props.x[index] = x + .5;
  world.props.z[index] = z + .5;
  world.props.scale[index] = 1;
  world.blocking[z * world.cellsX + x] = BLOCKING.prop;
};

const plantForests = (world: WorldData) => {
  for (const { maxX, maxZ, minX, minZ } of FORESTS)
    for (let z = minZ; z <= maxZ; z += TREE_STEP)
      for (let x = minX; x <= maxX; x += TREE_STEP) addProp(world, PROP.broadleafTree, x, z);
};

/** One iron zone: every cell holds ore, the zone record its mean cell. */
const placeIron = (world: WorldData) => {
  const { maxX, maxZ, minX, minZ } = IRON;
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    world.mineZone[z * world.cellsX + x] = IRON_ZONE;
    world.oreAmount[z * world.cellsX + x] = ORE_AMOUNT;
  }
  world.mineZones = [{ cellCount: (maxX - minX + 1) * (maxZ - minZ + 1), centreX: (minX + maxX + 1) / 2,
    centreZ: (minZ + maxZ + 1) / 2, id: IRON_ZONE, ore: ORE.iron, richness: 1, surveyed: false }];
};

export const militaryIslandWorld = (style?: FactionAiStyle) => {
  const world = huntingWorld(SIZE);
  // Dry land everywhere: the game's worker navigation reads the generated base world's water.
  world.waterDepth.fill(0);
  world.mineZone.fill(0);
  world.oreAmount.fill(0);
  plantForests(world);
  for (const [x, z] of ROCKS) addProp(world, PROP.largeRock, x, z);
  placeIron(world);
  const scenario = economyCampaignScenario([MILITARY_AI], "develop");
  world.scenario = style ? { ...scenario, factionAi: [{ ...scenario.factionAi![0]!, style }] } : scenario;
  return world;
};

/** A simulation of `world` whose roads route round buildings, as on a live island. */
export const createMilitarySimulation = (world: WorldData) => {
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads, world });
  return simulation;
};

export type MilitarySimulation = ReturnType<typeof createMilitarySimulation>;

/** A fresh military island with the faction's stocked depot; `style` absent: the map names none (balanced). */
export const createMilitaryIsland = (style?: FactionAiStyle) => {
  const world = militaryIslandWorld(style);
  const simulation = createMilitarySimulation(world);
  const placed = simulation.aiPlace(MILITARY_AI, MILITARY_DEPOT, MILITARY_KIT);
  if (!placed.ok) throw new Error(`Military island depot: ${placed.reason}`);
  return { simulation, world };
};
