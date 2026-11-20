import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import type { MilitaryCombatant } from "./military-combat-rules";
import {
  assignFormationSlots, assignGroupFormation, type FormationKind, groupMarchPaces
} from "./military-formation";
import { canLeaveGarrison } from "./military-garrison-preservation";
import { isSingleLeg } from "./military-long-routes";
import type { FlowProof } from "./military-movement";
import type { createMilitaryRiders } from "./military-riders";
import { createMilitaryReach, followCorridor, militaryLegPath } from "./military-routing";
import type { MilitaryOrder } from "./military-targeting";
import { nationMilitarySpeedFactor } from "./nation-bonuses";
import { type CombatCore, freshFieldMemory } from "./settlement-combat-core";
import type { createCombatMounting } from "./settlement-combat-mounting";
import { exitPath, isOwnDoorLane } from "./settlement-entrance";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** Troops sent to a banner beyond this distance run; cavalry rides ahead at its own full speed. */
const RALLY_RUN_DISTANCE = 8;

/** Where a soldier stands in a group formation. */
const formationKind = (state: MilitaryCombatant): FormationKind => {
  if (state.type === "cavalry") return "rider";
  return state.type === "archer" ? "archer" : "foot";
};

/**
 * Places at the destination. Attack moves and rallies gather tightly by kind: foot melee in a
 * block, archers just behind, riders on the flanks with a horse's room. Plain moves and retreats
 * keep one evenly spaced block (2.6 with riders) whose rows follow the soldiers' order, so a group
 * turning about never has to cut through itself (the reverse-jitter fix).
 */
const formationSlots = (context: SettlementContext, starts: readonly SettlementPoint[],
  destination: SettlementPoint, states: readonly MilitaryCombatant[], mode: MilitaryOrder | undefined) => {
  const clear = (point: SettlementPoint, kind: FormationKind) =>
    isNavigationClear(context, point) && (kind !== "rider" || isMountedNavigationClear(context, point));
  if (mode === "attackMove") return assignGroupFormation(starts, states.map(formationKind), destination, clear);
  const mounted = states.some(state => state.type === "cavalry");
  const kind: FormationKind = mounted ? "rider" : "foot";
  return assignFormationSlots(starts, destination, mounted ? 2.6 : .5, point => clear(point, kind));
};

/** A group ordered together marches at its slowest member's pace and arrives as one block. */
const paceGroup = (members: readonly { goal: SettlementPoint; start: SettlementPoint;
  state: MilitaryCombatant }[], speedFactor = 1) => {
  if (members.length < 2) return;
  const paces = groupMarchPaces(members.map(({ goal, start, state }) =>
    ({ goal, speed: MILITARY_PROFILES[state.type].speed * speedFactor, start })));
  members.forEach(({ state }, index) => {
    state.marchSpeed = state.rallyRunning ? undefined : paces[index];
  });
};

const runsToRally = (start: SettlementPoint, destination: SettlementPoint) =>
  DMath.hypot(start.x - destination.x, start.z - destination.z) > RALLY_RUN_DISTANCE;

interface OrderServices {
  mounting: ReturnType<typeof createCombatMounting>;
  riders: ReturnType<typeof createMilitaryRiders>;
}

/** March orders: leaving buildings, formation places, group paces and routes planned over ticks. */
export const createCombatOrders = ({
  actorById, arriving, context, initialize, marches, memories, memoryOf, mountChecks, mounts, movement,
  pendingMarches, settling, sieges, soldiers, steering
}: CombatCore, { mounting, riders }: OrderServices) => {
  const { prepareLedDeparture } = mounting;
  /**
   * Any new march order ends a targetMilitary lock and the soldier's Shift queue membership (targetMilitary
   * locks, and the queue re-enlists, after their own march).
   */
  const clearOrderLocks = (id: number) => {
    const state = soldiers.get(id)?.combat;
    if (state?.chase) state.chase = undefined;
    if (state?.queue !== undefined) state.queue = undefined;
  };
  /** Where an ordered soldier starts its march: the field, or the way out of its building. */
  const departure = (id: number, faction: number) => {
    if (context.commanderControl && !context.commanderControl.prepareOrder(id)) return null;
    const soldier = soldiers.get(id), actor = actorById(id);
    if (!soldier || !actor || actor.navalOrder !== undefined || sieges.isDefender(id) ||
      initialize(soldier).faction !== faction) return null;
    if (faction === 0 && !canLeaveGarrison(context, actor)) return null;
    const leaving = soldier.stationed || actor.phase === "militaryReserve";
    if (!leaving && !["militaryField", "militaryLeaving", "militarySiege"].includes(actor.phase)) return null;
    const state = initialize(soldier);
    if (!leaving) {
      const exiting = actor.phase === "militaryLeaving";
      const inDoor = exiting && isOwnDoorLane(context, actor, actor);
      const start = inDoor ? actor.path.at(-1) ?? actor : actor;
      const mountOnClear = Boolean(state.mountOnClear || (exiting && !inDoor &&
        state.type === "cavalry" && !actor.mounted));
      return { actor, mountOnClear, soldier, state, start: start as SettlementPoint };
    }
    const building = context.buildings.find(entry => entry.uid === actor.building);
    if (!building) return null;
    const exit = exitPath(building);
    const mount = exit && state.type === "cavalry" ? mounts.choose(actor, building, exit.at(-1)!) : undefined;
    if (mount && exit) exit.push(...mount.path);
    const start = exit?.at(-1) ?? building.access;
    const mountOnClear = state.type === "cavalry" && !mount;
    return { actor, exit, mountOnClear, soldier, state, start };
  };
  type Departure = NonNullable<ReturnType<typeof departure>>;
  /** `path`: the way to `goal` already searched for the order, walked at once from the field. */
  const dispatch = ({ actor, exit, soldier, state, ...departure }: Departure, goal: SettlementPoint,
    mode: MilitaryOrder, path: SettlementPoint[] | null, preservePace = false, preserveMovement = false) => {
    sieges.cancel(actor.uid); settling.forget(actor.uid); arriving.leave(actor.uid);
    mountChecks.delete(actor.uid); if (!preserveMovement) movement.leave(actor.uid);
    // A new order starts from a stand: an about-turn is a stop and a turn, not a skid.
    const carried = freshFieldMemory(memories.get(actor.uid));
    memories.delete(actor.uid); riders.forget(actor.uid); steering.halt(actor.uid);
    if (carried) memories.set(actor.uid, carried);
    state.destination = { ...goal }; state.routeAge = 0; state.siege = undefined;
    state.order = mode; state.target = undefined; state.pendingTarget = undefined; state.returnToStorage = undefined;
    state.closeQuarters = undefined; if (!preservePace) state.marchSpeed = undefined;
    state.rallyRunning = undefined;
    // The old way is dropped at once: a soldier waits for its new route rather than walking on.
    const outdoorExit = actor.phase === "militaryLeaving" && !isOwnDoorLane(context, actor, actor);
    if (actor.phase === "militaryField" || outdoorExit) {
      actor.path = []; actor.pathIndex = 0; actor.queueTarget = undefined;
      actor.queueWait = 0; actor.phase = "militaryField"; state.pendingRoute = undefined;
      if (outdoorExit && "mountOnClear" in departure && departure.mountOnClear) {
        state.mountOnClear = true; state.dismounted = true;
      }
      if (path) { setActorPath(actor, path, "militaryField"); state.routeAge = .5; }
    }
    if (!exit) {
      if (actor.phase === "militaryLeaving") state.pendingRoute = path?.map(point => ({ ...point }));
      return;
    }
    state.pendingRoute = path?.map(point => ({ ...point }));
    state.mountOnClear = "mountOnClear" in departure && departure.mountOnClear ? true : undefined;
    state.dismounted = state.mountOnClear ? true : undefined;
    soldier.stationed = false; soldier.building = -3; actor.mounted = false;
    setActorPath(actor, exit, "militaryLeaving");
  };
  /** New places and paces for a long march's group from where its members are now. */
  const regroup = (uids: readonly number[], destination: SettlementPoint) => {
    const members = uids.flatMap(uid => {
      const actor = actorById(uid), state = soldiers.get(uid)?.combat;
      return actor && state?.destination && actor.phase === "militaryField" ? [{ actor, state }] : [];
    });
    const goals = formationSlots(context, members.map(({ actor }) => actor), destination,
      members.map(({ state }) => state), members[0]?.state.order);
    members.forEach(({ state }, index) => { state.destination = goals[index] ?? state.destination; });
    const factor = members[0]?.state.faction === 0 ? nationMilitarySpeedFactor(context.playerNation) : 1;
    paceGroup(members.map(({ actor, state }) => ({ goal: state.destination!, start: actor, state })), factor);
  };
  /**
   * A large order: every member waits for its turn, one per tick in `planQueuedMarch` (the pacing
   * keeps a crowd from jamming a passage). A flow group's members are proved on the shared field
   * (`bounds`: the proof's box, so the group shares its fields); the others search their own route.
   */
  const queueMarch = (departures: readonly Departure[], goals: readonly (SettlementPoint | null)[],
    destination: SettlementPoint, faction: number, mode: MilitaryOrder, gathering: boolean,
    bounds?: FlowProof["bounds"]) => {
    const accepted = departures.flatMap((entry, index) => {
      const goal = goals[index];
      if (!goal || (faction === 0 && !canLeaveGarrison(context, entry.actor))) return [];
      movement.leave(entry.actor.uid);
      if (entry.actor.phase === "militaryField") {
        entry.actor.path = []; entry.actor.pathIndex = 0; entry.actor.action = "idle";
        entry.state.target = undefined; entry.state.siege = undefined; entry.state.pendingRoute = undefined;
      }
      entry.state.destination = { ...goal }; entry.state.order = mode;
      pendingMarches.set(entry.actor.uid, { uid: entry.actor.uid, goal: { ...goal },
        destination: { ...destination }, faction, mode, gathering });
      return [entry.actor.uid];
    });
    const members = departures.filter(entry => pendingMarches.has(entry.actor.uid));
    movement.join(members.map(entry => ({ start: entry.start, uid: entry.actor.uid })), destination, faction, bounds);
    for (const entry of members) {
      const job = pendingMarches.get(entry.actor.uid);
      if (job && entry.state.destination) job.goal = { ...entry.state.destination };
    }
    paceGroup(members.map(entry => ({ start: entry.start, state: entry.state,
      goal: entry.state.destination! })),
    faction === 0 ? nationMilitarySpeedFactor(context.playerNation) : 1);
    return accepted;
  };
  interface Marching { goal: SettlementPoint; mounted: boolean; start: SettlementPoint; state: MilitaryCombatant; uid: number }
  interface OrderMember { entry: Departure; goal: SettlementPoint }
  /**
   * A flow group order (V08, D-V3): a member whose start tile the shared field reaches is dispatched
   * without an order-time path and walks by the flow from its first plan; fine detours and a spot it
   * cannot fit are handled on the way. A rider with no horse's way out is led out on foot, as before.
   */
  const flowMarch = (members: readonly OrderMember[], proof: FlowProof, destination: SettlementPoint,
    faction: number, mode: MilitaryOrder, gathering: boolean) => {
    const marching: Marching[] = [];
    for (const { entry, goal } of members) {
      let mounted = entry.state.type === "cavalry" && !("mountOnClear" in entry && entry.mountOnClear);
      let path: SettlementPoint[] | null = null;
      if (!proof.reaches(entry.start, mounted)) {
        path = entry.actor.mounted ? prepareLedDeparture(entry.actor, goal) : null;
        if (!path) continue;
        if (!entry.actor.mounted) { mounted = false; entry.mountOnClear = true; }
      }
      dispatch(entry, goal, mode, path);
      if (gathering && runsToRally(entry.start, destination)) entry.state.rallyRunning = true;
      marching.push({ goal, mounted, start: entry.start, state: entry.state, uid: entry.actor.uid });
    }
    movement.join(marching.map(({ start, uid }) => ({ start, uid })), destination, faction, proof.bounds);
    paceGroup(marching, faction === 0 ? nationMilitarySpeedFactor(context.playerNation) : 1);
    return marching.map(({ uid }) => uid);
  };
  /** Orders soldiers to march; returns the ids that accepted the order. */
  const march = (ids: readonly number[], destination: SettlementPoint, faction = 0,
    mode: MilitaryOrder = "attackMove", gathering = false, queued = true) => {
    if (!isNavigationClear(context, destination)) return [];
    for (const id of ids) { pendingMarches.delete(id); clearOrderLocks(id); }
    const departures = [...new Set(ids)].flatMap(id => departure(id, faction) ?? []);
    const goals = formationSlots(context, departures.map(entry => entry.start), destination,
      departures.map(entry => entry.state), mode);
    const members = departures.flatMap((entry, index): OrderMember[] => {
      const goal = goals[index];
      return goal && (faction !== 0 || canLeaveGarrison(context, entry.actor)) ? [{ entry, goal }] : [];
    });
    const proof = movement.prove(members.map(({ entry }) => entry.start), destination);
    if (queued && departures.length > 8) {
      return queueMarch(departures, goals, destination, faction, mode, gathering, proof?.bounds);
    }
    if (proof) return flowMarch(members, proof, destination, faction, mode, gathering);
    const canReach = createMilitaryReach(context, destination);
    const marching: Marching[] = [];
    departures.forEach((entry, index) => {
      if (faction === 0 && !canLeaveGarrison(context, entry.actor)) return;
      const goal = goals[index];
      let mounted = entry.state.type === "cavalry" &&
        !("mountOnClear" in entry && entry.mountOnClear);
      const route = goal && canReach(entry.start, goal, mounted);
      if (!goal) return;
      const start = { ...entry.actor, ...entry.start, mounted };
      const leg = route?.path ? undefined : marches.nextLeg(start, goal);
      let path = route && (route.path ?? (leg && followCorridor(context, start, leg.via, mounted)));
      if (!path && entry.actor.mounted) {
        path = prepareLedDeparture(entry.actor, goal);
        if (path && !entry.actor.mounted) { mounted = false; entry.mountOnClear = true; }
      }
      if (!path) return;
      dispatch(entry, goal, mode, path);
      if (gathering && runsToRally(entry.start, destination)) entry.state.rallyRunning = true;
      marching.push({ goal, mounted, start: entry.start, state: entry.state, uid: entry.actor.uid });
    });
    movement.join(marching.map(({ start, uid }) => ({ start, uid })), destination, faction);
    paceGroup(marching, faction === 0 ? nationMilitarySpeedFactor(context.playerNation) : 1);
    return marching.map(({ uid }) => uid);
  };
  /** One route per simulation step: deterministic work order; no delayed wall-clock callbacks. */
  /** Single legs get the full search; longer goals keep the corridor march. */
  const queuedMarchPath = (start: SettlementActor, goal: SettlementPoint, mounted: boolean) => {
    if (isSingleLeg(start, goal)) return militaryLegPath(context, start, goal, mounted);
    const leg = marches.nextLeg(start, goal);
    return leg && followCorridor(context, start, leg.via, mounted);
  };
  const planQueuedMarch = () => {
    const job = pendingMarches.values().next().value;
    if (!job) return;
    pendingMarches.delete(job.uid);
    const entry = departure(job.uid, job.faction);
    if (!entry || (job.faction === 0 && !canLeaveGarrison(context, entry.actor))) return;
    const siege = entry.state.siege;
    let mounted = entry.state.type === "cavalry" && !("mountOnClear" in entry && entry.mountOnClear);
    const start = { ...entry.actor, ...entry.start, mounted };
    // A flow group's member is proved on the shared field and walks by the flow from its first plan.
    const flow = movement.reaches(job.uid, start, mounted);
    let path = flow === undefined ? queuedMarchPath(start, job.goal, mounted) : null;
    let accepted = flow === true || path !== null;
    if (!accepted && entry.actor.mounted) {
      path = prepareLedDeparture(entry.actor, job.goal);
      accepted = path !== null;
      if (path && !entry.actor.mounted) { mounted = false; entry.mountOnClear = true; }
    }
    if (!accepted) {
      // A queued order is pending until proved. Failed routes release the siege assignment.
      entry.state.siege = undefined; entry.state.destination = undefined;
      entry.state.order = undefined; movement.leave(job.uid);
      return;
    }
    dispatch(entry, job.goal, job.mode, path, true, true);
    if (siege !== undefined) {
      entry.state.siege = siege;
      if (!mounted) entry.state.destination = undefined;
    }
    if (job.gathering) {
      memoryOf(job.uid).guardOnArrival = true;
      if (runsToRally(entry.start, job.destination)) entry.state.rallyRunning = true;
    }
  };
  const command = (ids: readonly number[], destination: SettlementPoint, faction = 0,
    mode: MilitaryOrder = "attackMove") => march(ids, destination, faction, mode).length > 0;
  return { command, march, planQueuedMarch, regroup };
};

export type CombatOrders = ReturnType<typeof createCombatOrders>;
