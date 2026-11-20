import { DMath } from "../math/deterministic-math";
import { isStoryControlled } from "../script-world/script-order-guard";
import type { MilitaryCombatant, MilitaryTroopType } from "./military-combat-rules";
import { nearestMountingPoint, orderTargetCandidates } from "./military-order-target";
import type { createSettlementCombat } from "./settlement-combat";
import type { TargetMilitaryOutcome, TargetMilitaryResult } from "./settlement-combat-chase";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import { withMilitaryNavigationCache } from "./settlement-navigation";
import { groundPath, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

type SettlementCombat = ReturnType<typeof createSettlementCombat>;
type OrderMode = NonNullable<MilitaryCombatant["order"]>;

/** The persistent rally banner: its ground point and, when planted on one, the enemy building. */
export interface MilitaryRallySave {
  x: number; z: number; building?: number;
  /** Capture regroups only these banner participants; absent in historical saves. */
  participants?: number[];
}

/** Soldiers walking back to a storage: still the player's free army, selectable and commandable. */
export const RETURNING_MILITARY_PHASES: readonly string[] =
  ["retire", "militaryMountedReturn", "militaryReturnBlocked", "outbound"];
/** Phases of soldiers the player sees outside and can select. */
export const SELECTABLE_MILITARY_PHASES: readonly string[] =
  ["militaryField", "militaryLeaving", "militarySiege", ...RETURNING_MILITARY_PHASES];
/** Phases of free troops a call-out gathers (garrisons and garrison-bound soldiers stay). */
const FREE_TROOP_PHASES =
  new Set(["militaryReserve", "militaryField", "militaryLeaving", ...RETURNING_MILITARY_PHASES]);
const TROOP_TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];
/** Soldiers idling this close (tiles) to the banner count as gathered there. */
const RALLY_GATHERED_RADIUS = 4;

const isPlayerSoldier = (soldier: SettlementSoldier) => (soldier.combat?.faction ?? 0) === 0;
const troopType = (soldier: SettlementSoldier): MilitaryTroopType => soldier.combat?.type ?? "shield";

export const isFreePlayerTroop = (soldier: SettlementSoldier, actor: SettlementActor | undefined) =>
  isPlayerSoldier(soldier) && actor !== undefined && actor.navalOrder === undefined && !soldier.stationed &&
  FREE_TROOP_PHASES.has(actor.phase);

/**
 * The player's military orders: selection-independent call-outs, the persistent rally banner and
 * orders that end on the nearest open ground next to the clicked target.
 */
export const createMilitaryOrders = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, combat: SettlementCombat
) => {
  let rally: MilitaryRallySave | undefined;
  const rallyParticipants = new Set<number>();
  /** New Tavern recruits on their way to storage; with a banner planted they walk on to it (transient). */
  const recruits = new Set<number>();
  /** Where soldiers outside with no storage go when the banner is cancelled (an adventure's beach). */
  let regatherStranded: ((ids: readonly number[]) => void) | undefined;
  const actorById = (id: number) => context.actors.find(actor => actor.uid === id);
  /** Returning soldiers turn round where they stand; a dismounted rider first mounts nearby. */
  const reclaimReturning = (soldier: SettlementSoldier, actor: SettlementActor) => {
    soldier.building = -3; soldier.stationed = false;
    if (soldier.combat) { soldier.combat.returnToStorage = undefined; soldier.combat.returnStorageUid = undefined; }
    actor.path = []; actor.pathIndex = 0; actor.action = "idle"; actor.queueTarget = undefined;
    const mount = troopType(soldier) === "cavalry" && !actor.mounted ? nearestMountingPoint(context, actor) : null;
    const route = mount && groundPath(context, actor, mount);
    if (route) { setActorPath(actor, route.length ? route : [mount!], "militaryLeaving"); return; }
    actor.phase = "militaryField";
  };
  const reclaim = (ids: readonly number[]) => {
    for (const id of ids) {
      const soldier = soldiers.get(id), actor = actorById(id);
      if (!soldier || !actor || !isPlayerSoldier(soldier) || actor.navalOrder !== undefined) continue;
      if (RETURNING_MILITARY_PHASES.includes(actor.phase)) reclaimReturning(soldier, actor);
    }
  };
  /**
   * Marches to the nearest reachable open place around `point`; soldiers no way leads there for try
   * the next place. Returns the soldiers that go.
   */
  const marchNear = (ids: readonly number[], point: SettlementPoint, mode: OrderMode, gathering = false) => {
    const marching: number[] = [];
    let waiting = [...new Set(ids)];
    for (const target of orderTargetCandidates(context, point)) {
      if (!waiting.length) break;
      const accepted = new Set(combat.march(waiting, target, mode, gathering));
      marching.push(...accepted);
      waiting = waiting.filter(id => !accepted.has(id));
    }
    return marching;
  };
  /** A ground order: the soldiers that accepted it (the Shift queue keeps exactly those as its group). */
  const commandAccepted = (ids: readonly number[], point: SettlementPoint, mode: OrderMode = "attackMove") => {
    reclaim(ids);
    const accepted = marchNear(ids, point, mode);
    for (const id of accepted) rallyParticipants.delete(id);
    return accepted;
  };
  const command = (ids: readonly number[], point: SettlementPoint, mode: OrderMode = "attackMove") =>
    commandAccepted(ids, point, mode).length > 0;
  /**
   * targetMilitary: an attack order to the enemy unit `uid` the player sees, after which the soldiers that
   * accepted it chase that unit (settlement-combat-chase). Refused with the reason, nothing changed.
   */
  const targetAccepted = (ids: readonly number[], uid: number): TargetMilitaryOutcome => {
    const refusal = combat.chase.refusal(uid);
    if (refusal) return { ok: false, reason: refusal };
    reclaim(ids);
    const accepted = marchNear(ids, actorById(uid)!, "attackMove");
    if (!accepted.length) return { ok: false, reason: "noTroops" };
    for (const id of accepted) rallyParticipants.delete(id);
    combat.chase.lock(accepted, uid);
    return { accepted, ok: true };
  };
  const target = (ids: readonly number[], uid: number): TargetMilitaryResult => {
    const outcome = targetAccepted(ids, uid);
    return outcome.ok ? { chasing: outcome.accepted.length, ok: true } : outcome;
  };
  const siege = (ids: readonly number[], uid: number) => {
    reclaim(ids);
    const reassigned: number[] = [];
    const accepted = combat.siege(ids, uid, reassigned);
    for (const id of reassigned) rallyParticipants.delete(id);
    return accepted;
  };
  const freeTroopIds = (types: readonly MilitaryTroopType[]) => {
    const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
    // Call-outs are group orders: units busy with a story action stay where the story put them (TRG5a).
    return [...soldiers.values()].filter(soldier => types.includes(troopType(soldier)) &&
      isFreePlayerTroop(soldier, actors.get(soldier.actor)) && !isStoryControlled(context, soldier.actor))
      .map(soldier => soldier.actor);
  };
  const freeTroops = () => TROOP_TYPES.map(type => {
    const actors = freeTroopIds([type]);
    return { type, count: actors.length, actors };
  });
  const hostileDoorAt = (point: SettlementPoint) => context.buildings.find(building =>
    Math.abs(building.x - point.x) <= building.width / 2 && Math.abs(building.z - point.z) <= building.depth / 2 &&
    combat.doors().some(door => door.building === building.uid && door.faction > 0));
  /** Plants or moves the banner; on an enemy building it stands at the door and marks the building. */
  const plantRally = (point: SettlementPoint) => {
    const building = hostileDoorAt(point);
    // A new explicit banner supersedes the old group. Failed placements keep it intact.
    if (building) { rallyParticipants.clear(); rally = { x: building.access.x, z: building.access.z, building: building.uid }; return true; }
    const ground = orderTargetCandidates(context, point, 1)[0];
    if (!ground) return false;
    rallyParticipants.clear();
    rally = { x: ground.x, z: ground.z };
    return true;
  };
  /** Foot soldiers that took up the siege of `uid` (riders and archers facing guards cannot). */
  const besiege = (ids: readonly number[], uid: number) => {
    if (!combat.siege(ids, uid)) return [];
    return ids.filter(id => soldiers.get(id)?.combat?.siege === uid);
  };
  /** Sends soldiers to the banner: an attack-move there, or a siege of the building it marks. */
  const gather = (ids: readonly number[]) => withMilitaryNavigationCache(context, () => {
    if (!rally || !ids.length) return 0;
    reclaim(ids);
    const besiegers = rally.building === undefined ? [] : besiege(ids, rally.building);
    const besieging = new Set(besiegers);
    const others = ids.filter(id => !besieging.has(id));
    // Rallied soldiers fight on the way and then guard the banner (they do not seek further).
    const marching = marchNear(others, rally, "attackMove", true);
    if (rally.building !== undefined) for (const id of [...besiegers, ...marching]) rallyParticipants.add(id);
    return besiegers.length + marching.length;
  });
  /** Idle in the field beside the banner already: a later call-out leaves its place unchanged. */
  const isAtRally = (id: number) => {
    const actor = actorById(id), state = soldiers.get(id)?.combat;
    return Boolean(rally && rally.building === undefined && actor?.phase === "militaryField" && !state?.destination &&
      DMath.hypot(actor.x - rally.x, actor.z - rally.z) <= RALLY_GATHERED_RADIUS);
  };
  /** Calls every free troop of `types` (stored or outside) to the banner, first moving it to `point`. */
  const callOut = (types: readonly MilitaryTroopType[], point?: SettlementPoint) => {
    if (point && !plantRally(point)) return 0;
    return gather(freeTroopIds(types).filter(id => !isAtRally(id)));
  };
  /** Recruits that reached their storage go on to the banner (owner 2026-10-13), or stay stored. */
  const sendRecruits = () => {
    for (const id of recruits) {
      const soldier = soldiers.get(id), phase = actorById(id)?.phase;
      // Still on its way in (walking, entering the storage door).
      if (soldier?.building === -2 && phase !== "militaryReserve") continue;
      recruits.delete(id);
      if (phase === "militaryReserve") gather([id]);
    }
  };
  /** Remove attack banners when the target is destroyed; a captured building keeps a plain rally point. */
  const update = () => {
    if (recruits.size) sendRecruits();
    if (rally?.building === undefined) return;
    const building = context.buildings.find(entry => entry.uid === rally!.building);
    const door = combat.doors().find(entry => entry.building === rally!.building);
    if (!building || door?.structure?.hp === 0) {
      rally = undefined; rallyParticipants.clear(); return;
    }
    if (isOwnBuilding(building)) {
      rally = { x: rally.x, z: rally.z };
      // Capture clears siege assignments. The capturer stays stationed; free survivors guard the banner.
      const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
      const survivors = [...rallyParticipants].filter(id => {
        const soldier = soldiers.get(id);
        return soldier && isFreePlayerTroop(soldier, actors.get(id));
      });
      rallyParticipants.clear();
      gather(survivors);
    }
  };
  return {
    callOut, command, commandAccepted, freeTroops, gather, plantRally, reclaim, siege, target, targetAccepted,
    update,
    forgetRallyParticipants: (ids: readonly number[]) => { for (const id of ids) rallyParticipants.delete(id); },
    /** A new soldier leaving the Tavern for storage: it joins the banner once stored there. */
    welcome: (id: number) => { recruits.add(id); },
    /** Removes the banner; every soldier still on its way there (or besieging for it) gives up. */
    cancelRally: () => {
      const participants = [...rallyParticipants];
      rally = undefined; rallyParticipants.clear();
      const stranded = combat.cancelRally(participants);
      if (stranded.length) regatherStranded?.(stranded);
    },
    onRallyStranded: (handler: (ids: readonly number[]) => void) => { regatherStranded = handler; },
    rally: () => rally && { ...rally },
    save: () => rally && { ...rally,
      ...(rally.building !== undefined ? { participants: [...rallyParticipants].filter(id => {
        const soldier = soldiers.get(id);
        return soldier && isPlayerSoldier(soldier) && (soldier.combat?.hp ?? 1) > 0;
      }) } : {}) },
    restore: (saved?: MilitaryRallySave) => {
      rally = saved && { x: saved.x, z: saved.z, ...(saved.building !== undefined ? { building: saved.building } : {}) };
      rallyParticipants.clear();
      const participants = saved?.participants ?? (saved?.building === undefined ? [] :
        [...soldiers.values()].filter(soldier => soldier.combat?.siege === saved.building).map(soldier => soldier.actor));
      for (const id of participants) rallyParticipants.add(id);
    }
  };
};
