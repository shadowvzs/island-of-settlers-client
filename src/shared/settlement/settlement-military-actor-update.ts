import { DMath } from "../math/deterministic-math";
import { isCatapultPorter } from "./military-catapult-resupply";
import { canGarrisonMilitaryType } from "./military-combat-rules";
import { militaryCrowdPath, nearestMilitaryStorage } from "./military-routing";
import { addGood } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { canEnterDoor, entrancePath } from "./settlement-entrance";
import type { SettlementSoldier } from "./settlement-military";
import { isNavigationClear } from "./settlement-navigation";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { setQueueTarget } from "./settlement-traffic";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

interface MilitaryActorDependencies {
  /** The next order number of a soldier taking its place inside a garrison. */
  allocateGarrisonOrder: () => number;
  /** Field combat; true when it moved the soldier this tick. */
  updateCombatActor: (actor: SettlementActor, dt: number) => boolean;
}

/** A blocked garrison entry waits in a spaced lane behind the access instead of on its centre point. */
const waitOutsideGarrison = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  if (!building.hasDoor) return;
  const access = building.access, approach = building.workerApproach;
  const dx = access.x - approach.x, dz = access.z - approach.z;
  const length = DMath.hypot(dx, dz);
  if (length < 1e-3) return;
  const waiting = context.actors.filter(other => other !== actor && other.visible &&
    other.building === building.uid && ["assigned", "retire"].includes(other.phase));
  const order = waiting.filter(other => other.uid < actor.uid).length;
  const distance = .45 + Math.floor(order / 2) * .38;
  const side = order % 2 ? 1 : -1;
  const spot = { x: access.x + dx / length * distance - dz / length * side * .16,
    z: access.z + dz / length * distance + dx / length * side * .16 };
  if (isNavigationClear(context, spot)) setQueueTarget(actor, spot, "doorstep");
};

/** A soldier walked into its assigned building: a rider stays outside, a foot soldier enters the door. */
const arriveAtAssignedSite = (
  context: SettlementContext, actor: SettlementActor, soldier: SettlementSoldier, building: SettlementBuilding
) => {
  if (!canGarrisonMilitaryType(soldier.combat?.type)) {
    // A mounted arrival stays outside; it never crosses the threshold or consumes a slot.
    actor.phase = "militaryField"; actor.action = "idle"; actor.path = []; actor.pathIndex = 0;
    soldier.building = -3; soldier.stationed = false;
    return;
  }
  if (canEnterDoor(context, actor, building)) setActorPath(actor, entrancePath(building), "enterAssigned");
  else waitOutsideGarrison(context, actor, building);
};

/** Sends a soldier with no reachable storage to the nearest one found again (mounted riders ride). */
const retryBlockedReturn = (context: SettlementContext, actor: SettlementActor, soldier: SettlementSoldier) => {
  const choice = nearestMilitaryStorage(context, actor, soldier.combat?.returnStorageUid);
  if (!choice) return;
  actor.home = choice.home.uid; actor.building = choice.home.uid;
  const mount = context.actors.find(mount => mount.uid === soldier.combat?.mount);
  if (mount) { mount.home = choice.home.uid; mount.building = choice.home.uid; }
  setActorPath(actor, choice.path, actor.mounted ? "militaryMountedReturn" : "retire");
};

/** The end of a soldier's walk: entering a garrison, heading home or becoming a stored reserve. */
const finishMilitaryWalk = (
  context: SettlementContext, actor: SettlementActor, soldier: SettlementSoldier,
  allocateGarrisonOrder: () => number
) => {
  const building = context.buildings.find((entry) => entry.uid === actor.building);
  if (actor.phase === "assigned" && building) {
    arriveAtAssignedSite(context, actor, soldier, building);
  } else if (actor.phase === "enterAssigned" && building) {
    actor.phase = "garrison"; actor.visible = false; actor.action = "idle";
    building.territoryClaimed = true;
    soldier.stationed = true; soldier.stationedOrder = allocateGarrisonOrder(); building.door = 1;
  } else if (actor.phase === "outbound") {
    const home = context.buildings.find((entry) => entry.uid === actor.home)!;
    const route = context.options.roads.route(actor, home.access);
    if (route) setActorPath(actor, route.points, "retire");
    else { actor.phase = "militaryReturnBlocked"; actor.action = "idle"; }
  } else if (actor.phase === "retire") {
    const home = context.buildings.find((entry) => entry.uid === actor.home)!;
    if (canEnterDoor(context, actor, home)) setActorPath(actor, entrancePath(home), "enterRetire");
  } else if (actor.phase === "enterRetire") {
    const home = context.buildings.find(entry => entry.uid === actor.home);
    if (home && actor.ware) addGood(home.inventory, actor.ware, actor.wareUnits ?? 1);
    actor.ware = null; actor.wareUnits = undefined; actor.wareScale = undefined;
    actor.phase = "militaryReserve"; actor.visible = false; actor.action = "idle";
    if (soldier.combat) soldier.combat.returnStorageUid = undefined;
    soldier.building = -1; actor.building = actor.home;
  }
};

/** Per-tick behaviour of the player's and enemies' soldiers outside field combat (false: not a soldier). */
export const createMilitaryActorUpdate = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>,
  { allocateGarrisonOrder, updateCombatActor }: MilitaryActorDependencies
) => (actor: SettlementActor, dt: number) => {
  // The ammunition service shares combat's roof semaphore, but its employed body is a civilian.
  if (actor.job === "Carrier" && isCatapultPorter(getBuilding(context, actor.building), actor.uid))
    return updateCombatActor(actor, dt);
  const soldier = soldiers.get(actor.uid); if (!soldier) return false;
  // Commander lodge/evacuation movement belongs to the commander system, never the ordinary soldier walk.
  if (["commanderLodge", "commanderRecovering", "commanderIncapacitated", "commanderEvacuating"]
    .includes(actor.phase)) return true;
  if (actor.phase === "militaryTransferLeaving") {
    if (moveActor(context, actor, dt)) {
      const site = context.buildings.find(site => site.uid === soldier.building);
      const path = site && groundPath(context, actor, site.access);
      if (site && path) { actor.building = site.uid; setActorPath(actor, path, "assigned"); }
    }
    return true;
  }
  if (updateCombatActor(actor, dt)) return true;
  if (actor.phase === "garrison" || actor.phase === "militaryReserve") return true;
  if (actor.phase === "militaryReturnBlocked") {
    retryBlockedReturn(context, actor, soldier);
    return true;
  }
  // Repair early mounted saves that used the pedestrian storage-arrival phase.
  if (actor.mounted && actor.phase === "retire") {
    const choice = nearestMilitaryStorage(context, actor, soldier.combat?.returnStorageUid);
    if (choice) {
      actor.home = choice.home.uid; actor.building = choice.home.uid;
      setActorPath(actor, choice.path, "militaryMountedReturn");
    }
  }
  if (actor.phase === "militaryMountedReturn") {
    const staging = actor.path.at(-1);
    if (moveActor(context, actor, dt) || (staging && DMath.hypot(actor.x - staging.x, actor.z - staging.z) < .2)) {
      const home = context.buildings.find(home => home.uid === actor.home);
      const approach = home && groundPath(context, actor, home.access);
      if (approach) { actor.mounted = false; setActorPath(actor, approach, "retire"); }
    }
    return true;
  }
  if (actor.phase === "assigned" && (actor.timer ?? 0) > .6) {
    const site = context.buildings.find(site => site.uid === soldier.building);
    const path = site && militaryCrowdPath(context, actor, site.access);
    if (path) setActorPath(actor, path, "assigned");
  }
  if (!moveActor(context, actor, dt)) return true;
  finishMilitaryWalk(context, actor, soldier, allocateGarrisonOrder);
  return true;
};
