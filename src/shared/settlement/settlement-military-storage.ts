import {
  ARCHER_HEALTH_VERSION, LEGACY_ARCHER_HEALTH_SCALE, MILITARY_PROFILES, MILITARY_RECRUIT_COSTS,
  MILITARY_REST_SECONDS_PER_HP
} from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { emitSoldierRecruited } from "../script-world/script-unit-events";
import {
  isOrdinaryTroopType, militaryHealth, militaryTroopTool, type MilitaryTroopType, ORDINARY_TROOP_TYPES
} from "./military-combat-rules";
import { payMilitaryCost } from "./military-economy";
import { canLeaveGarrison } from "./military-garrison-preservation";
import { militaryBuildingCapacity } from "./military-garrison-rules";
import { militaryCrowdPath,militaryGroundPath } from "./military-routing";
import { STORAGE_IDS } from "./production-rules";
import { COMMANDER_RECOVERY_SECONDS } from "./settlement-commander";
import { type CommanderManifest, commanderStateFromManifest } from
  "./settlement-commander-transport";
import { exitPath } from "./settlement-entrance";
import { findHomeBuilding, isOwnBuilding, NO_BUILDING } from "./settlement-home";
import type { EmigratedTroop, SettlementSoldier } from "./settlement-military";
import { MILITARY_RANK_VERSION } from "./settlement-military-ranks";
import { migrateSavedMilitaryHealth } from "./settlement-military-state";
import { isMountedNavigationClear,isNavigationClear } from "./settlement-navigation";
import { ownerOf } from "./settlement-ownership";
import { createActor, groundPath, setActorPath } from "./settlement-paths";
import { availableIdleSettlers, countOnDuty } from "./settlement-population";
import { markRoadTravelChecked } from "./settlement-road-rerouting";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { noteSettlerDemand } from "./settler-relocation";

const types = Object.keys(MILITARY_PROFILES) as MilitaryTroopType[];
export const createMilitaryStorage = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>,
  capacity: Readonly<Record<number, number>>, setTarget: (uid: number, count: number) => void
) => {
  const storedTroops = () => types.map(type => {
    const actors = [...soldiers.values()].filter(soldier => {
      const actor = context.actors.find(actor => actor.uid === soldier.actor);
      return actor?.phase === "militaryReserve" && actor.navalOrder === undefined &&
        (soldier.combat?.faction ?? 0) === 0 && (soldier.combat?.type ?? "shield") === type;
    }).map(soldier => soldier.actor);
    return { type, count: actors.length, actors };
  });
  /** `owner`: the player's order, or a computer economy re-garrisoning its own building (EAI2b). */
  const garrison = (ids: readonly number[], uid: number, owner = 0) => {
    const site = context.buildings.find(site => site.uid === uid && site.construction === 1 &&
      ownerOf(site) === owner && capacity[site.typeId]);
    if (!site) return 0;
    let assigned = [...soldiers.values()].filter(soldier => soldier.building === uid).length;
    let accepted = 0;
    for (const id of new Set(ids)) {
      if (assigned >= militaryBuildingCapacity(site)) break;
      const soldier = soldiers.get(id), actor = context.actors.find(actor => actor.uid === id);
      if (!soldier || !actor || actor.navalOrder !== undefined || soldier.combat?.type === "cavalry" ||
        (soldier.combat?.faction ?? 0) !== owner || soldier.building === uid ||
        !["militaryField", "militaryReserve", "garrison"].includes(actor.phase)) continue;
      if (!canLeaveGarrison(context, actor)) continue;
      const origin = context.buildings.find(home => home.uid === actor.building);
      const from = actor.phase === "militaryField" ? actor : origin?.access;
      if (!from) continue;
      const path = actor.phase === "militaryField"
        ? militaryCrowdPath(context, actor, site.access)
        : groundPath(context, from, site.access);
      if (!path) continue;
      soldier.building = uid; soldier.stationed = false;
      if (soldier.combat) {
        soldier.combat.destination = undefined; soldier.combat.target = undefined;
        soldier.combat.siege = undefined; soldier.combat.pendingTarget = undefined;
      }
      if (actor.phase === "militaryField") {
        actor.building = uid; setActorPath(actor, path, "assigned");
      } else if (origin) setActorPath(actor, exitPath(origin), "militaryTransferLeaving");
      assigned++; accepted++;
    }
    if (accepted) setTarget(uid, assigned);
    return accepted;
  };
  const recruit = (uid: number, type: MilitaryTroopType) => {
    const home = context.buildings.find(home => home.uid === uid && home.construction === 1 &&
      STORAGE_IDS.has(home.typeId) && isOwnBuilding(home));
    // Ordinary cavalry is retired; historical saves keep existing riders, but nothing may enlist one.
    if (!home || !isOrdinaryTroopType(type) || !Object.hasOwn(MILITARY_PROFILES, type)) return null;
    if (availableIdleSettlers(context, home) < 1) { noteSettlerDemand(context, home); return null; }
    if (!payMilitaryCost(home.inventory, MILITARY_RECRUIT_COSTS[type])) return null;
    const actor = createActor(context, "Soldier", uid);
    actor.phase = "militaryReserve";
    actor.tool = militaryTroopTool(type);
    soldiers.set(actor.uid, { actor: actor.uid, building: -1, rank: 0, stationed: false,
      combat: { type, faction: 0, hp: militaryHealth(type, 0), cooldown: 0 } });
    if (context.script) emitSoldierRecruited(context, actor, home);
    return actor.uid;
  };
  return { storedTroops, garrison, recruit };
};

/** Plan the entire authored encounter before any actor or stock is changed. */
export const trainingEncounterPoints = (context: SettlementContext) => {
  const home = findHomeBuilding(context)!;
  for (let radius = 20; radius <= 48; radius += 4) {
    for (let bearing = 0; bearing < 24; bearing++) {
      const angle = bearing * Math.PI / 12;
      const center = { x: home.access.x + DMath.cos(angle) * radius,
        z: home.access.z + DMath.sin(angle) * radius };
      const points = Array.from({ length: 8 }, (_, index) => ({
        x: center.x + (index % 4 - 1.5) * 2.2, z: center.z + (Math.floor(index / 4) - .5) * 2.2
      }));
      if (points.every(point => isNavigationClear(context, point) &&
        isMountedNavigationClear(context, point) &&
        !context.actors.some(actor => actor.visible && DMath.hypot(actor.x - point.x, actor.z - point.z) < 1) &&
        militaryGroundPath(context, home.access, point))) return points;
    }
  }
  return null;
};

/** Where a recreated soldier appears: its body, phase, owning building and soldier slot. */
interface TroopPlacement {
  /** The soldier's combat faction; absent: the player's (counted on duty). */
  faction?: number;
  point: SettlementPoint;
  y: number;
  phase: string;
  /** Storage uid, or NO_BUILDING on a building-free island. */
  home: number;
  /** -1 stored reserve, -3 field (battlefield) soldier. */
  slot: number;
}

/** One hidden soldier actor (a cavalry rider also gets its hidden horse) from a troop between islands. */
const addTroop = (
  context: Pick<SettlementContext, "actors" | "nextActor" | "population">, soldiers: Map<number, SettlementSoldier>,
  { commander, hp, rank, recoverySeconds, type }: EmigratedTroop, placement: TroopPlacement
) => {
  const actor: SettlementActor = { uid: context.nextActor++, ...placement.point, y: placement.y,
    yaw: 0, visible: false, job: "Soldier", action: "idle", ware: null,
    tool: militaryTroopTool(type),
    phase: placement.phase, building: placement.home, home: placement.home, path: [], pathIndex: 0,
    timer: 0, animationTime: 0 };
  const mount = type === "cavalry" ? context.nextActor++ : undefined;
  if (mount !== undefined) context.actors.push({ ...actor, uid: mount, job: "Mount",
    phase: "horseMounted", tool: undefined });
  context.actors.push(actor);
  const faction = placement.faction ?? 0;
  if (faction === 0) countOnDuty(context, 1);
  const maximum = commander ? commander.maximumHp : militaryHealth(type, rank);
  const migratedHp = type === "archer" && hp > maximum
    ? Math.min(maximum, hp * LEGACY_ARCHER_HEALTH_SCALE) : Math.min(hp, maximum);
  const combat = { cooldown: 0, faction, hp: migratedHp, mount, type };
  soldiers.set(actor.uid, { actor: actor.uid, rank, building: placement.slot, stationed: false,
    ...(commander ? { commanderId: commander.id } : {}),
    ...(recoverySeconds !== undefined && recoverySeconds >= 0 && recoverySeconds < MILITARY_REST_SECONDS_PER_HP &&
      migratedHp < maximum ? { recoverySeconds } : {}), combat });
  return actor;
};

/**
 * Stores the troops as reserves in `home` (the headquarters unless another storage is given). Each starts with the
 * current road check a load gives every person, as a computer reserve does (`grantFactionReserves`): a call-out
 * marches it straight to the field, never on a road journey (EAI-CLOSE).
 */
export const grantReserves = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, troops: readonly EmigratedTroop[],
  home: SettlementBuilding = findHomeBuilding(context)!
) => troops.map(troop => {
  const actor = addTroop(context, soldiers, troop,
    { home: home.uid, phase: "militaryReserve", point: home.doorThreshold, slot: -1, y: home.y });
  markRoadTravelChecked(context, actor);
  return actor;
});

/**
 * A computer economy's reserve (EAI2b, `aiPlace` start kit): the troops wait in `storage` as soldiers of the
 * storage's owner, outside the player's on-duty count like every enemy soldier. Each starts with the current road
 * check a load gives every person: the economy may march it straight to the field (never on a road journey), and
 * without one a road edit before its first road journey left the running island and its reload apart (EAI-FINAL).
 */
export const grantFactionReserves = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, troops: readonly EmigratedTroop[],
  storage: SettlementBuilding
) => troops.map(troop => {
  const actor = addTroop(context, soldiers, troop, { faction: ownerOf(storage), home: storage.uid,
    phase: "militaryReserve", point: storage.doorThreshold, slot: -1, y: storage.y });
  markRoadTravelChecked(context, actor);
  return actor;
});

/**
 * Field soldiers of a building-free island waiting aboard the landing ship at `deck`, hidden in
 * `phase` until they walk ashore; returns their actors in landing order.
 */
export const grantAboard = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, troops: readonly EmigratedTroop[],
  deck: SettlementPoint & { y: number }, phase: string
) => troops.map(troop => addTroop(context, soldiers, troop,
  { home: NO_BUILDING, phase, point: { x: deck.x, z: deck.z }, slot: -3, y: deck.y }));

export const grantTrainingReserves = (context: SettlementContext, soldiers: Map<number, SettlementSoldier>) =>
  grantReserves(context, soldiers, ORDINARY_TROOP_TYPES.flatMap(type =>
    Array.from({ length: 20 }, () => ({ hp: militaryHealth(type, 0), rank: 0, type }))));

/** Credit saved reserves without running a filed island or fabricating ordinary settlers. */
export const grantSavedReserves = (
  save: import("./settlement-save-state").SettlementSaveV1, troops: readonly EmigratedTroop[], home: SettlementBuilding
) => {
  if (save.military) migrateSavedMilitaryHealth(save.military);
  else save.military = { archerHealthVersion: ARCHER_HEALTH_VERSION, soldiers: [], targets: [], coinsAllowed: [],
    rankVersion: MILITARY_RANK_VERSION, recruitTimers: [], trainTimers: [], randomState: 1 };
  const soldiers = new Map(save.military.soldiers.map(soldier => [soldier.actor, soldier]));
  for (const troop of troops) {
    const actor = addTroop(save, soldiers, troop,
      { home: home.uid, phase: "militaryReserve", point: home.doorThreshold, slot: -1, y: home.y });
    if (troop.commander) adoptSavedCommander(save, troop.commander, actor);
  }
  save.military.soldiers = [...soldiers.values()];
};

/** One manifest becomes the filed home roster copy after a colony/expedition handoff. */
const adoptSavedCommander = (
  save: import("./settlement-save-state").SettlementSaveV1, manifest: CommanderManifest,
  actor: SettlementActor
) => {
  const lodge = save.buildings.find(building => building.typeId === 62 && building.construction === 1 &&
    isOwnBuilding(building));
  const recovering = manifest.casualty || Boolean(manifest.failureId);
  const soldier = save.military!.soldiers.find(entry => entry.actor === actor.uid);
  if (!soldier) return;
  soldier.commanderId = manifest.id;
  if (soldier.combat) soldier.combat.hp = manifest.casualty ? 1 : Math.max(0, manifest.hp);
  if (lodge) {
    Object.assign(actor, { action: "idle", building: lodge.uid, home: lodge.uid, path: [], pathIndex: 0,
      phase: recovering ? "commanderRecovering" : "commanderLodge", visible: false,
      x: lodge.doorThreshold.x, y: lodge.y, z: lodge.doorThreshold.z });
    soldier.building = -1;
  }
  const previous = save.military!.commander;
  let location: import("./settlement-commander").CommanderState["location"] = "awaiting-home";
  if (lodge) location = recovering ? "recovering" : "lodge";
  const state = commanderStateFromManifest(manifest, lodge?.uid ?? -1, location);
  save.military!.commander = {
    ...state,
    ...(previous?.homeLodgeUid !== undefined ? { homeLodgeUid: previous.homeLodgeUid } : {}),
    ...(recovering && lodge ? { recoverySeconds: COMMANDER_RECOVERY_SECONDS } : { recoverySeconds: 0 }),
    awayHp: undefined,
    location,
    operationId: undefined,
    transport: undefined
  };
};

