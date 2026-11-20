import { DMath } from "../math/deterministic-math";
import { militaryTroopTool } from "./military-combat-rules";
import { exitPath } from "./settlement-entrance";
import { findHomeBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import { groundPath, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A hidden enemy guard steps out in front of the removed building's door, three abreast. */
const placeOutsideRemovedDoor = (actor: SettlementActor, removed: SettlementBuilding, slot: number) => {
  const dx = removed.access.x - removed.workerApproach.x,
    dz = removed.access.z - removed.workerApproach.z, length = DMath.hypot(dx, dz) || 1;
  const forward = .6 + Math.floor(slot / 3) * .7, side = ((slot % 3) - 1) * .7;
  actor.x = removed.access.x + dx / length * forward + dz / length * side;
  actor.z = removed.access.z + dz / length * forward - dx / length * side;
};

/** An enemy soldier of the removed building is left standing in the field, weapon in hand. */
const releaseEnemyToField = (soldier: SettlementSoldier, actor: SettlementActor, home: SettlementBuilding) => {
  soldier.building = -3; soldier.stationed = false; actor.visible = true; actor.building = home?.uid ?? -1;
  soldier.combat!.siege = undefined; soldier.combat!.doorMelee = undefined;
  actor.tool = militaryTroopTool(soldier.combat!.type);
  actor.phase = "militaryField";
  actor.path = []; actor.pathIndex = 0; actor.action = "idle";
};

/** A player soldier of the removed building walks back to the home building. */
const sendSoldierHome = (
  context: SettlementContext, soldier: SettlementSoldier, actor: SettlementActor,
  removed: SettlementBuilding, home: SettlementBuilding
) => {
  if (!actor.visible) {
    const point = soldier.stationed ? removed.doorThreshold : removed.access;
    actor.x = point.x; actor.z = point.z;
  }
  const wasStationed = soldier.stationed;
  const path = wasStationed ? exitPath(removed) : groundPath(context, actor, home.access);
  soldier.stationed = false; soldier.building = -2;
  actor.home = home.uid; actor.building = home.uid; actor.visible = true;
  actor.stockBuilding = undefined;
  if (path?.length) setActorPath(actor, path, wasStationed ? "outbound" : "retire");
  else { actor.phase = "militaryReturnBlocked"; actor.action = "idle"; actor.path = []; }
};

/** Soldiers stationed in, bound for or living at a removed building leave it; their horses follow. */
export const releaseRemovedSiteSoldiers = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, removed: SettlementBuilding, uid: number
) => {
  let releasedEnemies = 0;
  const home = findHomeBuilding(context)!;
  for (const soldier of soldiers.values()) {
    const actor = context.actors.find((entry) => entry.uid === soldier.actor)!;
    if (soldier.building !== uid && actor.home !== uid && actor.building !== uid) continue;
    if ((soldier.combat?.faction ?? 0) > 0) {
      if (!actor.visible) placeOutsideRemovedDoor(actor, removed, releasedEnemies++);
      releaseEnemyToField(soldier, actor, home);
      continue;
    }
    if (soldier.building >= 0 && soldier.building !== uid) {
      actor.home = home.uid;
      continue;
    }
    // Our besiegers of a destroyed enemy fort stay in the field instead of marching home.
    if (soldier.building === -3 && removed.militaryFaction !== undefined &&
      removed.militaryFaction !== (soldier.combat?.faction ?? 0)) {
      actor.building = actor.home === uid ? home.uid : actor.home;
      continue;
    }
    sendSoldierHome(context, soldier, actor, removed, home);
  }
  for (const soldier of soldiers.values()) {
    const actor = context.actors.find(actor => actor.uid === soldier.actor);
    const mount = context.actors.find(actor => actor.uid === soldier.combat?.mount);
    if (actor && mount) { mount.home = actor.home; mount.building = actor.home; }
  }
};

/** A player soldier of a fallen building stands in the field: it fights, or walks back to storage. */
const releasePlayerToField = (soldier: SettlementSoldier, actor: SettlementActor, home: SettlementBuilding) => {
  const state = soldier.combat!;
  soldier.building = -3; soldier.stationed = false;
  actor.visible = true; actor.home = home.uid; actor.building = home.uid;
  state.siege = undefined; state.doorMelee = undefined; state.returnToStorage = true;
  actor.tool = militaryTroopTool(state.type);
  actor.phase = "militaryField";
  actor.path = []; actor.pathIndex = 0; actor.action = "idle";
};

/**
 * Soldiers left at a player building whose walls fell (MIL-ASSAULT 2026-11-08) lose its protection:
 * the garrison remnant, its crew and reinforcements still on the way stand in the field as valid
 * targets instead of walking home untouchable. Enemy soldiers are released as on removal.
 */
export const releaseFallenSiteSoldiers = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, fallen: SettlementBuilding
) => {
  const home = findHomeBuilding(context)!;
  let slot = 0;
  const others = new Map<number, SettlementSoldier>();
  for (const soldier of soldiers.values()) {
    const actor = context.actors.find(entry => entry.uid === soldier.actor);
    if (!actor || (soldier.combat?.faction ?? 0) > 0 || !soldier.combat || soldier.building !== fallen.uid) {
      others.set(soldier.actor, soldier);
      continue;
    }
    if (!actor.visible) placeOutsideRemovedDoor(actor, fallen, slot++);
    releasePlayerToField(soldier, actor, home);
  }
  if (others.size) releaseRemovedSiteSoldiers(context, others, fallen, fallen.uid);
};
