import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/index";
import type { MilitaryDirectorPort } from "../../src/shared/settlement/commander/director-types";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../../src/shared/world/map-scenario";
import type { ScenarioFactionAi } from "../../src/shared/world/scenario-faction-ai";
import { placeFinished } from "../../tools/bench/garrison-balance-harness";
import { spawnRows } from "../../tools/bench/military-motion-scenarios";
import { huntingWorld } from "./hunting-world";

/**
 * The faction attack fixture (EAI4c, EAI4b): a camp of twelve computer soldiers (faction 1, no building) and the
 * player's Guardhouse beside the town, out of the camp's sight (the A14 intent contract's own fixture).
 */
export const ATTACK_FIXTURE_FACTION = 1;
const MAP_SIZE = 96;
const HQ_WEST = { x: 10.5, z: 48.5 };
/** A pinned game-clock start, so the discovery calendar does not follow the day the test runs. */
const CLOCK_START = Date.UTC(2026, 10, 1);
const CAMP = { x: 64, z: 48 };
const GUARDHOUSE = { typeId: 2, x: 24, z: 44 };
const CAMP_TROOPS = [...Array<"shield">(8).fill("shield"), ...Array<"archer">(4).fill("archer")];

/** As many swordsmen as the camp has soldiers, stored in a depot of the faction at the camp. */
const placeDepot = (simulation: ReturnType<typeof createSettlementSimulation>) => {
  const soldiers = [{ count: CAMP_TROOPS.length, rank: 0, type: "shield" as const }];
  const placed = simulation.aiPlace(ATTACK_FIXTURE_FACTION, { typeId: 0, ...CAMP }, { soldiers });
  if (!placed.ok) throw new Error(`Attack fixture depot: ${placed.reason}`);
};

/**
 * `entry`: the computer faction's map AI entry fields (its mode, level); `script`: the map's script; `depot`: the
 * camp's soldiers wait stored in the faction's depot there instead of standing in the field (EAI4-FOLLOWUP).
 */
export const createFactionAttackFixture = (
  entry: Omit<ScenarioFactionAi, "faction">, script?: MapScript, depot = false
) => {
  let director: MilitaryDirectorPort | undefined;
  const world = huntingWorld(MAP_SIZE);
  world.start = HQ_WEST;
  world.scenario = { ...createMapScenario(), factionAi: [{ ...entry, faction: ATTACK_FIXTURE_FACTION }],
    kind: "campaign", settlers: 0 };
  if (script) world.script = script;
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, clockStart: CLOCK_START, homeBuilding: 0, initialSettlers: 0,
    initialStock: { planks: 80, stone: 80 }, onMilitaryDirector: port => { director = port; },
    roads: createRoadNetwork(world), world
  });
  const guardhouse = placeFinished(simulation, GUARDHOUSE.typeId, GUARDHOUSE.x, GUARDHOUSE.z);
  if (depot) placeDepot(simulation);
  else spawnRows(simulation, CAMP, -1, CAMP_TROOPS, 4, .9, ATTACK_FIXTURE_FACTION);
  return { camp: CAMP, guardhouse: guardhouse.uid, simulation, strategy: () => director!.strategy };
};
