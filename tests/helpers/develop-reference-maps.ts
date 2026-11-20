import { canWorkerEnterBuildingPlot } from "../../src/app/settlement/island-simulation-hooks";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import type { DifficultyLevel } from "../../src/shared/settlement/difficulty";
import { canLevelRoadGround } from "../../src/shared/settlement/road-ground-leveling";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import type { RoadPoint } from "../../src/shared/settlement/road-types";
import { ownerOf } from "../../src/shared/settlement/settlement-ownership";
import { TREE_TYPES } from "../../src/shared/settlement/settlement-resources";
import { createSignpostStakes } from "../../src/shared/settlement/settlement-road-strip-placement";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { WOODCUTTER_TYPE_ID } from "../../src/shared/settlement/building-type-ids";
import { DEFAULT_WORLD_OPTIONS, type WorldOptions } from "../../src/shared/world/generation/generate-world";
import type { ScenarioFactionAi } from "../../src/shared/world/scenario-faction-ai";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";
import { placeFinished } from "../../tools/bench/garrison-balance-harness";
import { cachedWorld } from "./cached-worlds";
import { economyCampaignScenario } from "./economy-factions";

/**
 * The P3 reference maps (enemy economy AI plan §7 P3 functional gate): three generated 160² islands, each with one
 * `develop` faction whose stocked depot stands on the clearest level ground at least `DEPOT_MIN_DISTANCE` cells from
 * the player's headquarters with a forest in reach, where its flag can lay roads (as a map maker would
 * place it: not in a thicket, not on a barren corner). Fixed seeds:
 * the depot search is deterministic, so every run plays the same map.
 */
export const DEVELOP_REFERENCE_MAPS = [
  { name: "flat", options: { landform: "island", mountains: 0, seed: 1234 } },
  { name: "coastal", options: { landform: "archipelago", seed: 31 } },
  { name: "hilly", options: { mountains: 2, seed: 8080 } }
] as const satisfies readonly { name: string; options: Partial<WorldOptions> }[];

export type DevelopReferenceMap = typeof DEVELOP_REFERENCE_MAPS[number];

export const REFERENCE_AI = 2;
/**
 * The start kit: ten settlers, the tools a builder, leveler, woodcutter, carpenter and quarry need, and the
 * construction wares of every nation's first goals (the Indigenous woodcutter takes cloth, as the player's
 * Indigenous start stock carries it).
 */
export const REFERENCE_KIT = {
  settlers: 10,
  stock: { axe: 3, cloth: 16, hammer: 3, logs: 12, pickaxe: 2, planks: 40, saw: 1, shovel: 2, stone: 30 }
};

const MAP_SIDE = 160;
const DEPOT_MIN_DISTANCE = 40;
const CLEAR_RADIUS = 10;
/** Spots keep this far from the map border: the faction's territory needs room on every side. */
const EDGE_MARGIN = 24;
const SPOT_STEP = 2;
const SPOT_TRIES = 40;
const MIN_CLEAR_CELLS = 120;
const RESOURCE_REACH = 22;
const MIN_TREES = 15;
/** Tried spots keep this far apart, so one steep clearing does not use up every try. */
const SPOT_SPACING = 12;
/** Road probes from the depot's flag; the depot is kept when at least `ROAD_PROBES_NEEDED` can be planned. */
const ROAD_PROBES = [[-8, 0], [8, 0], [0, 8], [-6, -14], [6, -14]] as const;
const ROAD_PROBES_NEEDED = 3;

/** The map's settings of the faction beside its `develop` mode (EAI5a: style, level, bonus). */
export type ReferenceAiSetting = Partial<Pick<ScenarioFactionAi, "bonus" | "level" | "style">>;

const worldOf = (map: DevelopReferenceMap, setting: ReferenceAiSetting = {}) => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: MAP_SIDE, cellsZ: MAP_SIDE, erosionDroplets: 2000,
    ...map.options });
  const scenario = economyCampaignScenario([REFERENCE_AI], "develop");
  world.scenario = { ...scenario, factionAi: scenario.factionAi!.map(entry => ({ ...entry, ...setting })) };
  return world;
};

/**
 * A simulation with the live island's road rules (graded roads, signpost strips) and stock contacts; `difficulty`
 * is the global difficulty (absent: Normal).
 */
export const createReferenceSimulation = (world: WorldData, difficulty?: DifficultyLevel) => {
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const buildings = () => simulation?.buildings() ?? [];
  const isOccupied = (x: number, z: number) => simulation?.isOccupied(x, z) ?? false;
  const signposts = createSignpostStakes(world, buildings);
  const roads = createRoadNetwork(world, { isBlocked: isOccupied, isStripReserved: signposts.isStripReserved,
    validateGradedRoads: (planned, existing) => canLevelRoadGround(world, planned, existing, buildings()) });
  const nationOf = (building: SettlementBuilding) => simulation?.buildingNation(building);
  simulation = createSettlementSimulation({ difficulty, homeBuilding: 0, roads, world,
    canWorkerEnterPlot: (building, point) => canWorkerEnterBuildingPlot(building, point, nationOf(building)),
    stockContact: createIslandStockContacts(world, isOccupied, nationOf) });
  return { roads, simulation };
};

const isClearCell = (world: WorldData, cell: number) =>
  world.buildCap[cell]! >= BUILD.large && !world.blocking[cell] && !world.slopeClass[cell] && !world.waterDepth[cell];

/** Clear level cells in the square round (x, z); -1 when it leaves the map. */
const clearCellsAround = (world: WorldData, x: number, z: number) => {
  if (Math.min(x, z) < CLEAR_RADIUS || Math.max(x, z) >= MAP_SIDE - CLEAR_RADIUS) return -1;
  let clear = 0;
  for (let row = z - CLEAR_RADIUS; row <= z + CLEAR_RADIUS; row++)
    for (let column = x - CLEAR_RADIUS; column <= x + CLEAR_RADIUS; column++)
      if (isClearCell(world, row * MAP_SIDE + column)) clear++;
  return clear;
};

/** Trees within `RESOURCE_REACH` of (x, z). */
const treesAround = (world: WorldData, x: number, z: number) => {
  let trees = 0;
  for (let prop = 0; prop < world.props.count; prop++)
    if (TREE_TYPES.has(world.props.types[prop]!) && Math.abs(world.props.x[prop]! - x) <= RESOURCE_REACH &&
      Math.abs(world.props.z[prop]! - z) <= RESOURCE_REACH) trees++;
  return trees;
};

/**
 * Spots with room and a forest in reach (its woodcutters find work), clearest first. Large rocks are rare on
 * generated islands (3-6 per map), so the quarry is not part of the gate.
 */
const depotSpots = (world: WorldData, home: RoadPoint) => {
  const spots: { clear: number; x: number; z: number }[] = [];
  for (let z = EDGE_MARGIN; z < MAP_SIDE - EDGE_MARGIN; z += SPOT_STEP)
    for (let x = EDGE_MARGIN; x < MAP_SIDE - EDGE_MARGIN; x += SPOT_STEP) {
    if (Math.hypot(x - home.x, z - home.z) < DEPOT_MIN_DISTANCE) continue;
    const clear = clearCellsAround(world, x, z);
    if (clear < MIN_CLEAR_CELLS) continue;
    if (treesAround(world, x, z) >= MIN_TREES) spots.push({ clear, x, z });
    }
  return spots.sort((first, second) => second.clear - first.clear || first.z - second.z || first.x - second.x);
};

const roadsReach = (island: ReturnType<typeof createReferenceSimulation>) => {
  const depot = island.simulation.buildings().find(building => ownerOf(building) === REFERENCE_AI)!;
  const flag = depot.access;
  const reached = ROAD_PROBES.filter(([dx, dz]) =>
    island.roads.planRoad?.({ x: flag.x + dx, z: flag.z + dz }, flag)).length;
  return reached >= ROAD_PROBES_NEEDED;
};

/** The reference map's depot cell: the clearest spot whose depot the rules accept and whose flag reaches out. */
const findDepot = (map: DevelopReferenceMap) => {
  const probe = createReferenceSimulation(worldOf(map));
  const tried: { x: number; z: number }[] = [];
  for (const { x, z } of depotSpots(worldOf(map), probe.simulation.home()!)) {
    if (tried.length === SPOT_TRIES) break;
    if (tried.some(spot => Math.hypot(spot.x - x, spot.z - z) < SPOT_SPACING)) continue;
    tried.push({ x, z });
    const island = createReferenceSimulation(worldOf(map));
    if (island.simulation.aiPlace(REFERENCE_AI, { typeId: 0, x, z }, REFERENCE_KIT).ok && roadsReach(island))
      return { x, z };
  }
  throw new Error(`Reference map ${map.name}: no depot spot`);
};

const depots = new Map<string, { x: number; z: number }>();

/**
 * A fresh island of the reference map: the world, the player's headquarters and the faction's stocked depot. The
 * world is the island's own copy (construction levels its ground and fells its trees), as a game save keeps it.
 * `setting` gives the faction a style, level or bonus and `difficulty` the global difficulty (the depot spot does not
 * depend on them).
 */
export const createDevelopReferenceIsland = (
  map: DevelopReferenceMap, setting?: ReferenceAiSetting, difficulty?: DifficultyLevel
) => {
  let depot = depots.get(map.name);
  if (!depot) depots.set(map.name, depot = findDepot(map));
  const world = worldOf(map, setting);
  const { simulation } = createReferenceSimulation(world, difficulty);
  const placed = simulation.aiPlace(REFERENCE_AI, { typeId: 0, ...depot }, REFERENCE_KIT);
  if (!placed.ok) throw new Error(`Reference map ${map.name}: ${placed.reason}`);
  return { depot, simulation, world };
};

export type DevelopReferenceSimulation = ReturnType<typeof createDevelopReferenceIsland>["simulation"];

/** Ring offsets (cells) tried round the player's headquarters for the idle player's site, nearest first. */
const IDLE_SITE_RINGS = [6, 8, 10, 12, 14];
const IDLE_SITE_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;

/**
 * An idle player's one finished building, a woodcutter beside the headquarters (EAI-CLOSE): the headquarters itself is
 * never a target (raid tier list, owner Q-BD1), so a player who owns nothing else gives the AI nothing to attack.
 */
export const placeIdlePlayerSite = (simulation: DevelopReferenceSimulation) => {
  const home = simulation.home()!;
  for (const ring of IDLE_SITE_RINGS) for (const [dx, dz] of IDLE_SITE_DIRECTIONS) {
    const x = Math.floor(home.x + dx * ring), z = Math.floor(home.z + dz * ring);
    // `placeFinished` throws on a refused plot: try the next one.
    try { return placeFinished(simulation, WOODCUTTER_TYPE_ID, x, z); } catch { continue; }
  }
  throw new Error("Reference map: no plot for the idle player's woodcutter");
};
