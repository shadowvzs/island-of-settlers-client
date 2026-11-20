import {
  type ExpeditionRelief, generateAdventureWorld, generateColonyWorld
} from "../world/generation/colony-world";
import type { WorldData } from "../world/world-data";
import { type AdventureIsland,isAdventureIsland } from "./adventure-rules";
import type { ColonyIsland } from "./colony-expedition-rules";
import { colonyMineSites } from "./colony-mine-sites";
import { colonyWorldHasEconomy } from "./colony-world-economy";
import { createRoadNetwork } from "./road-network";
import type { ExpeditionIsland } from "./settlement-colony-expeditions";
import { createSettlementSimulation, type SettlementSimulation } from "./settlement-simulation";

const ATTEMPTS = 24;
const COLONY_WORLD_ERROR = "No colony island with a harbour shore and fort sites was found";
const ADVENTURE_WORLD_ERROR = "No adventure island with a landing beach and enemy camp sites was found";

/**
 * A deterministic dry run: the home (a colony harbour, or none on an adventure island) and every
 * hostile site must fit and be reachable.
 */
const hostsIsland = (
  world: WorldData, homeBuilding: 39 | null, settle: (simulation: SettlementSimulation, world: WorldData) => boolean
) => {
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  try {
    simulation = createSettlementSimulation({ homeBuilding, initialSettlers: 0, initialStock: {}, roads, world });
    return settle(simulation, world);
  } catch {
    return false;
  }
};

type GenerateCandidate = (attempt: number, relief?: ExpeditionRelief) => WorldData | null;
type Settle = (simulation: SettlementSimulation, world: WorldData) => boolean;
/** Whether a candidate world passes the dry run (it receives the candidate itself, never modifies it). */
type HostsCandidate = (world: WorldData) => boolean;

/** The dry run of `hostsIsland` on its own copy of each candidate. */
const dryRun = (homeBuilding: 39 | null, settle: Settle): HostsCandidate => world =>
  hostsIsland(structuredClone(world), homeBuilding, settle);

/**
 * D-M5: the expensive relief runs once, on the winning cheap candidate; the dry run repeats once on
 * the refined world, and the plain winner stays when the refined one fails.
 */
const refineWinner = (
  world: WorldData, attempt: number, generate: GenerateCandidate, hosts: HostsCandidate,
  relief: ExpeditionRelief | undefined
) => {
  if (!relief) return world;
  const refined = generate(attempt, relief);
  return refined && hosts(refined) ? refined : world;
};

/** The first generated candidate that passes the dry run; null when none does. */
export const findWorld = (generate: GenerateCandidate, hosts: HostsCandidate, relief?: ExpeditionRelief) => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const world = generate(attempt);
    if (!world || !hosts(world)) continue;
    return refineWinner(world, attempt, generate, hosts, relief);
  }
  return null;
};

const findColonyWorld = (island: ColonyIsland, relief?: ExpeditionRelief) => findWorld(
  (attempt, pass) => generateColonyWorld(island, attempt, pass),
  dryRun(39, (simulation, world) => simulation.startColony({ island, landed: {}, troops: [] }).ok &&
    (!island.theme || colonyWorldHasEconomy(world, simulation.home()!.access)) &&
    colonyMineSites(world, simulation.home()!, 3).length >= 3 && simulation.marbleDeposits().length > 0), relief);

const findAdventureWorld = (island: AdventureIsland, relief?: ExpeditionRelief) => findWorld(
  (attempt, pass) => generateAdventureWorld(island, attempt, pass),
  dryRun(null, simulation => simulation.startAdventure({ island, troops: [] }).ok), relief);

const orThrow = (world: WorldData | null, error: string) => {
  if (!world) throw new Error(error);
  return world;
};

/** Why an expedition's island has no world (findExpeditionWorld returned null). */
export const expeditionWorldError = (island: ExpeditionIsland) =>
  isAdventureIsland(island) ? ADVENTURE_WORLD_ERROR : COLONY_WORLD_ERROR;

/**
 * The world of a colony or adventure island, or null when no candidate hosts it. Deterministic
 * from the island, so a world worker can chart it ahead (during the voyage) for the island cache.
 * `relief` (D-M5) applies expensive passes to the winning candidate only; absent keeps it plain.
 */
export const findExpeditionWorld = (island: ExpeditionIsland, relief?: ExpeditionRelief) =>
  isAdventureIsland(island) ? findAdventureWorld(island, relief) : findColonyWorld(island, relief);

/** The island's world: the first candidate with ore, a harbour shore and room for its forts. */
export const chooseColonyWorld = (island: ColonyIsland) => orThrow(findColonyWorld(island), COLONY_WORLD_ERROR);

/** An adventure's world: a landing beach plus room for every enemy camp, far from it and reachable. */
export const chooseAdventureWorld = (island: AdventureIsland) =>
  orThrow(findAdventureWorld(island), ADVENTURE_WORLD_ERROR);
