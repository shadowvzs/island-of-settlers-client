import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";

/**
 * A14 commander decision trace for the fixtures (plan §10.2): reads the commander's debug decisions after every
 * tick (read only, outside the timed tick) and derives decision rounds per faction, the stagger (factions
 * deciding in one tick), the order churn and the overwatch share. The order estimate mirrors the commander's
 * re-issue rule (`execute`: an order goes out unless the action is unchanged and the target moved less than
 * `RETARGET`); soldiers it would skip (fighting, closing) are not modelled. A14-1: a squad split into role groups
 * reports its groups; each group command issued counts as one order (exact, not estimated), its overwatch group's
 * point is the overwatch sample and its flank group's point is checked. A14-2: a whole squad reports `issued`
 * (exact) where the commit has it.
 */
interface TracedGroup {
  issued: boolean;
  moraleRelief?: boolean;
  strike?: boolean;
  role: string;
  target?: SettlementPoint;
  troop: string;
}
interface TracedDecision {
  action: string;
  groups?: readonly TracedGroup[];
  /** A14-2: a whole-squad decision reports whether it issued an order (exact; absent on older commits). */
  issued?: boolean;
  centre: SettlementPoint;
  faction: number;
  score: number;
  squad: number;
  target?: SettlementPoint;
}
interface SquadMemory { action: string; target?: SettlementPoint }

/** Commander `RETARGET` (tiles): a target that moved less keeps the standing order. */
const RETARGET = 5;
/** A flank group's point this far (tiles) off the line from the squad to its enemy is a flank point. */
const FLANK_OFFSET = 4;
const TICK_SECONDS = .05;

export interface DecisionMetrics {
  /** Decision rounds per computer faction. */
  rounds: Record<string, number>;
  /** Most computer factions deciding in a single tick (staggered: 1). */
  maxFactionsPerTick: number;
  /** Estimated commander orders per minute per squad, per faction and overall. */
  ordersPerMinutePerSquad: number | null;
  ordersPerMinutePerSquadByFaction: Record<string, number | null>;
  /** Decisions after first contact whose target lies in the fixture's overwatch area (null: no area). */
  overwatchDecisions: number | null;
  overwatchShare: number | null;
  /** Morale-driven reserve swaps per minute (commands; added to the morale log's `moraleOrdersPerMinute`). */
  moraleReserveOrdersPerMinute: number;
  /** Flank strike commands issued (a flank group that reached its point turned on the enemy's archers). */
  flankStrikes: number;
  /** Decisions whose flank group was sent to a flank point off the line between the squad and its enemy. */
  flankPointDecisions: number;
}

const signatureOf = (decisions: readonly TracedDecision[]) => decisions.map(decision =>
  `${decision.squad}:${decision.action}:${decision.score}:${decision.centre.x},${decision.centre.z}`).join("|");

const isUnchanged = (memory: SquadMemory | undefined, decision: TracedDecision) => {
  if (memory?.action !== decision.action) return false;
  if (!decision.target) return true;
  return Boolean(memory.target &&
    Math.hypot(memory.target.x - decision.target.x, memory.target.z - decision.target.z) < RETARGET);
};

/** Distance of `point` from the line through `from` and `to` (tiles; 0 when the line is degenerate). */
const offLine = (point: SettlementPoint, from: SettlementPoint, to: SettlementPoint) => {
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  return length < 1e-6 ? 0 : Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) / length;
};

/** The commander's churn hold (`ORDER_HOLD_DECISIONS`): a group's re-orders within it count as one command. */
const HOLD_ROUNDS = 3;

/** A whole squad's own `issued` flag, else (older commits) the estimate. */
const wholeSquadIssued = (decision: TracedDecision, unchanged: boolean) =>
  decision.issued ?? (!unchanged && decision.target !== undefined);

/**
 * Commander commands of one squad decision: one per role group (or whole squad) command issued, but a group's
 * role or point change within `HOLD_ROUNDS` of its last counted command is the same command. Morale-driven
 * reserve swaps are morale orders (`moraleOrders`), as are morale fall-backs and routs (morale trace).
 */
const countCommands = (trace: FactionTrace, decision: TracedDecision, unchanged: boolean) => {
  const issued = decision.groups ?? (wholeSquadIssued(decision, unchanged) ? [{ issued: true, troop: "all" }] : []);
  const keyOf = (troop: string) => `${decision.squad}:${troop}`;
  const changed = (group: TracedGroup) => trace.roles.get(keyOf(group.troop)) !== group.role;
  // A group sent to the reserve for its morale, and the group that takes its role in the same decision.
  const moraleSwap = decision.groups?.some(group => group.moraleRelief && changed(group)) ?? false;
  for (const group of issued) {
    if (!group.issued) continue;
    const swapped = "role" in group && (group.moraleRelief || (moraleSwap && changed(group)));
    if (swapped) { trace.moraleOrders++; continue; }
    const key = keyOf(group.troop), last = trace.counted.get(key);
    if (last !== undefined && trace.rounds - last < HOLD_ROUNDS) continue;
    trace.counted.set(key, trace.rounds);
    trace.orders++;
  }
  for (const group of decision.groups ?? []) trace.roles.set(keyOf(group.troop), group.role);
};

const isFlankPoint = (decision: TracedDecision) => {
  const flank = decision.groups?.find(group => group.role === "flank");
  return Boolean(flank?.target && decision.target &&
    offLine(flank.target, decision.centre, decision.target) >= FLANK_OFFSET);
};

/** The point an overwatch sample reads: the overwatch group's point of a split squad, else the squad's target. */
const overwatchPointOf = (decision: TracedDecision) =>
  decision.groups ? decision.groups.find(group => group.role === "overwatch")?.target : decision.target;

const insideArea = (point: SettlementPoint | undefined, area: readonly [number, number, number, number]) =>
  Boolean(point && point.x >= area[0] && point.z >= area[1] && point.x <= area[2] && point.z <= area[3]);

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

interface FactionTrace {
  memory: Map<number, SquadMemory>;
  /** Round of the last counted command per squad group (`squad:troop`): the churn hold window. */
  counted: Map<string, number>;
  /** Each squad group's role at its last decision (a morale swap moves two groups). */
  roles: Map<string, string>;
  moraleOrders: number;
  orders: number;
  rounds: number;
  signature: string;
  squadDecisions: number;
}

export const createDecisionTrace = (
  simulation: SettlementSimulation, factions: readonly number[],
  overwatchArea?: readonly [number, number, number, number]
) => {
  const traces = new Map<number, FactionTrace>(factions.map(faction => [faction,
    { counted: new Map(), memory: new Map(), moraleOrders: 0, orders: 0, roles: new Map(), rounds: 0, signature: "",
      squadDecisions: 0 }]));
  let maxFactionsPerTick = 0, overwatch = 0, afterContact = 0, ticks = 0, flankPoints = 0, strikes = 0;

  const countOrders = (trace: FactionTrace, decisions: readonly TracedDecision[]) => {
    const next = new Map<number, SquadMemory>();
    for (const decision of decisions) {
      const memory = trace.memory.get(decision.squad);
      const unchanged = isUnchanged(memory, decision);
      countCommands(trace, decision, unchanged);
      if (isFlankPoint(decision)) flankPoints++;
      strikes += decision.groups?.filter(group => group.strike && group.issued).length ?? 0;
      next.set(decision.squad, { action: decision.action, target: unchanged ? memory?.target : decision.target });
    }
    trace.memory = next;
    trace.squadDecisions += decisions.length;
  };

  const countOverwatch = (decisions: readonly TracedDecision[], contact: boolean) => {
    if (!overwatchArea || !contact) return;
    for (const decision of decisions) {
      if (decision.groups && !decision.groups.some(group => group.role === "overwatch")) continue;
      afterContact++;
      if (insideArea(overwatchPointOf(decision), overwatchArea)) overwatch++;
    }
  };

  /** After each tick: `contact` once the first blow fell. */
  const sample = (contact: boolean) => {
    ticks++;
    const decisions = simulation.militaryAiDebug().commander.decisions as readonly TracedDecision[];
    let deciding = 0;
    for (const [faction, trace] of traces) {
      const own = decisions.filter(decision => decision.faction === faction);
      const signature = signatureOf(own);
      if (!own.length || signature === trace.signature) continue;
      trace.signature = signature;
      trace.rounds++;
      deciding++;
      countOrders(trace, own);
      countOverwatch(own, contact);
    }
    maxFactionsPerTick = Math.max(maxFactionsPerTick, deciding);
  };

  const churnOf = (trace: FactionTrace) => {
    const minutes = ticks * TICK_SECONDS / 60;
    if (!trace.rounds || !minutes) return null;
    const meanSquads = trace.squadDecisions / trace.rounds;
    return round(trace.orders / meanSquads / minutes);
  };

  const summary = (): DecisionMetrics => {
    const all = [...traces.values()].filter(trace => trace.rounds > 0);
    const orders = all.reduce((sum, trace) => sum + trace.orders, 0);
    const minutes = ticks * TICK_SECONDS / 60;
    const squadMinutes = all.reduce((sum, trace) => sum + trace.squadDecisions / trace.rounds * minutes, 0);
    return {
      flankPointDecisions: flankPoints,
      flankStrikes: strikes,
      moraleReserveOrdersPerMinute: minutes ? round(all.reduce((sum, trace) => sum + trace.moraleOrders, 0) / minutes)
        : 0,
      maxFactionsPerTick,
      ordersPerMinutePerSquad: squadMinutes ? round(orders / squadMinutes) : null,
      ordersPerMinutePerSquadByFaction: Object.fromEntries([...traces].map(([faction, trace]) =>
        [String(faction), churnOf(trace)])),
      overwatchDecisions: overwatchArea ? overwatch : null,
      overwatchShare: overwatchArea ? round(overwatch / (afterContact || 1), 3) : null,
      rounds: Object.fromEntries([...traces].map(([faction, trace]) => [String(faction), trace.rounds]))
    };
  };
  return { sample, summary };
};
