import { shipDeckCapacity } from "@shared/catalog";

import { TROOP_DECK_SLOTS } from "../balance/colonies";
import { DMath } from "../math/deterministic-math";
import {
  TROOP_GANGWAY_BOARDING_PHASES, TROOP_GANGWAY_FILE, TROOP_GANGWAY_REACH, TROOP_GANGWAY_WALK_PHASES,
  TROOP_HARBOUR_BOARDING_PHASES, TROOP_MISSION_NAVAL_ORDER, TROOP_RETURNING_PHASES, TROOP_SHIP_HORSE_DECK_PLACES,
  TROOP_SHIP_MAX_PASSENGERS
} from "./constants";
import { reserveReachesHarbour } from "./naval-passenger-eligibility";
import { type AdventureLanding, gatherSlot } from "./settlement-adventure-landing";
import { findHarbourDock } from "./settlement-harbour-docks";
import { NO_BUILDING } from "./settlement-home";
import { landmassAt } from "./settlement-landmass-index";
import type { NavalPassengerHooks, NavalShip } from "./settlement-naval-fleet";
import { groundPath, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { commanderPierWaitingPoint, isFieldCommander } from "./ship-troop-commander";
import { bringsHorseAboard, leadHorseAboard } from "./ship-troop-horse";

/** Where soldiers board a troop ship: over a harbour's pier, or up an anchored ship's gangway. */
export type TroopBoardingSite = { harbour: SettlementBuilding } | { anchor: AdventureLanding };

/** Soldiers that fit aboard (nearest the boarding point first) and those left ashore, with the slots still free. */
export interface TroopBoardingPlan { boarding: number[]; capacityLeft: number; waiting: number[] }

const actorOf = (context: SettlementContext, uid: number) => context.actors.find(actor => actor.uid === uid);
/** Deck places a soldier takes: a rider two; the commander his own and his horse's (it comes aboard with him). */
const deckSlotsOf = (context: SettlementContext, uid: number) => bringsHorseAboard(context, uid)
  ? 1 + TROOP_SHIP_HORSE_DECK_PLACES : TROOP_DECK_SLOTS[context.military?.troopType?.(uid) ?? "shield"];
const combatOf = (context: SettlementContext, uid: number) => context.military?.soldierOf?.(uid)?.combat;

export const boardingPoint = (site: TroopBoardingSite): SettlementPoint =>
  "harbour" in site ? site.harbour.access : site.anchor.gangway.shore;

/**
 * Where soldiers left ashore by a full ship wait: the harbour door, or a gathering place inland of the gangway
 * foot after the boarders' places (2026-11-17: the foot and the way up it stay clear).
 */
export const waitingPoint = (context: SettlementContext, site: TroopBoardingSite, index: number): SettlementPoint =>
  "harbour" in site ? site.harbour.access : gatherSlot(context, site.anchor.gangway.shore, index);

/** Deck slots (a rider two, the commander six) still free aboard, counting the soldiers walking to the ship. */
export const troopShipCapacityLeft = (context: SettlementContext, ship: NavalShip) => {
  const held = [...ship.passengers ?? [], ...ship.troopMission?.boarding ?? []];
  return shipDeckCapacity().passengers - held.reduce((sum, uid) => sum + deckSlotsOf(context, uid), 0);
};

/**
 * An own soldier free to take ship: no voyage holds it, not the commander (his own expedition transport and the
 * colony pickup leave him out; from the field he boards troop ships through `isFieldCommander`).
 */
export const isFreeOwnSoldier = (context: SettlementContext, actor: SettlementActor) =>
  actor.job === "Soldier" && actor.navalOrder === undefined && context.military?.factionOf?.(actor.uid) === 0 &&
  !(context.commander?.isCommanderActor(actor.uid) ?? false);

/** A stored or field soldier that can be sent into a harbour (garrisons and voyages excluded). */
export const canWalkToHarbour = (context: SettlementContext, actor: SettlementActor) =>
  isFreeOwnSoldier(context, actor) && TROOP_HARBOUR_BOARDING_PHASES.includes(actor.phase);

const sameLand = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) =>
  landmassAt(context.options.world, from) === landmassAt(context.options.world, to);

/**
 * Whether `actor` may be ordered aboard at `site` (a stored soldier only at a harbour its storage reaches; the
 * commander mounted from the field, at a harbour pier or a gangway on his landmass).
 */
const canBoardAt = (context: SettlementContext, actor: SettlementActor, site: TroopBoardingSite) => {
  if (isFieldCommander(context, actor)) return sameLand(context, actor, boardingPoint(site));
  if (!isFreeOwnSoldier(context, actor)) return false;
  if ("harbour" in site) {
    if (!canWalkToHarbour(context, actor)) return false;
    return actor.phase === "militaryReserve" ? reserveReachesHarbour(context, actor, site.harbour)
      : sameLand(context, actor, site.harbour.access);
  }
  return TROOP_GANGWAY_BOARDING_PHASES.includes(actor.phase) && !combatOf(context, actor.uid)?.dismounted &&
    sameLand(context, actor, site.anchor.gangway.shore);
};

/**
 * Who boards (owner 2026-11-13): eligible soldiers nearest the boarding point first until the deck is full; a
 * rider that no longer fits is passed over for a foot soldier that does. Nobody else is called: the rest wait.
 */
export const planTroopBoarding = (context: SettlementContext, ship: NavalShip, site: TroopBoardingSite,
  ids: readonly number[]): TroopBoardingPlan => {
  const point = boardingPoint(site);
  const distance = (actor: SettlementActor) => DMath.hypot(actor.x - point.x, actor.z - point.z);
  const candidates = [...new Set(ids)].flatMap(uid => actorOf(context, uid) ?? [])
    .filter(actor => canBoardAt(context, actor, site))
    .sort((a, b) => distance(a) - distance(b) || a.uid - b.uid);
  let capacityLeft = troopShipCapacityLeft(context, ship);
  let seats = TROOP_SHIP_MAX_PASSENGERS - (ship.passengers?.length ?? 0) - (ship.troopMission?.boarding.length ?? 0);
  const boarding: number[] = [], waiting: number[] = [];
  for (const actor of candidates) {
    const slots = deckSlotsOf(context, actor.uid);
    if (slots > capacityLeft || seats < 1) { waiting.push(actor.uid); continue; }
    boarding.push(actor.uid);
    capacityLeft -= slots;
    seats--;
  }
  return { boarding, capacityLeft, waiting };
};

const addPassenger = (ship: NavalShip, uid: number) => {
  ship.passengers = [...ship.passengers ?? [], uid];
  ship.cargoCount++;
};

/** A stored soldier at (or reaching) the harbour is held for the ship; it then walks aboard over the pier. */
const holdForPier = (ship: NavalShip, harbour: SettlementBuilding, uid: number, hooks?: NavalPassengerHooks) => {
  if (!hooks?.reserveTroops?.([uid], harbour)?.length) return false;
  addPassenger(ship, uid);
  return true;
};

/**
 * Stored soldiers are held at once; field soldiers go into the harbour first; the commander rides to his waiting
 * place beside it (he boards over the pier from there, leading his horse). Returns the accepted ids.
 */
export const startHarbourBoarding = (context: SettlementContext, ship: NavalShip, harbour: SettlementBuilding,
  ids: readonly number[], hooks?: NavalPassengerHooks) => ids.filter(uid => {
  if (bringsHorseAboard(context, uid)) {
    const ordered = context.military?.commandSoldiers?.([uid], commanderPierWaitingPoint(context, harbour), "move");
    if (ordered) ship.troopMission!.boarding.push(uid);
    return Boolean(ordered);
  }
  if (actorOf(context, uid)?.phase === "militaryReserve") return holdForPier(ship, harbour, uid, hooks);
  if (!context.military?.returnToStorage?.([uid], harbour.uid)) return false;
  ship.troopMission!.boarding.push(uid);
  return true;
});

/**
 * Field soldiers march to their own waiting places inland of the gangway foot (the landing's gathering places,
 * which keep the foot and the way up it clear) and wait there for the ship. Returns the accepted ids.
 */
export const startGangwayBoarding = (context: SettlementContext, ship: NavalShip, anchor: AdventureLanding,
  ids: readonly number[]) => {
  const mission = ship.troopMission!, first = mission.boarding.length;
  const accepted = ids.filter((uid, index) => context.military?.commandSoldiers?.([uid],
    gatherSlot(context, anchor.gangway.shore, first + index), "move"));
  mission.boarding.push(...accepted);
  return accepted;
};

/** A soldier on its way into the harbour the ship lies at (still bound for it, not diverted by a new order). */
const boundForHarbour = (context: SettlementContext, actor: SettlementActor, harbourUid: number) =>
  TROOP_RETURNING_PHASES.includes(actor.phase) &&
  (actor.home === harbourUid || combatOf(context, actor.uid)?.returnStorageUid === harbourUid);

/**
 * Soldiers arrived inside the harbour are held for the ship; diverted or lost ones leave the boarding. The
 * commander stays in it while he rides to (or waits at) his place beside the harbour.
 */
export const collectHarbourArrivals = (context: SettlementContext, ship: NavalShip, harbour: SettlementBuilding,
  hooks?: NavalPassengerHooks) => {
  const mission = ship.troopMission!;
  mission.boarding = mission.boarding.filter(uid => {
    const actor = actorOf(context, uid);
    if (!actor) return false;
    if (bringsHorseAboard(context, uid))
      return isFieldCommander(context, actor) && headingFor(context, actor, commanderPierWaitingPoint(context, harbour));
    if (actor.phase === "militaryReserve" && actor.home === harbour.uid && actor.navalOrder === undefined) {
      holdForPier(ship, harbour, uid, hooks);
      return false;
    }
    return boundForHarbour(context, actor, harbour.uid);
  });
};

/**
 * One tick at the harbour pier: arrivals are held for the ship, then everyone held walks aboard two at a time
 * (the ordinary passenger passage). True once nobody is on the way and every passenger is aboard.
 */
export const advanceHarbourBoarding = (context: SettlementContext, ship: NavalShip, harbour: SettlementBuilding,
  hooks?: NavalPassengerHooks) => {
  collectHarbourArrivals(context, ship, harbour, hooks);
  stepCommanderOntoPier(context, ship, harbour);
  const loaded = hooks?.loadTroopPassengers ? hooks.loadTroopPassengers(ship) : allAboard(context, ship);
  return loaded && !ship.troopMission!.boarding.length && allAboard(context, ship);
};

/** Still on its way to `point` (an order elsewhere takes it out of the boarding). */
const headingFor = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) => {
  const state = combatOf(context, actor.uid);
  if (!state || !TROOP_GANGWAY_BOARDING_PHASES.includes(actor.phase)) return false;
  const near = DMath.hypot(actor.x - point.x, actor.z - point.z) <= TROOP_GANGWAY_REACH;
  if (state.destination)
    return DMath.hypot(state.destination.x - point.x, state.destination.z - point.z) <= TROOP_GANGWAY_REACH;
  return near || state.target !== undefined || state.pendingRoute !== undefined;
};

/**
 * The soldier leaves the field and walks to `shore` (the gangway foot or the pier's land end), then up as a
 * passenger; the commander gets down there and leads his horse after him.
 */
const stepToShip = (context: SettlementContext, ship: NavalShip, actor: SettlementActor, shore: SettlementPoint,
  building = NO_BUILDING) => {
  if (bringsHorseAboard(context, actor.uid)) leadHorseAboard(context, actor);
  Object.assign(actor, { building, home: building, mounted: false, navalOrder: TROOP_MISSION_NAVAL_ORDER });
  setActorPath(actor, groundPath(context, actor, shore) ?? [{ x: shore.x, z: shore.z }], "navalToShip");
  addPassenger(ship, actor.uid);
};

/** People on their way up (to `ship`'s deck); the commander leading his horse fills the whole file. */
const passageLoad = (context: SettlementContext, ship: NavalShip) => (ship.passengers ?? []).reduce((sum, uid) =>
  TROOP_GANGWAY_WALK_PHASES.has(actorOf(context, uid)?.phase ?? "")
    ? sum + (bringsHorseAboard(context, uid) ? TROOP_GANGWAY_FILE : 1) : sum, 0);

/**
 * At a harbour pier the commander (waiting mounted beside the harbour, not fighting) steps onto the passage when
 * the ship lies at its berth and nobody else is on it; he leads his horse along the pier and up the gangway.
 */
const stepCommanderOntoPier = (context: SettlementContext, ship: NavalShip, harbour: SettlementBuilding) => {
  const mission = ship.troopMission!, uid = mission.boarding.find(id => bringsHorseAboard(context, id));
  const actor = uid === undefined ? undefined : actorOf(context, uid);
  if (!actor || ship.phase !== "loading" || !readyAt(context, actor, commanderPierWaitingPoint(context, harbour)))
    return;
  const onPassage = context.actors.some(other => other.building === harbour.uid && other.navalOrder !== undefined &&
    other.visible && ["navalToShip", "navalBoarding", "navalDeckWalk"].includes(other.phase));
  const dock = findHarbourDock(context, harbour.uid, ship);
  if (onPassage || !dock?.workPier || !context.military?.leaveFieldForShip?.(actor.uid)) return;
  stepToShip(context, ship, actor, dock.workPier.shore, harbour.uid);
  mission.boarding = mission.boarding.filter(id => id !== actor.uid);
};

/**
 * A waiting soldier ready to step onto the ship's passage: near `point`, standing in the field, not fighting; the
 * commander back on his horse (he may lead it on foot where a horse cannot be ridden on the way there).
 */
const readyAt = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  DMath.hypot(actor.x - point.x, actor.z - point.z) <= TROOP_GANGWAY_REACH && actor.phase === "militaryField" &&
  combatOf(context, actor.uid)?.target === undefined &&
  (actor.mounted === true || !bringsHorseAboard(context, actor.uid));

/**
 * One tick at an anchored ship (re-boarding, owner 2026-11-13): soldiers that reached the gangway foot and are
 * not fighting walk aboard, two at a time, the nearest the foot first (owner 2026-11-17). True once nobody is on
 * the way and every passenger is aboard.
 */
export const advanceGangwayBoarding = (context: SettlementContext, ship: NavalShip, anchor: AdventureLanding) => {
  const mission = ship.troopMission!, shore = anchor.gangway.shore;
  const waiting = mission.boarding.flatMap(uid => {
    const actor = actorOf(context, uid);
    return actor && headingFor(context, actor, shore) ? [actor] : [];
  });
  const distance = (actor: SettlementActor) => DMath.hypot(actor.x - shore.x, actor.z - shore.z);
  const ready = waiting.filter(actor => readyAt(context, actor, shore))
    .sort((a, b) => distance(a) - distance(b) || a.uid - b.uid);
  const left = new Set(waiting.map(actor => actor.uid));
  let room = TROOP_GANGWAY_FILE - passageLoad(context, ship);
  for (const actor of ready) {
    // The commander leads his horse up alone: he waits for an empty file, the others may go before him.
    const load = bringsHorseAboard(context, actor.uid) ? TROOP_GANGWAY_FILE : 1;
    if (load > room) continue;
    left.delete(actor.uid);
    room -= load;
    if (context.military?.leaveFieldForShip?.(actor.uid)) stepToShip(context, ship, actor, shore);
  }
  mission.boarding = mission.boarding.filter(uid => left.has(uid));
  return !mission.boarding.length && allAboard(context, ship);
};

/** Every passenger stands on deck. */
export const allAboard = (context: SettlementContext, ship: NavalShip) =>
  (ship.passengers ?? []).every(uid => actorOf(context, uid)?.phase === "navalAboard");

/** Passengers that no longer exist leave the manifest (a soldier lost before it came aboard). */
export const pruneLostPassengers = (context: SettlementContext, ship: NavalShip) => {
  const living = (ship.passengers ?? []).filter(uid => actorOf(context, uid));
  if (living.length === (ship.passengers?.length ?? 0)) return;
  ship.cargoCount -= (ship.passengers?.length ?? 0) - living.length;
  ship.passengers = living;
};
