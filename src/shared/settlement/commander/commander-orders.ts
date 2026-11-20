import { CLOSING_RANGE } from "../../balance/military";
import { ROUTED_SQUADS_PER_DECISION, WAYPOINT_REACH } from "../../balance/retreat-route";
import { probeAccept } from "../faction-vision-probe";
import type { createCommanderObjectives } from "../military-commander-objectives";
import {
  enemyInfluence,
  INFLUENCE_CELL,
  influenceCellOf,
  type InfluenceMap,
  ownInfluence,
  writeInfluenceCellCentre
} from "../military-influence-map";
import type { MilitarySpatialGrid } from "../military-spatial-grid";
import type { MilitaryOrder } from "../military-targeting";
import { distanceBetween } from "../settlement-geometry";
import type { SettlementPoint } from "../settlement-types";
import { markTickPhase } from "../tick-phase-profile";
import { COMMANDER_MARCH_PHASE, COMMANDER_PHASE } from "./commander-phases";
import { createRetreatRouter } from "./commander-retreat-route";
import type { CommanderOrderOutcome } from "./commander-trace";
import type {
  CommanderAction,
  CommanderUnit,
  MilitaryCommanderOptions,
  SquadContext,
  SquadMemory,
  SquadOrder
} from "./commander-types";
import { HOME_RADIUS } from "./commander-utility";
import { isRetreatRouteTraceActive, traceRetreatRoute } from "./retreat-route-trace";

/** A new order goes out when the action changes or its target moved this far (tiles). */
export const RETARGET = 5;
/** A retreat's next leg (A14-3) goes out when it lies `WAYPOINT_REACH` from the last one; others `RETARGET`. */
export const retargetReach = (action: CommanderAction) => action === "retreat" ? WAYPOINT_REACH : RETARGET;
/** Influence cells searched round a squad for the safest ground. */
const RETREAT_CELLS = 4;
/** How much a cell further from the camp (in cells) scores less as safe ground. */
const HOME_PULL = 0.05;
const ORDERS: Readonly<Record<CommanderAction, MilitaryOrder>> = {
  attack: "attackMove",
  defend: "move",
  regroup: "move",
  retreat: "retreat"
};

interface SquadOrderSources {
  command: MilitaryCommanderOptions["command"];
  isClear: MilitaryCommanderOptions["isClear"];
  map: InfluenceMap;
  nearbyUnits: MilitarySpatialGrid<CommanderUnit>;
  objectives: ReturnType<typeof createCommanderObjectives>;
}

/** The result of sending a squad: what happened and how many soldiers took the order. */
export interface SquadDispatch {
  ordered: number;
  outcome: CommanderOrderOutcome;
}

const orderOf = (
  action: CommanderAction,
  point: SettlementPoint | undefined
): SquadOrder | undefined => point && { order: ORDERS[action], point, resuming: false };

/** Turns a squad's chosen action into a march order and sends it to the soldiers that may take it. */
export const createSquadOrders = (sources: SquadOrderSources) => {
  const { command, isClear, map, nearbyUnits, objectives } = sources;
  const candidate: SettlementPoint = { x: 0, z: 0 };
  const router = createRetreatRouter(map);
  /** Covered routes searched in the current faction decision (plan §8: ≤ `ROUTED_SQUADS_PER_DECISION`). */
  let routed = 0;
  /** Reused result of `execute`: read it before the next squad is sent. */
  const dispatch: SquadDispatch = { ordered: 0, outcome: "unchanged" };
  const dispatched = (outcome: CommanderOrderOutcome, ordered = 0) => {
    dispatch.ordered = ordered;
    dispatch.outcome = outcome;
    return dispatch;
  };

  /** The safest clear cell round the squad (most own strength over enemy strength), nearer home first. */
  const safestPoint = (faction: number, centre: SettlementPoint, home: SettlementPoint) => {
    const origin = influenceCellOf(map, centre),
      column = origin % map.columns,
      row = Math.floor(origin / map.columns);
    let bestCell = -1,
      bestScore = -Infinity;
    for (let dz = -RETREAT_CELLS; dz <= RETREAT_CELLS; dz++)
      for (let dx = -RETREAT_CELLS; dx <= RETREAT_CELLS; dx++) {
        const x = column + dx,
          z = row + dz;
        if (x < 0 || z < 0 || x >= map.columns || z >= map.rows) continue;
        const cell = z * map.columns + x;
        if (!isClear(writeInfluenceCellCentre(map, cell, candidate))) continue;
        const score =
          ownInfluence(map, faction, cell) -
          enemyInfluence(map, faction, cell) -
          (distanceBetween(candidate, home) / INFLUENCE_CELL) * HOME_PULL;
        if (score > bestScore) {
          bestCell = cell;
          bestScore = score;
        }
      }
    return bestCell < 0 ? undefined : writeInfluenceCellCentre(map, bestCell, { x: 0, z: 0 });
  };
  /** Defending, a squad turned aside from its own march marches on (else it walks back to its post). */
  const defendOrder = (context: SquadContext): SquadOrder | undefined => {
    const objective = objectives.of(context.squad);
    if (objective)
      return { order: objective.order, point: { x: objective.x, z: objective.z }, resuming: true };
    return context.view.homeDistance > HOME_RADIUS ? orderOf("defend", context.home) : undefined;
  };
  /**
   * A14-3 covered retreat (plan §3.4): the squad walks to the safest ground along a covered route, one leg at a
   * time. A leg it is still marching on stands; once the squad is within `WAYPOINT_REACH` of it (or stopped) the
   * next leg is routed from where it stands. Beyond the decision's route quota the squad goes straight.
   */
  const retreatTarget = (faction: number, context: SquadContext, memory: SquadMemory | undefined) => {
    const leg = memory?.action === "retreat" ? memory.target : undefined;
    if (leg && context.marching && distanceBetween(context.centre, leg) > WAYPOINT_REACH)
      return orderOf("retreat", leg);
    const goal = safestPoint(faction, context.centre, context.home);
    if (!goal || routed >= ROUTED_SQUADS_PER_DECISION) return orderOf("retreat", goal);
    routed++;
    const route = router.route(faction, context.centre, goal, isClear);
    if (route.blocked) return orderOf("retreat", goal);
    if (isRetreatRouteTraceActive())
      traceRetreatRoute({ exposure: route.exposure, expansions: route.expansions, faction, kind: "squad",
        reached: route.reached, straightExposure: route.straightExposure, uid: context.squad[0]!.uid });
    return orderOf("retreat", route.waypoints[0]);
  };
  const targetOf = (action: CommanderAction, faction: number, context: SquadContext, memory?: SquadMemory) => {
    if (action === "attack")
      return orderOf(action, context.nearest && { x: context.nearest.x, z: context.nearest.z });
    if (action === "retreat") return retreatTarget(faction, context, memory);
    if (context.marching) return undefined;
    if (action === "regroup") return orderOf(action, context.centre);
    return defendOrder(context);
  };
  const isClosing = (unit: CommanderUnit) =>
    unit.order === "attackMove" &&
    nearbyUnits.anyWithin(
      unit.x,
      unit.z,
      CLOSING_RANGE,
      probeAccept("commander.closing", unit.faction, (enemy: CommanderUnit) => enemy.faction !== unit.faction)
    );
  /** Fighting or closing soldiers and soldiers on their own retreat only take a retreat. */
  const takesOrder = (unit: CommanderUnit, action: CommanderAction) => {
    if (action === "retreat") return true;
    return !unit.fighting && !objectives.isOwnRetreat(unit) && !isClosing(unit);
  };
  /** Sends `members` (those that may take the order) to `point`; the march is the order layer's cost. */
  const send = (
    members: readonly CommanderUnit[],
    action: CommanderAction,
    point: SettlementPoint,
    order: MilitaryOrder,
    resuming: boolean
  ): Readonly<SquadDispatch> => {
    // A new array: the order layer may keep the ids of the march it plans.
    const ids: number[] = [];
    for (const unit of members) if (takesOrder(unit, action)) ids.push(unit.uid);
    if (!ids.length) return dispatched("noTaker");
    markTickPhase(COMMANDER_MARCH_PHASE);
    const accepted = command(ids, point, members[0]!.faction, order);
    markTickPhase(COMMANDER_PHASE);
    if (!accepted) return dispatched("refused", ids.length);
    objectives.lead(ids, resuming);
    return dispatched("issued", ids.length);
  };
  /** Sends the squad's soldiers (fighting or closing ones only on a retreat) unless the same order stands. */
  const execute = (
    squad: readonly CommanderUnit[],
    action: CommanderAction,
    target: SquadOrder | undefined,
    memory: SquadMemory | undefined
  ): Readonly<SquadDispatch> => {
    const unchanged =
      memory?.action === action &&
      (!target || (memory.target && distanceBetween(memory.target, target.point) < retargetReach(action)));
    if (unchanged) return dispatched("unchanged");
    if (!target) return dispatched("noTarget");
    return send(squad, action, target.point, target.order, target.resuming);
  };
  /** A faction decision begins: its route quota is fresh. */
  const begin = () => { routed = 0; };
  return { begin, execute, send, targetOf };
};
