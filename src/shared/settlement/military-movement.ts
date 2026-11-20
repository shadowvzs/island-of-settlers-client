import { type MilitaryAiMode, SHIPPED_MILITARY_AI_MODE } from "./military-ai-mode";
import type { MilitaryCombatant } from "./military-combat-rules";
import {
  flowBounds,
  flowCellCentre,
  flowCost,
  flowDirection,
  flowWaypoint,
  type MilitaryFlowField
} from "./military-flow-field";
import { flowFieldAt } from "./military-flow-field-cache";
import { createCorridorReach, LANE_SHARES, routeRevision } from "./military-long-routes";
import { isLineClear } from "./military-routing";
import { distanceBetween } from "./settlement-geometry";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Movement layer of the shipped military AI mode (docs/archive/dated/military-motion-2026-10-13.md section 10):
 * a group ordered together follows its flow field. Each soldier has exactly one movement owner at a
 * time: its own A* route ("path") or the group's flow field ("flow"). A hand-over keeps the
 * soldier's velocity (no stop, no jitter) and lets the new owner plan at once. JSON-safe controller
 * state preserves live owners across saves. A removed formation mode may have saved a "slot" owner;
 * it loads as "path" and is re-planned by the flow field on the next tick.
 */
export type MovementOwner = "path" | "flow";
/** Owner ids a pre-FUTURE-07 save may contain (formation slots were removed). */
export type SavedMovementOwner = MovementOwner | "slot";

export interface MovementMember {
  uid: number;
  /** Where the soldier starts the order (the group's flow bounds cover it). */
  start: SettlementPoint;
}

type FlowBounds = ReturnType<typeof flowBounds>;
/** The shared-field proof of a group order (D-V3): the box the group's fields cover and each start's answer. */
export interface FlowProof {
  bounds: FlowBounds;
  /** True when the whole tile under `start` has a finite flow cost on the field for its kind of ground. */
  reaches: (start: SettlementPoint, mounted: boolean) => boolean;
}

interface MovementGroup {
  id: number;
  faction: number;
  destination: SettlementPoint;
  bounds: ReturnType<typeof flowBounds>;
  members: Map<number, MovementMember>;
  /** Flow field per kind of ground (false: foot, true: riders); built when first walked. */
  fields: Map<boolean, MilitaryFlowField>;
  /** Route revision at which this group last built or confirmed each field (fields may be shared). */
  fieldRevisions: Map<boolean, string>;
  /** Whole-island corridor flood to the destination, for a start the bounded fields miss (lazy). */
  reach?: ReturnType<typeof createCorridorReach>;
}

type SavedMovementGroup = Omit<MovementGroup, "fieldRevisions" | "fields" | "members" | "reach"> & {
  members: MovementMember[];
};

export interface MilitaryMovementSave {
  clock: number;
  nextGroup: number;
  handovers: number;
  groups: SavedMovementGroup[];
  owners: [number, SavedMovementOwner][];
  flowRetry: [number, number][];
  stillWatch: [number, SettlementPoint & { since: number }][];
}

/** A group order shorter than this (tiles, group centre to destination) walks by A*. */
const SHORT_TRIP = 10;
/** Fewer members than this walk by A* (a single unit). */
const FLOW_GROUP_MINIMUM = 2;
/** Within this distance of its own place (or the group's destination) a soldier leaves the flow for A*. */
const FLOW_HANDOFF = 6;
/** Seconds a soldier that found no flow point walks its own route before it tries the field again. */
const FLOW_RETRY = 2;
/** Seconds a flow waypoint is walked before the next is looked up (unless reached sooner). */
const FLOW_REFRESH = 0.5;
/**
 * A soldier further than this (tiles) from its flow point that has not left a spot this wide for this
 * long (seconds) is stranded behind bodies (a siege queue, a standing block): its own route (with the
 * steering's detours) leads it for `FLOW_RETRY` seconds before it walks to the field again.
 */
const STRANDED_DISTANCE = 1;
const STILL_RADIUS = 0.3;
const STRANDED_PATIENCE = 1.5;
/** Spacing (tiles) of the flow arrows of the debug overlay. */
const ARROW_STRIDE = 2;

export interface MilitaryMovementOptions {
  stateOf: (id: number) => MilitaryCombatant | undefined;
}

const centreOf = (points: readonly SettlementPoint[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  z: points.reduce((sum, point) => sum + point.z, 0) / points.length
});

const isClearFor = (context: SettlementContext, point: SettlementPoint, mounted: boolean) =>
  isNavigationClear(context, point) && (!mounted || isMountedNavigationClear(context, point));
/** Single soldiers and short trips are left to A*; the rest follow a flow field. */
const isFlowOrder = (starts: readonly SettlementPoint[], destination: SettlementPoint) =>
  starts.length >= FLOW_GROUP_MINIMUM && distanceBetween(centreOf(starts), destination) > SHORT_TRIP;
/**
 * The group's field for this kind of ground. Within one route revision it is kept as it is; after a
 * change it is rebuilt unless nothing in its region changed (or an equal shared field is fresh).
 */
const fieldOf = (context: SettlementContext, group: MovementGroup, mounted: boolean) => {
  const known = group.fields.get(mounted), revision = routeRevision(context);
  if (known && group.fieldRevisions.get(mounted) === revision) return known;
  const field = flowFieldAt(context, known, group.destination, mounted, group.bounds, revision);
  group.fields.set(mounted, field);
  group.fieldRevisions.set(mounted, revision);
  return field;
};

const flowArrows = (field: MilitaryFlowField, budget: number) => {
  const arrows: { dx: number; dz: number; x: number; z: number }[] = [];
  const stride = Math.max(
    ARROW_STRIDE,
    Math.ceil(Math.sqrt((field.width * field.height) / Math.max(1, budget)))
  );
  for (let z = 0; z < field.height; z += stride)
    for (let x = 0; x < field.width; x += stride) {
      if (arrows.length >= budget) return arrows;
      const cell = z * field.width + x;
      if (field.cost[cell] === Infinity) continue;
      const direction = flowDirection(field, cell),
        centre = flowCellCentre(field, cell);
      arrows.push({ dx: direction.x, dz: direction.z, x: centre.x, z: centre.z });
    }
  return arrows;
};
/** Debug overlay data: flow arrows per group target and owner counts. */
const movementDebug = (
  groups: ReadonlyMap<number, MovementGroup>,
  owners: ReadonlyMap<number, MovementOwner>,
  handovers: number
) => {
  const counts: Record<MovementOwner, number> = { flow: 0, path: 0 };
  for (const owner of owners.values()) counts[owner]++;
  const list = [...groups.values()].slice(0, 128);
  const fields = list.flatMap((group) => [...group.fields.values()]).slice(0, 64);
  return {
    flowFields: fields.map((field) => ({
      arrows: flowArrows(field, Math.floor(4096 / Math.max(1, fields.length))),
      goal: { ...field.goal },
      mounted: field.mounted
    })),
    handovers,
    owners: counts
  };
};

const saveGroups = (groups: ReadonlyMap<number, MovementGroup>): SavedMovementGroup[] =>
  [...groups.values()].map(({ fieldRevisions: _revisions, fields: _fields, members, reach: _reach, ...group }) => ({
    ...structuredClone(group),
    members: structuredClone([...members.values()])
  }));
const restoreGroups = (
  saved: readonly SavedMovementGroup[],
  groups: Map<number, MovementGroup>,
  groupOf: Map<number, number>
) => {
  for (const entry of saved) {
    const group: MovementGroup = {
      bounds: structuredClone(entry.bounds),
      destination: structuredClone(entry.destination),
      faction: entry.faction,
      fieldRevisions: new Map(),
      fields: new Map(),
      id: entry.id,
      members: new Map(entry.members.map((member) => [
        member.uid, { start: { x: member.start.x, z: member.start.z }, uid: member.uid }
      ]))
    };
    groups.set(group.id, group);
    for (const uid of group.members.keys()) groupOf.set(uid, group.id);
  }
};

export const createMilitaryMovement = (
  context: SettlementContext,
  options: MilitaryMovementOptions
) => {
  const { stateOf } = options;
  let nextGroup = 1,
    handovers = 0;
  const groups = new Map<number, MovementGroup>();
  const groupOf = new Map<number, number>();
  const owners = new Map<number, MovementOwner>();
  /** Game clock (seconds) and when a soldier that found no flow point tries the field again. */
  const flowRetry = new Map<number, number>();
  /** Where a soldier on the flow last stood still and since when; when it tries the field again. */
  const stillWatch = new Map<number, SettlementPoint & { since: number }>();
  let clock = 0;

  /** Sets the soldier's owner; a change lets the new owner plan at once (the velocity is kept). */
  const own = (uid: number, owner: MovementOwner) => {
    const previous = owners.get(uid) ?? "path";
    owners.set(uid, owner);
    if (previous === owner) return;
    handovers++;
    const state = stateOf(uid);
    if (state) state.routeAge = 0;
  };
  const leave = (uid: number) => {
    const group = groups.get(groupOf.get(uid) ?? -1);
    groupOf.delete(uid);
    owners.delete(uid);
    flowRetry.delete(uid);
    stillWatch.delete(uid);
    if (!group) return;
    group.members.delete(uid);
    if (!group.members.size) groups.delete(group.id);
  };

  /**
   * Registers a group ordered together (`bounds`: the box its fields cover, by default round the
   * members and the destination; an order proved on a shared field passes the proof's box so the
   * group shares that field). False when the order is left to A*.
   */
  const join = (
    members: readonly MovementMember[],
    destination: SettlementPoint,
    faction: number,
    bounds?: FlowBounds
  ) => {
    for (const member of members) leave(member.uid);
    const starts = members.map((member) => member.start);
    if (!isFlowOrder(starts, destination)) return false;
    const group: MovementGroup = {
      bounds: bounds ?? flowBounds(context, [...starts, destination]),
      destination: { ...destination },
      faction,
      fieldRevisions: new Map(),
      fields: new Map(),
      id: nextGroup++,
      // The start point only (callers may pass the soldier itself, which walks on).
      members: new Map(members.map(({ start, uid }) => [uid, { start: { x: start.x, z: start.z }, uid }]))
    };
    groups.set(group.id, group);
    for (const member of members) groupOf.set(member.uid, group.id);
    return true;
  };
  /**
   * The shared-field proof of a group order (V08, owner decision D-V3): null unless the order is a
   * flow order; otherwise one flood per kind of ground, built on the box round every candidate start
   * and the destination, which the group joined with the same box then shares. A start is reachable
   * when its whole tile has a finite flow cost; a start the bounded field misses (a route winding
   * beyond the box) is proved by the whole-island corridor flood instead, so the field's box never
   * refuses a reachable member. Fine detours are found on the way.
   */
  const prove = (starts: readonly SettlementPoint[], destination: SettlementPoint): FlowProof | null => {
    if (!isFlowOrder(starts, destination)) return null;
    const bounds = flowBounds(context, [...starts, destination]), revision = routeRevision(context);
    const fields = new Map<boolean, MilitaryFlowField>(), corridorReaches = createCorridorReach(context, destination);
    const fieldFor = (mounted: boolean) => {
      const known = fields.get(mounted);
      if (known) return known;
      const field = flowFieldAt(context, undefined, destination, mounted, bounds, revision);
      fields.set(mounted, field);
      return field;
    };
    return { bounds, reaches: (start, mounted) =>
      flowCost(fieldFor(mounted), start) < Infinity || corridorReaches(start, mounted) };
  };
  /**
   * The same proof for a member of a joined group (a queued order plans its members over later
   * ticks): undefined when the soldier belongs to no flow group, so its own search decides.
   */
  const reaches = (uid: number, start: SettlementPoint, mounted: boolean) => {
    const group = groups.get(groupOf.get(uid) ?? -1);
    if (!group) return undefined;
    if (flowCost(fieldOf(context, group, mounted), start) < Infinity) return true;
    group.reach ??= createCorridorReach(context, group.destination);
    return group.reach(start, mounted);
  };

  /**
   * The next flow point of a soldier, shifted into its lane of the block where there is room: the
   * lane point must still lead on (cheaper than where the soldier stands) and lie in a clear line.
   */
  const flowPoint = (actor: SettlementActor, group: MovementGroup, goal: SettlementPoint) => {
    const mounted = Boolean(actor.mounted),
      field = fieldOf(context, group, mounted);
    const waypoint = flowWaypoint(context, field, actor);
    if (!waypoint) return null;
    const offset = { x: goal.x - group.destination.x, z: goal.z - group.destination.z },
      here = flowCost(field, actor);
    for (const share of LANE_SHARES) {
      const lane = { x: waypoint.x + offset.x * share, z: waypoint.z + offset.z * share };
      if (
        flowCost(field, lane) < here &&
        isClearFor(context, lane, mounted) &&
        isLineClear(context, actor, lane, mounted)
      )
        return lane;
    }
    return waypoint;
  };
  /** True once a soldier far from its flow point has stood still too long (its own route leads a while). */
  const isStranded = (actor: SettlementActor, point: SettlementPoint) => {
    const watch = stillWatch.get(actor.uid);
    if (
      distanceBetween(actor, point) <= STRANDED_DISTANCE ||
      !watch ||
      distanceBetween(actor, watch) > STILL_RADIUS
    ) {
      stillWatch.set(actor.uid, { since: clock, x: actor.x, z: actor.z });
      return false;
    }
    if (clock - watch.since < STRANDED_PATIENCE) return false;
    stillWatch.delete(actor.uid);
    return true;
  };
  const followFlow = (actor: SettlementActor, state: MilitaryCombatant, group: MovementGroup) => {
    const goal = state.destination!;
    // Near its own place or the block's middle (where the flow ends) its own route takes over.
    if (distanceBetween(actor, goal) <= FLOW_HANDOFF || distanceBetween(actor, group.destination) <= FLOW_HANDOFF)
      return false;
    const current = actor.path[actor.pathIndex];
    const refresh = Math.max(1.5, (actor.mounted ? 3.6 : 1.4) * 0.75);
    if ((flowRetry.get(actor.uid) ?? -Infinity) > clock) return false;
    // Held behind bodies (a siege queue across the way): its own route and the detours lead a while.
    if (owners.get(actor.uid) === "flow" && current && isStranded(actor, current)) {
      flowRetry.set(actor.uid, clock + FLOW_RETRY);
      return false;
    }
    if (
      owners.get(actor.uid) === "flow" &&
      (state.routeAge ?? 0) > 0 &&
      current &&
      distanceBetween(actor, current) > refresh
    )
      return true;
    const point = flowPoint(actor, group, goal);
    // Off the field (a rider where no horse fits): its own route leads on for a while (no flip-flop).
    if (!point) {
      flowRetry.set(actor.uid, clock + FLOW_RETRY);
      return false;
    }
    own(actor.uid, "flow");
    actor.path = [point];
    actor.pathIndex = 0;
    state.routeAge = FLOW_REFRESH;
    return true;
  };

  /**
   * Routes a soldier marching to its place `target` (its destination) when its group's flow field
   * owns it; false: its own A* route plans the way (then that is its owner).
   */
  const plan = (actor: SettlementActor, state: MilitaryCombatant, target: SettlementPoint) => {
    const group = groups.get(groupOf.get(actor.uid) ?? -1);
    const marching = group && state.destination && distanceBetween(target, state.destination) < 0.01;
    if (marching && followFlow(actor, state, group)) return true;
    own(actor.uid, "path");
    return false;
  };

  /** Quiet-island skip: no soldiers means the only saved state `update` advances is this clock. */
  const advanceClock = (dt: number) => { clock += dt; };
  /** Once per tick, before the soldiers move. */
  const update = (dt: number) => advanceClock(dt);

  const debug = () => movementDebug(groups, owners, handovers);
  const save = (): MilitaryMovementSave => ({
    clock,
    nextGroup,
    handovers,
    groups: saveGroups(groups),
    owners: [...owners],
    flowRetry: [...flowRetry],
    stillWatch: [...stillWatch].map(([uid, watch]) => [uid, { ...watch }])
  });
  const restore = (saved: MilitaryMovementSave | undefined) => {
    if (!saved) return;
    clock = saved.clock;
    nextGroup = saved.nextGroup;
    handovers = saved.handovers;
    restoreGroups(saved.groups, groups, groupOf);
    // Pre-FUTURE-07 saves could name a formation slot; the flow field owns the soldier again next tick.
    saved.owners.forEach(([uid, owner]) => owners.set(uid, owner === "slot" ? "path" : owner));
    saved.flowRetry.forEach(([uid, time]) => flowRetry.set(uid, time));
    saved.stillWatch.forEach(([uid, watch]) => stillWatch.set(uid, { ...watch }));
  };
  return {
    debug,
    save,
    restore,
    advanceClock,
    join,
    leave,
    mode: (): MilitaryAiMode => SHIPPED_MILITARY_AI_MODE,
    plan,
    prove,
    reaches,
    update,
    /** The movement owner of a soldier (A* when it has none). */
    ownerOf: (uid: number): MovementOwner => owners.get(uid) ?? "path",
    clear: () => {
      groups.clear();
      groupOf.clear();
      owners.clear();
      flowRetry.clear();
      stillWatch.clear();
      handovers = 0;
      clock = 0;
      nextGroup = 1;
    }
  };
};

export type MilitaryMovement = ReturnType<typeof createMilitaryMovement>;
