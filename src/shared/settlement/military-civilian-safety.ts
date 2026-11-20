import { BuildingType } from "./building-type-ids";
import { isFisherBoatAfloat } from "./fisher-boat-trip";
import { fleesRaiders, isHeldCrew, releaseCrew } from "./military-civilian-crews";
import { getBuilding } from "./settlement-building-index";
import { releaseCorridor } from "./settlement-corridor-reservations";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { isDoorEntryPhase, isInOwnDoorPassage } from "./settlement-entrance";
import type { SettlementSoldier } from "./settlement-military";
import { PLAYER_FACTION } from "./settlement-ownership";
import { isFreeCivilian, releasePersonWork } from "./settlement-person-release";
import { clearWareTransfer } from "./settlement-stock-transfers";
import { clearTrafficBlocker } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Civilian safety radius (owner 2026-11-09, tiles): while a computer soldier stands this close to a
 * building's door its civilians stay inside, and a civilian outside with one this close flees.
 */
export const CIVILIAN_THREAT_RADIUS = 8;
/** Long refuge route searches allowed per tick on the whole island (the rest wait a moment). */
const REFUGE_SEARCHES_PER_TICK = 1;

/** The read-only threat view the economy asks (installed on the context by the combat layer). */
export interface CivilianThreat {
  /** A computer soldier stands in the field this tick (otherwise nothing is threatened). */
  active: () => boolean;
  /** A computer soldier stands within the radius of the building's door. */
  doorThreatened: (building: SettlementBuilding) => boolean;
  /** The building's walls are down (HP 0, BD1): it is destroyed, whatever still stands of it. */
  fallen: (building: SettlementBuilding) => boolean;
  /**
   * No refuge for fleeing or displaced people (plan review B11): raiders at its door, raiders besieging
   * it, or walls already down.
   */
  unsafeRefuge: (building: SettlementBuilding) => boolean;
  /** Whether a computer soldier stands within `radius` of the point. */
  enemyWithin: (point: SettlementPoint, radius: number) => boolean;
  /**
   * The computer side's view (EAI2b): whether a soldier hostile to `faction` that the faction knows (A13: seen or
   * alerted) stands within `radius` of the point.
   */
  factionEnemyWithin: (faction: number, point: SettlementPoint, radius: number) => boolean;
  /** The nearest computer soldier within `radius` of the point. */
  nearestEnemy: (point: SettlementPoint, radius: number) => SettlementPoint | undefined;
  /** A visible free civilian with a computer soldier within the radius (it should flee). */
  threatens: (actor: SettlementActor) => boolean;
  /** Takes one of this tick's refuge route searches; false when they are used up. */
  takeRefugeSearch: () => boolean;
}

interface ThreatSources {
  /** Whether a computer soldier besieges the building (its siege order points at it). */
  besieged: (uid: number) => boolean;
  /** Whether any computer soldier stands within `radius` of the point. */
  enemyWithin: (point: SettlementPoint, radius: number) => boolean;
  /** A soldier hostile to `faction` and known to it within `radius` of the point (absent: never). */
  factionEnemyWithin?: (faction: number, point: SettlementPoint, radius: number) => boolean;
  /** Whether a computer soldier is in the field at all this tick (no enemy: every query is false). */
  hostilePresent: () => boolean;
  nearestEnemy: (point: SettlementPoint, radius: number) => SettlementPoint | undefined;
  /** Whether the building's walls stand (no structure, or HP above 0). */
  standing: (uid: number) => boolean;
}

/**
 * The per-tick threat view over the combat layer's soldier grid. Door answers are cached per
 * building for the tick; with no computer soldier in the field nothing is ever threatened, so
 * islands without enemies behave exactly as before.
 */
const NO_FACTION_ENEMY = () => false;

export const createCivilianThreat = ({
  besieged, enemyWithin, factionEnemyWithin = NO_FACTION_ENEMY, hostilePresent, nearestEnemy, standing
}: ThreatSources) => {
  const doors = new Map<number, boolean>();
  let present = false, searches = 0;
  const doorThreatened = (building: SettlementBuilding) => {
    if (!present) return false;
    const cached = doors.get(building.uid);
    if (cached !== undefined) return cached;
    const threatened = enemyWithin(building.doorThreshold ?? building.access, CIVILIAN_THREAT_RADIUS);
    doors.set(building.uid, threatened);
    return threatened;
  };
  const fallen = (building: SettlementBuilding) => !standing(building.uid);
  const threat: CivilianThreat = {
    active: () => present,
    doorThreatened,
    fallen,
    enemyWithin: (point, radius) => present && enemyWithin(point, radius),
    factionEnemyWithin,
    nearestEnemy: (point, radius) => present ? nearestEnemy(point, radius) : undefined,
    threatens: actor => present && fleesRaiders(actor) && enemyWithin(actor, CIVILIAN_THREAT_RADIUS),
    takeRefugeSearch: () => searches-- > 0,
    unsafeRefuge: building => fallen(building) || (present && (doorThreatened(building) || besieged(building.uid)))
  };
  return {
    beginTick: () => { doors.clear(); present = hostilePresent(); searches = REFUGE_SEARCHES_PER_TICK; },
    threat
  };
};

/**
 * Buildings a computer soldier besieges (its siege order points at them), gathered at most once per tick on
 * the first refuge question, so islands without raiders never walk their soldiers for it.
 */
export const createBesiegedIndex = (soldiers: ReadonlyMap<number, SettlementSoldier>) => {
  const sites = new Set<number>();
  let fresh = false;
  const besieged = (uid: number) => {
    if (!fresh) {
      sites.clear();
      for (const soldier of soldiers.values())
        if ((soldier.combat?.faction ?? 0) > 0 && soldier.combat?.siege !== undefined) sites.add(soldier.combat.siege);
      fresh = true;
    }
    return sites.has(uid);
  };
  return { beginTick: () => { fresh = false; }, besieged };
};

/**
 * Enemies within the civilian threat radius of a point, in `owner`'s view: the player's raider view, or for a
 * computer economy the enemy soldiers it knows (EAI2b; A13 seen or alerted, never an unseen read).
 */
export const ownerThreatenedAt = (
  context: Pick<SettlementContext, "civilianThreat">, owner: number, point: SettlementPoint
) => {
  const threat = context.civilianThreat;
  if (!threat) return false;
  if (owner === PLAYER_FACTION) return threat.enemyWithin(point, CIVILIAN_THREAT_RADIUS);
  return threat.factionEnemyWithin(owner, point, CIVILIAN_THREAT_RADIUS);
};

/** A civilian (or a crew member, MIL-CREWS) inside a building waits while an enemy stands near its door. */
export const civilianHeldInside = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding | undefined
) => Boolean(building && context.civilianThreat?.doorThreatened(building) &&
  (isFreeCivilian(actor) && actor.job !== "Commander" || isHeldCrew(actor)));

/**
 * A threatened civilian drops its work (claims released, workplace free to hire again once it is
 * safe) and runs for a storage with the cargo and tool it holds, as a displaced crew does: the
 * demolition return walks it to the nearest storage whose door is safe and stores everything there.
 */
export const startCivilianFlight = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.demolitionReturning || isFisherBoatAfloat(actor) || !context.civilianThreat?.threatens(actor)) return false;
  // Already walking in through a door: it finishes entering and the door hold keeps it inside. Put
  // to flight on a storage threshold, a carrier found no route out of the plot and blocked that
  // door's entry lane for minutes (HQ-DOOR-JAM, mixed fixture: 0 entries, 26 queued in 180 s).
  if (actor.visible && isDoorEntryPhase(actor.phase) && isInOwnDoorPassage(context, actor)) return false;
  // Catapult Tower staff keep their own threat rule (they withdraw into the tower).
  if (getBuilding(context, actor.building)?.typeId === BuildingType.Catapult) return false;
  // The cart stops (its load stays on the bed), a led horse is let go, the voyage forgets the person.
  releaseCrew(context, actor, true);
  leaveStorageArrival(context, actor);
  releasePersonWork(context, actor);
  clearWareTransfer(actor);
  releaseCorridor(context, actor.uid);
  clearTrafficBlocker(actor);
  Object.assign(actor, { action: "idle", demolitionReturning: true, timer: 0, navigationRecovery: undefined, path: [],
    pathIndex: 0, phase: "demolitionBlocked", queueTarget: undefined, queueWait: 0, stockBuilding: undefined,
    stockContact: undefined });
  return true;
};
