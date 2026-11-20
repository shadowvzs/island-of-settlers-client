import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { MILITARY_PROFILES } from "../balance/military";
import { MORALE_WAVERING } from "../balance/morale";
import { DMath } from "../math/deterministic-math";
import { isStoryControlled } from "../script-world/script-order-guard";
import { refreshCourtyardOccupancy } from "./event-courtyard";
import { buildingStructure } from "./fort-assault-rules";
import {
  type MilitaryDoor, militaryHealth, militaryTroopTool, type MilitaryTroopType
} from "./military-combat-rules";
import type { CommanderUnit } from "./military-commander";
import type { createMilitaryRiders } from "./military-riders";
import { nearestMilitaryStorage } from "./military-routing";
import type { CombatCore } from "./settlement-combat-core";
import type { CombatOrders } from "./settlement-combat-orders";
import { homeUid } from "./settlement-home";
import { isNavigationClear } from "./settlement-navigation";
import { ownerOf } from "./settlement-ownership";
import { groundPath, setActorPath } from "./settlement-paths";
import { countOnDuty } from "./settlement-population";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

const RETURNING_PHASES = [
  "militaryField", "militarySiege", "militaryLeaving", "retire", "militaryMountedReturn", "militaryReturnBlocked"
];

export const isOpponentSpec = (type: MilitaryTroopType, rank: number, faction: number) =>
  Object.hasOwn(MILITARY_PROFILES, type) && Number.isInteger(rank) && rank >= 0 && rank <= 2 &&
  Number.isSafeInteger(faction) && faction > 0;

/** This tick's field soldiers as the military commander sees them, written into a reused array. */
export const collectCommanderUnits = ({ context, inField, memoryOf, pendingMarches, sieges, soldiers }: CombatCore,
  gridEntries: readonly SettlementActor[], out: CommanderUnit[] = []) => {
  out.length = 0;
  const patrolling = new Set(context.authoredScenario?.patrols?.map(patrol => patrol.actor) ?? []);
  for (const body of gridEntries) {
    const soldier = soldiers.get(body.uid), state = soldier?.combat;
    if (!soldier || !state || !inField(body) || sieges.isDefender(body.uid)) continue;
    const memory = memoryOf(body.uid);
    // A wavering or broken soldier follows its morale (falls back, routs), not the commander (A14-2).
    out.push({ busy: (context.colony?.isRaider?.(body.uid) ?? false) || state.siege !== undefined ||
        sieges.atDoor(body.uid) || memory.guardOnArrival === true || (memory.moraleState ?? 0) >= MORALE_WAVERING ||
        pendingMarches.has(body.uid) || patrolling.has(body.uid) || isStoryControlled(context, body.uid) ||
        (context.militaryDirector?.holds(body.uid) ?? false),
      destination: state.destination, faction: state.faction,
      fighting: state.target !== undefined || (state.attackTime ?? 0) > 0,
      health: state.hp / militaryHealth(state.type, soldier.rank), home: memory.anchor ?? body,
      marching: state.destination !== undefined, morale: memory.morale, moraleState: memory.moraleState,
      order: state.order, squad: memory.squad,
      rank: soldier.rank, type: state.type, uid: body.uid, x: body.x, z: body.z });
  }
  return out;
};

export const enableEventCourtyard = (context: SettlementContext, doors: Map<number, MilitaryDoor>, uid: number,
  wallHp = 2000) => {
  const site = context.buildings.find(site => site.uid === uid), door = doors.get(uid);
  if (!site || !door || site.construction < 1 || site.bandit === undefined ||
    site.enemyCampEnclosure || isOpenArcherTower(site) || site.width < 2 || site.depth < 2 ||
    ownerOf(site) <= 0 || !Number.isFinite(wallHp) || wallHp <= 0 ||
    context.colony?.save() || context.adventure?.save()) return false;
  door.structure ??= buildingStructure(site.typeId);
  if (site.eventCourtyard) return false;
  site.eventCourtyard = { walls: Array.from({ length: 4 }, () => ({ hp: wallHp, maximum: wallHp })) };
  refreshCourtyardOccupancy(context, site);
  return true;
};

/** Up to three clear places around a player field soldier for a test skirmish (none while enemies exist). */
export const testSkirmishPositions = ({ actorById, context, soldiers }: CombatCore) => {
  if ([...soldiers.values()].some(soldier => (soldier.combat?.faction ?? 0) > 0)) return [];
  const defender = [...soldiers.values()].find(soldier => soldier.combat?.faction === 0 &&
    (soldier.combat.hp > 0) && actorById(soldier.actor)?.phase === "militaryField");
  const actor = defender && actorById(defender.actor);
  if (!actor) return [];
  const positions: SettlementPoint[] = [];
  for (let direction = 0; direction < 24 && positions.length < 3; direction++) {
    const angle = direction * Math.PI / 12;
    const point = { x: actor.x + DMath.cos(angle) * 8, z: actor.z + DMath.sin(angle) * 8 };
    if (!isNavigationClear(context, point) || !groundPath(context, actor, point) ||
      context.actors.some(other => other.visible && DMath.hypot(other.x - point.x, other.z - point.z) < .7) ||
      positions.some(other => DMath.hypot(other.x - point.x, other.z - point.z) < .7)) continue;
    positions.push(point);
  }
  return positions;
};

interface CommandServices {
  /** Adds a new actor to this tick's actor index. */
  indexActor: (actor: SettlementActor) => void;
  orders: CombatOrders;
  riders: ReturnType<typeof createMilitaryRiders>;
}

/** Sieges, computer soldiers, patrols and returns home ordered from outside the simulation. */
export const createCombatCommands = ({
  actorById, context, doors, initialize, movement, pendingMarches, sieges, soldiers
}: CombatCore, { indexActor, orders, riders }: CommandServices) => {
  const { command, march } = orders;
  /**
   * Field soldiers whose march to the door found no place (archers behind a crowded front) still
   * attack undefended walls: their own assault places lead them there.
   */
  const joinWallAssault = (ids: readonly number[], uid: number, faction: number,
    marching: readonly number[], accepted?: number[]) => {
    const site = context.buildings.find(building => building.uid === uid);
    let joined = 0;
    for (const id of ids) {
      const state = soldiers.get(id)?.combat;
      if (site && isOpenArcherTower(site) && state?.type === "archer") continue;
      if (marching.includes(id) || state?.faction !== faction || actorById(id)?.phase !== "militaryField") continue;
      state.siege = uid; state.destination = undefined; state.target = undefined;
      accepted?.push(id); joined++;
    }
    return joined;
  };
  /**
   * Sends soldiers of `faction` against an enemy building: foot soldiers queue at its door; riders
   * ride to its front, hunt reinforcements and dismount at the door when a fighting place is free.
   */
  const besiege = (ids: readonly number[], uid: number, faction: number, accepted?: number[]) => {
    const door = doors.get(uid), building = context.buildings.find(entry => entry.uid === uid);
    const garrisoned = [...soldiers.values()].some(guard => guard.building === uid);
    // Archers join once the door is broken, or once nobody defends walls under direct assault.
    const archersMayJoin = !garrisoned && (door?.structure ? door.structure.hp > 0 : !door?.hp);
    const eligible = ids.some(id => {
      const soldier = soldiers.get(id);
      return soldier && initialize(soldier).faction === faction &&
        (soldier.combat!.type !== "archer" || archersMayJoin);
    });
    if (!door || !building || door.faction === faction || !eligible || door.structure?.hp === 0) return false;
    const isRider = (id: number) => soldiers.get(id)?.combat?.type === "cavalry";
    // Only soldiers that actually march (not ones left in storage without a route) queue, so the
    // door basher is always a real walker.
    // Keep the travel pace, but omit the arrival regroup that waits for the whole block at a siege.
    const walkers = ids.filter(id => !isRider(id));
    const foot = march(walkers, building.access, faction, "attackMove");
    // A group place can fall on ground cut off from the fort: archers sent against undefended
    // walls then set out alone, to the door's access (BUG-04).
    if (door.structure && archersMayJoin) foot.push(...walkers.filter(id => !foot.includes(id) &&
      soldiers.get(id)?.combat?.type === "archer")
      .flatMap(id => march([id], building.access, faction, "attackMove")));
    const front = riders.siegeFront(building);
    const mounted = front ? march(ids.filter(isRider), front, faction, "attackMove") : [];
    for (const id of foot) {
      const state = soldiers.get(id)?.combat;
      if (state && !sieges.isDefender(id)) { state.siege = uid; state.destination = undefined; }
    }
    for (const id of mounted) soldiers.get(id)!.combat!.siege = uid;
    const joined = door.structure && (!garrisoned || isOpenArcherTower(building) || building.eventCourtyard)
      ? joinWallAssault(ids, uid, faction, [...foot, ...mounted], accepted) : 0;
    accepted?.push(...foot, ...mounted);
    return foot.length + mounted.length + joined > 0;
  };
  /** A new computer soldier (and a rider's hidden horse) at `point`; returns its id. */
  const addOpponent = (point: SettlementPoint & { y: number }, type: MilitaryTroopType, rank: number,
    faction: number, phase: string) => {
    const home = homeUid(context);
    const actor: SettlementActor = { uid: context.nextActor++, x: point.x, y: point.y, z: point.z,
      yaw: 0, visible: true, job: "Soldier", action: "idle", ware: null,
      tool: militaryTroopTool(type),
      phase, building: home, home, path: [], pathIndex: 0, timer: 0, animationTime: 0 };
    const mount = type === "cavalry" ? context.nextActor++ : undefined;
    if (mount !== undefined) {
      context.actors.push({ ...actor, uid: mount, job: "Mount", phase: "horseMounted", visible: false });
      actor.mounted = true;
    }
    context.actors.push(actor); indexActor(actor);
    if (faction === 0) countOnDuty(context, 1);
    soldiers.set(actor.uid, { actor: actor.uid, rank, building: -3, stationed: false,
      combat: { type, faction, hp: militaryHealth(type, rank), cooldown: 0, mount } });
    return actor.uid;
  };
  /** Authored patrols yield to combat, existing marches and every garrison/siege assignment. */
  const patrolOpponent = (id: number, destination: SettlementPoint, faction: number) => {
    const soldier = soldiers.get(id), actor = actorById(id), state = soldier?.combat;
    if (!soldier || !actor || !state || state.faction !== faction || faction <= 0 || state.hp <= 0 ||
      actor.phase !== "militaryField" || soldier.stationed || sieges.isDefender(id)) return "inactive";
    if (isStoryControlled(context, id)) return "busy";
    if (state.target !== undefined || state.pendingTarget !== undefined || state.siege !== undefined ||
      state.attackTime || state.destination || state.pendingRoute || pendingMarches.has(id) ||
      state.returnToStorage || state.mountOnClear) return "busy";
    if (DMath.hypot(actor.x - destination.x, actor.z - destination.z) < .6) return "arrived";
    return command([id], destination, faction, "attackMove") ? "ordered" : "blocked";
  };
  const returnHome = (ids: readonly number[], storageUid?: number) => {
    for (const id of ids) pendingMarches.delete(id);
    let accepted = false;
    for (const id of ids) {
      const soldier = soldiers.get(id), actor = actorById(id);
      if (!soldier?.combat || !actor || sieges.isDefender(id) || soldier.combat.faction !== 0 ||
        !RETURNING_PHASES.includes(actor.phase)) continue;
      if (storageUid !== undefined) soldier.combat.returnStorageUid = storageUid;
      if (["retire", "militaryMountedReturn"].includes(actor.phase) &&
        (storageUid === undefined || actor.home === storageUid)) { accepted = true; continue; }
      sieges.cancel(id);
      if (actor.phase === "militaryLeaving") {
        soldier.combat.returnToStorage = true; accepted = true; continue;
      }
      // A finished/destroyed siege may already have released its actor into the field.
      // Process that return immediately instead of waiting for an exit phase that will never run.
      if (actor.phase === "militarySiege") actor.phase = "militaryField";
      soldier.combat.returnToStorage = undefined;
      // A dismounted rider takes its waiting horse home with it.
      if (soldier.combat.dismounted) riders.mountNow(actor, soldier.combat);
      const choice = nearestMilitaryStorage(context, actor, soldier.combat.returnStorageUid);
      if (!choice) continue;
      const { home, path } = choice;
      actor.home = home.uid;
      const mount = actorById(soldier.combat.mount ?? NaN);
      if (mount) { mount.home = home.uid; mount.building = home.uid; }
      soldier.combat.destination = undefined; soldier.combat.pendingTarget = undefined;
      soldier.combat.target = undefined; soldier.combat.pendingRoute = undefined; movement.leave(id);
      soldier.combat.siege = undefined; soldier.building = -2;
      actor.building = home.uid;
      setActorPath(actor, path, actor.mounted ? "militaryMountedReturn" : "retire"); accepted = true;
    }
    return accepted;
  };
  /** A new field recruit joins storage by an ordinary attack-move, staying alert along the way. */
  const admitPlayer = (id: number) => {
    const soldier = soldiers.get(id), actor = actorById(id);
    if (!soldier?.combat || soldier.combat.faction !== 0 || !actor || actor.phase !== "militaryField") return false;
    const choice = nearestMilitaryStorage(context, actor);
    if (!choice) return false;
    const goal = choice.path.at(-1) ?? choice.home.access;
    if (!command([id], goal, 0, "attackMove")) return false;
    soldier.combat.returnToStorage = true;
    soldier.combat.returnStorageUid = choice.home.uid;
    return true;
  };
  return { addOpponent, admitPlayer, besiege, patrolOpponent, returnHome };
};
