import { FLANK_ARRIVED, ORDER_HOLD_DECISIONS } from "../../balance/commander-roles";
import { CLOSING_RANGE } from "../../balance/military";
import type { MilitaryOrder } from "../military-targeting";
import { distanceBetween } from "../settlement-geometry";
import type { SettlementPoint } from "../settlement-types";
import { RETARGET, type SquadDispatch } from "./commander-orders";
import type { PositionChooser } from "./commander-position-choice";
import type { PositionMode } from "./commander-positions";
import { assignRoles, createRoleGroupSplitter, type RoleGroup } from "./commander-roles";
import { centreOf } from "./commander-squads";
import type { CommanderOrderOutcome } from "./commander-trace";
import type {
  CommanderAction,
  CommanderRole,
  CommanderRoleUse,
  CommanderUnit,
  RoleGroupMemory,
  SquadContext,
  SquadMemory,
  SquadOrder
} from "./commander-types";

/** Ages are capped here (the churn guard only compares with a few decisions). */
const MAX_AGE = 255;
const ATTACK_ORDERS: Readonly<Record<CommanderRole, MilitaryOrder>> = {
  // The flank walks round the enemy line (a march would turn into the first foe within 6 tiles) and fights
  // from its point on arrival, where the squad focus and the danger matrix pick its target (A14-2).
  flank: "move",
  front: "attackMove",
  // Attack-moved archers seek from their point on arrival (a computer `move` would make them camp there).
  overwatch: "attackMove",
  reserve: "move"
};

/** One role group's part of a decision, as the trace reports it. */
export interface RoleGroupOutcome {
  group: RoleGroupMemory;
  /** In reserve for its morale alone (reported apart from commander churn). */
  moraleRelief?: boolean;
  order: MilitaryOrder;
  ordered: number;
  outcome: CommanderOrderOutcome;
}

interface RoleOrderSources {
  chooser: PositionChooser;
  send: (
    members: readonly CommanderUnit[],
    action: CommanderAction,
    point: SettlementPoint,
    order: MilitaryOrder,
    resuming: boolean
  ) => Readonly<SquadDispatch>;
  /** A flank group begins its strike (its members get the strike's morale grace). */
  strikeBegins?: (members: readonly CommanderUnit[]) => void;
}

/** The squad's mode when it uses roles: attack and defend round a known enemy; else undefined (whole squad). */
export const roleModeOf = (
  action: CommanderAction,
  context: SquadContext,
  target: SquadOrder | undefined
): PositionMode | undefined => {
  if (!context.nearest) return undefined;
  if (action === "attack") return "attack";
  if (action !== "defend" || context.marching || target?.resuming) return undefined;
  return "defend";
};

const orderOf = (mode: PositionMode, role: CommanderRole): MilitaryOrder =>
  mode === "attack" ? ATTACK_ORDERS[role] : "move";

/**
 * Role-group orders of a squad (A14 plan §3.1-§3.2): the squad is split by troop type, each group gets a
 * role and its own point and order. A group's order is re-issued only when its role or the squad's action
 * changes, or its point moved `RETARGET` and it has held the last one `ORDER_HOLD_DECISIONS` decisions
 * (the churn guard). Returns the groups' memory and a reused list of the groups' outcomes.
 */
export const createRoleOrders = ({ chooser, send, strikeBegins }: RoleOrderSources) => {
  const split = createRoleGroupSplitter();
  const outcomes: RoleGroupOutcome[] = [];
  /** The role groups of the last squad ordered by roles (reused, valid until the next `decide`). */
  let groups: readonly RoleGroup[] = [];
  /** Reused: the members of a group that do not already head for (or stand at) its point. */
  const movers: CommanderUnit[] = [];

  /** Keeps the members that need the order: not already sent (or standing) near the point with it. */
  const moversOf = (members: readonly CommanderUnit[], point: SettlementPoint, order: MilitaryOrder) => {
    movers.length = 0;
    for (const unit of members)
      if (unit.order !== order || distanceBetween(unit.destination ?? unit, point) >= RETARGET) movers.push(unit);
    return movers;
  };

  /**
   * A flank group strikes once it reached its flank point (or its walk there ended, stopped by a fight on the way),
   * and keeps striking until its role or action ends.
   */
  const strikes = (group: RoleGroup, centre: SettlementPoint, last: SettlementPoint, standing?: RoleGroupMemory) =>
    standing?.strike !== undefined || distanceBetween(centre, last) < FLANK_ARRIVED ||
    group.members.every((unit) => !unit.marching);

  /** The group's standing point when it keeps its role in the same action (else undefined). */
  const standingPoint = (standing: RoleGroupMemory | undefined, group: RoleGroup, sameAction: boolean) =>
    sameAction && standing?.role === group.role ? standing.point : undefined;
  /** The churn guard: a standing point is kept while new, while no point is found or while it is near. */
  const holds = (last: SettlementPoint, point: SettlementPoint | undefined, age: number) =>
    age <= ORDER_HOLD_DECISIONS || !point || distanceBetween(last, point) < RETARGET;

  const decideGroup = (
    faction: number,
    action: CommanderAction,
    mode: PositionMode,
    group: RoleGroup,
    fallback: SettlementPoint | undefined,
    previous: SquadMemory | undefined,
    contact: boolean
  ): RoleGroupOutcome => {
    const { role, type } = group;
    // A flank launches only after contact: until the squad's front meets the enemy it marches with the squad.
    if (role === "flank" && mode === "attack" && !contact)
      return { group: { age: MAX_AGE, role, type }, order: orderOf(mode, role), ordered: 0, outcome: "unchanged" };
    const standing = previous?.groups?.find((entry) => entry.type === type);
    const last = standingPoint(standing, group, previous?.action === action);
    const age = Math.min(MAX_AGE, (standing?.age ?? MAX_AGE) + 1);
    const centre = centreOf(group.members);
    const striking = role === "flank" && mode === "attack" && last !== undefined &&
      strikes(group, centre, last, standing);
    const strike = striking ? Math.min(MAX_AGE, (standing?.strike ?? 0) + 1) : undefined;
    const order = striking ? "attackMove" : orderOf(mode, role);
    const point = striking ? chooser.strikeTarget(centre) : chooser.choose(faction, role, centre, last) ?? fallback;
    // The turn from walking round to striking goes out at once; later re-points keep the usual churn hold.
    const turning = strike === 1 && distanceBetween(last!, point!) >= RETARGET;
    if (last && !turning && holds(last, point, age))
      return { group: { age, point: last, role, strike, type }, order, ordered: 0, outcome: "unchanged" };
    if (!point) return { group: { age, role, type }, order, ordered: 0, outcome: "noTarget" };
    // A group that lost its squad id (its first member fell) already holds this order: no new one.
    const members = moversOf(group.members, point, order);
    if (!members.length) return { group: { age, point, role, strike, type }, order, ordered: 0, outcome: "unchanged" };
    const { ordered, outcome } = send(members, action, point, order, false);
    if (strike === 1 && outcome === "issued") strikeBegins?.(group.members);
    // A refused point is bad for this decision only: it is not remembered.
    const kept = outcome === "refused" ? undefined : point;
    return {
      group: { age: outcome === "issued" ? 0 : age, point: kept, role, strike, type }, order, ordered, outcome
    };
  };

  /**
   * Orders the squad's role groups; returns false (nothing done) when the squad has no frame to lay roles
   * out in, or defends with a single troop type, so the caller sends the whole squad as before.
   */
  const decide = (
    faction: number,
    squad: readonly CommanderUnit[],
    action: CommanderAction,
    mode: PositionMode,
    context: SquadContext,
    target: SquadOrder | undefined,
    previous: SquadMemory | undefined,
    roleUse: CommanderRoleUse
  ) => {
    outcomes.length = 0;
    groups = split(squad);
    // A defending squad of one type holds its post as a whole (nothing to lay out round it).
    if (mode === "defend" && groups.length < 2) return false;
    if (!chooser.setFrame(mode, context)) return false;
    assignRoles(groups, previous?.groups, roleUse);
    const front = groups.find((group) => group.role === "front");
    chooser.setFront(front && centreOf(front.members));
    const contact = context.view.enemyDistance <= CLOSING_RANGE;
    for (const group of groups) {
      const outcome = decideGroup(faction, action, mode, group, target?.point, previous, contact);
      outcome.moraleRelief = group.moraleRelief;
      outcomes.push(outcome);
    }
    return true;
  };
  return { begin: chooser.begin, decide, groups: () => groups, outcomes: outcomes as readonly RoleGroupOutcome[] };
};
