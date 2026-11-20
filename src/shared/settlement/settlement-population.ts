import {
  COLONY_POPULATION_BASE_LIMIT, POPULATION_BASE_LIMIT, POPULATION_GROWTH_SECONDS
} from "../balance/population";
import { emitSettlerBorn, retireScriptUnit } from "../script-world/script-unit-events";
import { isActiveResidence, residenceGrowthSeconds, residenceLevel, residenceLimitBonus } from "./residences";
import { releaseCorridor } from "./settlement-corridor-reservations";
import { findHomeBuilding } from "./settlement-home";
import { civilianOwnerOf, economyOwnerOf, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { clearPersonTraffic } from "./settlement-person-index";
import { contextTalents } from "./settlement-talents";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { placeNewborn } from "./settler-relocation";

/**
 * Island population (POP-01, owner 2026-10-20): people are the idle settlers in storages plus the
 * friendly person actors on duty. Both counts are kept incrementally, so a tick reads them in O(1).
 */
export interface IslandPopulation {
  /** Friendly, non-retired person actors (workers, carriers, builders, soldiers...); no mounts. */
  onDuty: number;
  /** Seconds toward the next base birth at the home building. */
  growthTime: number;
  /** Settlers born on this island; lets tests and benches balance their head counts. */
  births: number;
  /**
   * Storages whose dispatch found no idle settler there since the last birth (POP-03); transient,
   * not saved — pending work notes it again within half a second.
   */
  demand: Set<number>;
}

export const createIslandPopulation = (): IslandPopulation => ({ births: 0, demand: new Set(), growthTime: 0, onDuty: 0 });

/** A person actor starts (+1) or stops (-1) being on duty: created, retired, killed or emigrated. */
export const countOnDuty = (context: Pick<SettlementContext, "population">, delta: number) => {
  if (context.population) context.population.onDuty += delta;
};

/** Retires an on-duty person actor; the caller returns it to an idle pool when it has a storage. */
/** `scriptGone`: false when the caller already reported the person's death to the map script. */
export const retirePerson = (context: SettlementContext, actor: SettlementActor, scriptGone = true) => {
  if (scriptGone && context.script) retireScriptUnit(context, actor);
  actor.phase = "retired";
  if (!isHostileCivilian(context, actor)) countOnDuty(context, -1);
};

/** Friendly people on the island: idle settlers plus on-duty person actors. */
export const islandPeople = (context: SettlementContext) =>
  context.settlers + (context.population?.onDuty ?? 0);

/** Authored civilian staff belongs to its hostile tower, not the player recruitment pool. */
export const isHostileCivilian = (context: SettlementContext, actor: SettlementActor) => {
  if (civilianOwnerOf(actor) > 0) return true;
  if (actor.job === "Soldier") return false;
  const site = context.buildingByUid?.get(actor.building) ??
    context.buildings.find(site => site.uid === actor.building);
  return site?.enemyCatapultVariant !== undefined && ownerOf(site) > 0;
};

const isEnemySoldier = (context: SettlementContext, actor: SettlementActor) =>
  (context.military?.factionOf?.(actor.uid) ?? 0) !== 0;

/** Full recount after a load; the live count is incremental. */
export const countOnDutyPeople = (context: SettlementContext) => {
  let onDuty = 0;
  for (const actor of context.actors)
    if (actor.phase !== "retired" && actor.job !== "Mount" && !isEnemySoldier(context, actor) &&
      !isHostileCivilian(context, actor)) onDuty++;
  return onDuty;
};

/**
 * The people limit of the home's economy: the home base (the colony base on an island founded from a colony
 * harbour) plus every completed residence of the home's owner. An island without a home building (an adventure) has no
 * limit and no growth.
 */
export const populationLimit = (context: SettlementContext, home = findHomeBuilding(context)) => {
  if (!home) return undefined;
  const owner = ownerOf(home);
  let limit = home.colonyHome ? COLONY_POPULATION_BASE_LIMIT : POPULATION_BASE_LIMIT;
  for (const building of context.buildings)
    if (isActiveResidence(building, owner)) limit += residenceLimitBonus(building.typeId, residenceLevel(building));
  // Talents are the player's only (EAI1c); a computer economy's limit has none.
  const talent = owner === PLAYER_FACTION ? contextTalents(context).populationLimit : 0;
  return Math.floor(limit * (1 + talent) + 1e-9);
};

export const availableIdleSettlers = (context: SettlementContext, storage?: SettlementBuilding) => {
  if (storage) return storage.construction === 1 ? (storage.idleSettlers ?? 0) : 0;
  return context.settlers;
};

/** Idle settlers of one economy: the player's saved total, or the sum of a computer economy's storages. */
export const ownerIdleSettlers = (context: SettlementContext, owner: number) => {
  if (owner === PLAYER_FACTION) return context.settlers;
  let idle = 0;
  for (const storage of context.buildings)
    if (storage.construction === 1 && economyOwnerOf(context, storage) === owner) idle += storage.idleSettlers ?? 0;
  return idle;
};

/** A construction site of `owner` waits for its builder or leveler (bridge crews excluded). */
const awaitsBuilder = (context: SettlementContext, owner: number) => {
  for (const building of context.buildings)
    if (building.construction < 1 && building.worker === undefined && !building.bridgeSite &&
      ownerOf(building) === owner) return true;
  return false;
};

const hasCarrier = (context: SettlementContext, owner: number) => {
  for (const actor of context.actors)
    if (actor.job === "Carrier" && actor.phase !== "retired" && actor.hostileCivilianFaction === owner) return true;
  return false;
};

/** The job a computer economy recruits an idle settler for (`ownerSpareSettlers`). */
export type SettlerJobKind = "builder" | "carrier" | "worker";

/**
 * Idle settlers a job of `owner` may take. A computer economy keeps one back for each job it cannot run without
 * (EAI3c finding: its carriers and producers took every start settler, and builders then took the carriers back):
 * one for a carrier while it has none, one for a builder while one of its sites waits for one. A carrier comes
 * first: builders wait for wares only a carrier brings. The player's count is unchanged.
 */
export const ownerSpareSettlers = (context: SettlementContext, owner: number, job: SettlerJobKind) => {
  const idle = ownerIdleSettlers(context, owner);
  if (owner === PLAYER_FACTION || idle < 1) return idle;
  return idle - reservedSettlers(context, owner, job);
};

const reservedSettlers = (context: SettlementContext, owner: number, job: SettlerJobKind) => {
  const carrierMissing = !hasCarrier(context, owner);
  if (job === "builder") return carrierMissing ? 1 : 0;
  const builderMissing = awaitsBuilder(context, owner);
  if (job === "carrier") return !carrierMissing && builderMissing ? 1 : 0;
  return Number(carrierMissing) + Number(builderMissing);
};

/**
 * Whether a storage's idle settlers belong to the player's saved total (`settlers`, EAI1a D4): a computer
 * economy's people never add to it; a depot of a faction without an economy counts, as before.
 */
const inPlayerPool = (context: SettlementContext, storage: SettlementBuilding) =>
  economyOwnerOf(context, storage) === PLAYER_FACTION;

export const addIdleSettlers = (context: SettlementContext, storage: SettlementBuilding, count = 1) => {
  storage.idleSettlers = (storage.idleSettlers ?? 0) + count;
  if (inPlayerPool(context, storage)) context.settlers += count;
};

/**
 * Settlers sailing home from a campaign run (C9b, R15): they wait in the home building up to the people limit and
 * the rest are lost. Null when the island has no finished home building (they keep waiting).
 */
export const receiveReturningSettlers = (context: SettlementContext, count: number) => {
  const home = findHomeBuilding(context);
  if (!home || home.construction !== 1) return null;
  const room = Math.max(0, (populationLimit(context, home) ?? 0) - islandPeople(context));
  const stored = Math.min(Math.max(0, count), room);
  if (stored > 0) addIdleSettlers(context, home, stored);
  return { lost: Math.max(0, count) - stored, stored };
};

export const takeIdleSettler = (context: SettlementContext, storage: SettlementBuilding) => {
  if (availableIdleSettlers(context, storage) < 1) return false;
  storage.idleSettlers!--;
  if (inPlayerPool(context, storage)) context.settlers--;
  return true;
};

const bear = (context: SettlementContext, population: IslandPopulation, home: SettlementBuilding) => {
  placeNewborn(context, home);
  population.births++;
  if (context.script) emitSettlerBorn(context, home);
};

/** Advances one residence timer by `dt`; true when it bears a settler now. */
export const residenceBirthDue = (residence: SettlementBuilding, dt: number) => {
  const seconds = residenceGrowthSeconds(residence.typeId);
  residence.settlerGrowthTime = (residence.settlerGrowthTime ?? 0) + dt;
  if (residence.settlerGrowthTime + 1e-9 < seconds) return false;
  residence.settlerGrowthTime = Math.max(0, residence.settlerGrowthTime - seconds);
  return true;
};

/** Advances one residence timer; its settler is born in the home building like every other. */
const growResidence = (
  context: SettlementContext, population: IslandPopulation, home: SettlementBuilding,
  residence: SettlementBuilding, dt: number
) => {
  if (residenceBirthDue(residence, dt)) bear(context, population, home);
};

/**
 * Growth, run on the half-second schedule while people < limit: one settler per
 * POPULATION_GROWTH_SECONDS from the island timer, plus each completed residence's own timer. Every
 * birth lands in the completed home building (HQ, or a colony's harbour), then may walk on to a
 * storage in need (settler-relocation.ts). At or above the limit all
 * timers pause; nobody leaves.
 */
export const updatePopulationGrowth = (context: SettlementContext, dt: number) => {
  const population = context.population, home = findHomeBuilding(context);
  if (!population || !home || home.construction !== 1) return;
  const limit = populationLimit(context, home)!;
  if (islandPeople(context) >= limit) return;
  // The settler growth talent runs the island and residence timers faster (owner 2026-10-20).
  dt *= 1 + contextTalents(context).settlerGrowthSpeed;
  population.growthTime += dt;
  if (population.growthTime + 1e-9 >= POPULATION_GROWTH_SECONDS) {
    population.growthTime = Math.max(0, population.growthTime - POPULATION_GROWTH_SECONDS);
    bear(context, population, home);
  }
  for (const building of context.buildings) {
    if (islandPeople(context) >= limit) return;
    if (isActiveResidence(building)) growResidence(context, population, home, building, dt);
  }
};

/** Anonymous idle people are counts; only externally unreferenced retired civilian shells disappear. */
export const compactRetiredSettlers = (context: SettlementContext) => {
  const references = new Set(context.buildings.map((building) => building.worker));
  let retained = 0;
  for (const actor of context.actors) {
    const safe =
      actor.phase === "retired" &&
      !actor.visible &&
      actor.job !== "Soldier" &&
      actor.job !== "Mount" &&
      actor.navalOrder === undefined &&
      !references.has(actor.uid) &&
      !actor.ware &&
      !actor.tool &&
      !actor.delivery &&
      !actor.wareTransfer &&
      !actor.demolitionReturning &&
      !Object.values(actor.demolitionCargo ?? {}).some((count) => count > 0) &&
      !Object.values(actor.consumed ?? {}).some((count) => count > 0) &&
      !actor.target &&
      !actor.preparedTarget;
    if (!safe) context.actors[retained++] = actor;
    else releaseCorridor(context, actor.uid);
  }
  if (retained !== context.actors.length) clearPersonTraffic(context);
  context.actors.length = retained;
};
