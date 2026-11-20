import { deckPeopleSlots, deckSlotPosition } from "../../render-common/ships/ship-deck-people";
import { DMath } from "../math/deterministic-math";
import type { CommanderState } from "./settlement-commander";
import { COMMANDER_BOARDING_PHASE, COMMANDER_MUSTER_PHASE, COMMANDER_WAITING_PHASE } from "./settlement-commander-transport";
import { exitPath } from "./settlement-entrance";
import { findHarbourDock } from "./settlement-harbour-docks";
import type { SettlementSoldier } from "./settlement-military";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { advanceShipPier, walkShipDeck } from "./settlement-ship-workpoint";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** A ship frame the commander can board without importing the naval fleet's live owner. */
export interface CommanderBoardingShip {
  x: number; y: number; z: number; yaw: number; phase: string;
  sourceUid?: number; passengers?: readonly number[]; troops?: readonly unknown[];
}

const deckTarget = (ship: CommanderBoardingShip, uid: number) => {
  const index = ship.passengers?.indexOf(uid) ?? -1;
  if (index < 0) return undefined;
  const slot = deckPeopleSlots((ship.passengers?.length ?? 0) + (ship.troops?.length ?? 0))[index];
  return slot && deckSlotPosition(ship, slot);
};

/** After the gangway, step along the deck to the assigned place. */
const walkToDeckPlace = (
  context: SettlementContext, actor: SettlementActor, ship: CommanderBoardingShip, target: { x: number; y: number; z: number },
  dt: number
) => {
  if (DMath.hypot(actor.x - target.x, actor.z - target.z) > .1) {
    if (!actor.path.length || actor.pathIndex >= actor.path.length) setActorPath(actor, [target], "navalDeckWalk");
    if (!walkShipDeck(actor, target.y, dt, .9)) return false;
  }
  Object.assign(actor, target, { action: "idle", mounted: false, phase: "navalAboard", visible: ship.phase !== "away" });
  actor.path = [];
  actor.pathIndex = 0;
  return true;
};

/**
 * One tick of the commander's physical boarding: muster walk, off-road wait, then the real gangway
 * and deck route of the ship it is manifested on. The fleet holds departure until this returns true.
 */
export const advanceCommanderBoarding = (
  context: SettlementContext, state: CommanderState, actor: SettlementActor | undefined,
  soldier: SettlementSoldier | undefined, ship: CommanderBoardingShip, dt: number
): boolean => {
  if (!actor || !soldier || !state.transport) return true;
  if (state.location === "aboard" || actor.phase === "navalAboard") return true;
  if (actor.phase === COMMANDER_MUSTER_PHASE) {
    if (moveActor(context, actor, dt)) {
      actor.phase = COMMANDER_WAITING_PHASE;
      actor.action = "idle";
      actor.mounted = false;
      actor.path = [];
      actor.pathIndex = 0;
      state.location = "waiting";
      state.transport.phase = "waiting";
    }
    return false;
  }
  if (actor.phase === "militaryLeaving" && state.location === "returning") {
    if (!moveActor(context, actor, dt)) return false;
    actor.phase = COMMANDER_BOARDING_PHASE;
    actor.action = "idle";
    actor.path = [];
    actor.pathIndex = 0;
    return false;
  }
  if (actor.phase === "militaryLeaving" && state.location === "waiting") {
    const dock = findHarbourDock(context, ship.sourceUid, ship);
    if (dock?.workPier && DMath.hypot(actor.x - dock.workPier.shore.x, actor.z - dock.workPier.shore.z) < 2.2) {
      actor.phase = COMMANDER_BOARDING_PHASE;
      actor.action = "idle";
      actor.path = [];
      actor.pathIndex = 0;
      return false;
    }
    if (!moveActor(context, actor, dt)) return false;
    actor.phase = COMMANDER_BOARDING_PHASE;
    actor.action = "idle";
    actor.path = [];
    actor.pathIndex = 0;
    return false;
  }
  if (actor.phase === "navalDeckWalk") {
    const target = deckTarget(ship, actor.uid);
    if (!target || !walkToDeckPlace(context, actor, ship, target, dt)) return false;
    soldier.building = -1;
    state.location = "aboard";
    state.transport.phase = "aboard";
    return true;
  }
  if (actor.phase === "navalWaiting" && state.location === "returning") {
    const source = context.buildings.find(building => building.uid === actor.building);
    const dock = findHarbourDock(context, source?.uid, ship);
    if (!source || !dock?.workPier) return false;
    Object.assign(actor, source.doorThreshold, { action: "walk", building: source.uid, home: source.uid,
      mounted: false, phase: "militaryLeaving", visible: true, y: source.y });
    setActorPath(actor, [...exitPath(source), ...dock.porterRoute], "militaryLeaving");
    return false;
  }
  if (actor.phase !== COMMANDER_WAITING_PHASE && actor.phase !== COMMANDER_BOARDING_PHASE) return false;
  const dock = findHarbourDock(context, ship.sourceUid, ship);
  if (!dock?.workPier) return false;
  if (actor.phase === COMMANDER_WAITING_PHASE) {
    actor.mounted = false;
    const source = context.buildings.find(building => building.uid === ship.sourceUid);
    if (source) {
      actor.building = source.uid;
      actor.home = source.uid;
    }
    const shorePath = groundPath(context, actor, dock.workPier.shore);
    if (!shorePath) return false;
    actor.phase = "militaryLeaving";
    setActorPath(actor, shorePath, "militaryLeaving");
    return false;
  }
  if (actor.pathIndex < actor.path.length) {
    moveActor(context, actor, dt);
    return false;
  }
  const atPier = DMath.hypot(actor.x - dock.workPier.point.x, actor.z - dock.workPier.point.z) < .1;
  if (!atPier) {
    if (advanceShipPier(context, actor, dock.workPier, false, dt)) {
      const target = deckTarget(ship, actor.uid);
      if (target) setActorPath(actor, [target], "navalDeckWalk");
    }
    return false;
  }
  const target = deckTarget(ship, actor.uid);
  if (!target) return false;
  if (!walkToDeckPlace(context, actor, ship, target, dt)) return false;
  soldier.building = -1;
  state.location = "aboard";
  state.transport.phase = "aboard";
  return true;
};

