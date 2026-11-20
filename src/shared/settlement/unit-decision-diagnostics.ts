import { PRODUCTION_OUTPUT_CAPACITY } from "../balance/economy";
import { SAWMILL_TYPE_ID } from "./building-type-ids";
import { STUCK_REPAIR_ATTEMPTS } from "./constants";
import type { MilitaryCombatant } from "./military-combat-rules";
import { countGoods, getBuildingProductionRule } from "./production-rules";
import { reservedInputReturns } from "./sawmill-input-returns";
import { buildingNation } from "./settlement-nation";
import type {
  ProductionRule,
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "./settlement-types";
import { workerPhaseClock } from "./worker-phase-spec";

/**
 * Read-only answer to "why is this unit not doing anything?". Every code is derived from state the
 * simulation already keeps; nothing here writes, reserves, saves or feeds back into a decision.
 */
export type UnitDecisionReasonCode =
  | "blocked-door"
  | "building-paused"
  | "commander-order"
  | "fighting"
  | "inactive"
  | "no-claim"
  | "no-path"
  | "no-work"
  | "queued"
  | "resting"
  | "retreating"
  | "search-budget"
  | "tool-missing"
  | "waiting"
  | "waiting-for-storage"
  | "waiting-for-ware"
  | "walking"
  | "working";

/** Stable presentation order of the reason codes (development overlay and tests). */
export const UNIT_DECISION_REASON_CODES: readonly UnitDecisionReasonCode[] = [
  "no-work", "no-claim", "waiting-for-ware", "waiting-for-storage", "tool-missing",
  "building-paused", "blocked-door", "queued", "no-path", "search-budget", "resting",
  "fighting", "retreating", "commander-order", "walking", "working", "waiting", "inactive"
];
export type UnitDecisionReasonCounts = Record<UnitDecisionReasonCode, number>;

export interface UnitDecisionDiagnostics {
  actor: number;
  /** Existing handler phase the code was read from. */
  phase: string;
  reason: UnitDecisionReasonCode;
}

/** Everything the derivation needs; small and explicit so tests can build it without a simulation. */
export interface UnitDecisionFacts {
  actor: Readonly<SettlementActor>;
  building?: Readonly<SettlementBuilding>;
  home?: Readonly<SettlementBuilding>;
  /** Input units on their bay that an assigned carrier already owns (sawmill returns). */
  inputReturns?: Readonly<Record<string, number>>;
  outputCapacity?: number;
  rule?: Readonly<ProductionRule>;
  soldier?: Readonly<MilitaryCombatant>;
}

export const emptyUnitDecisionReasonCounts = (): UnitDecisionReasonCounts =>
  Object.fromEntries(UNIT_DECISION_REASON_CODES.map(code => [code, 0])) as UnitDecisionReasonCounts;

const INACTIVE_PHASES = new Set([
  "aboard", "away", "commanderIncapacitated", "militaryDead", "navalAboard", "navalWaiting",
  "retired", "sailing"
]);
const CARRIER_IDLE_PHASES = new Set(["home", "idle", "inside", "rest"]);
const HORSE_IDLE_PHASES = new Set(["horseDead"]);
const NO_HANDCART_ROOM_STATUS = "No storage has room for another hand cart";
const WAITING_FOR_CONSTRUCTION_STATUS = "Waiting for construction supplies";
const WAITING_FOR_INPUTS_STATUS = "Waiting for inputs";
const WAITING_FOR_SAFE_ACCESS_STATUS = "Waiting for safe building access";
const TOOL_STATUS_PREFIX = "Waiting for ";

const isInactive = (phase: string) => INACTIVE_PHASES.has(phase);
const isBlockedPhase = (phase: string) =>
  phase.endsWith("Blocked") || ["blocked", "returnBlockedCarrier", "stranded"].includes(phase);

/** A visible worker that could not pass the door and waits one second before retrying. */
const isDoorBlocked = (actor: Readonly<SettlementActor>) => actor.phase === "workerRestWait";

/** Standing on a traffic/door/court shoulder, or walking to one. */
const isQueued = (actor: Readonly<SettlementActor>) =>
  Boolean(actor.queueTarget) && (actor.action === "idle" || actor.pathIndex >= actor.path.length);

/** The navigation watchdog proved there is no route, or a removed bridge cut the journey. */
const hasProvenNoRoute = (actor: Readonly<SettlementActor>) =>
  actor.navigationRecovery?.blocked === true || actor.bridgeWait !== undefined;

/** Repeated stuck-repair searches without a proof; every repair runs on a small visit budget. */
const isSearchBudgetExhausted = (actor: Readonly<SettlementActor>) => {
  const recovery = actor.navigationRecovery;
  return recovery !== undefined && recovery.blocked !== true &&
    recovery.attempts >= STUCK_REPAIR_ATTEMPTS;
};

const militaryReason = (
  actor: Readonly<SettlementActor>, soldier: Readonly<MilitaryCombatant> | undefined
): UnitDecisionReasonCode | undefined => {
  if (!soldier) return undefined;
  if (soldier.order === "retreat") return "retreating";
  if (soldier.target !== undefined || soldier.pendingTarget !== undefined || soldier.doorBlow ||
    soldier.siege !== undefined) return "fighting";
  if (actor.phase === "garrison" || actor.phase === "militaryReserve") return "resting";
  if (actor.phase === "militaryReturnBlocked") return "no-path";
  if (soldier.destination !== undefined) return "commander-order";
  if (actor.phase === "militarySiege") return "fighting";
  if (actor.phase === "militaryField") return "waiting";
  return undefined;
};

const bayStock = (building: Readonly<SettlementBuilding>, ware: string) => building.input[ware] ?? 0;

/** Mirrors `consumeInputs`: an alternative-food recipe accepts whichever single input is present. */
const inputsAvailable = (
  building: Readonly<SettlementBuilding>, rule: Readonly<ProductionRule>,
  inputReturns: Readonly<Record<string, number>> | undefined
) => {
  if (!rule.inputs.length) return true;
  const available = rule.alternativeFood
    ? rule.inputs.filter(ware => bayStock(building, ware) > 0).slice(0, 1)
    : rule.inputs;
  if (!available.length) return false;
  return available.every(ware => {
    const required = available.filter(entry => entry === ware).length;
    return bayStock(building, ware) - (inputReturns?.[ware] ?? 0) >= required;
  });
};

const waitingForStorage = (
  actor: Readonly<SettlementActor>, building: Readonly<SettlementBuilding>,
  rule: Readonly<ProductionRule>, outputCapacity: number
) => {
  if (actor.phase !== "inside") return false;
  if (building.status === NO_HANDCART_ROOM_STATUS) return true;
  if (actor.ware || actor.productionOutput) return false;
  return rule.outputs.length > 0 && countGoods(building.output) >= outputCapacity;
};

const missingTool = (
  actor: Readonly<SettlementActor>, building: Readonly<SettlementBuilding>,
  home: Readonly<SettlementBuilding> | undefined, rule: Readonly<ProductionRule>
) => {
  if (actor.phase !== "inside" || rule.tool === undefined || actor.tool === rule.tool) return false;
  if (building.status === `${TOOL_STATUS_PREFIX}${rule.tool}`) return true;
  return !home || (home.inventory[rule.tool] ?? 0) <= 0;
};

const waitingForWare = (
  actor: Readonly<SettlementActor>, building: Readonly<SettlementBuilding>,
  rule: Readonly<ProductionRule>, inputReturns: Readonly<Record<string, number>> | undefined
) => {
  if (actor.phase !== "inside" || !rule.inputs.length) return false;
  if (building.status === WAITING_FOR_INPUTS_STATUS) return true;
  if (actor.productionInputs?.length || actor.consumed) return false;
  return !inputsAvailable(building, rule, inputReturns);
};

/** A Builder standing at a site it cannot proceed with: the same gates the handler applies. */
const constructionReason = (
  actor: Readonly<SettlementActor>, building: Readonly<SettlementBuilding> | undefined
): UnitDecisionReasonCode | undefined => {
  if (actor.job !== "Builder" || !building || building.construction >= 1) return undefined;
  if (actor.phase !== "construct" || actor.action !== "idle") return undefined;
  if (building.status === WAITING_FOR_CONSTRUCTION_STATUS) return "waiting-for-ware";
  if (building.status === WAITING_FOR_SAFE_ACCESS_STATUS) return "no-path";
  return undefined;
};

/** Gates the worker handler itself applies before a cycle may start. */
const buildingReason = (facts: UnitDecisionFacts): UnitDecisionReasonCode | undefined => {
  const { actor, building, home, inputReturns, rule } = facts;
  const construction = constructionReason(actor, building);
  if (construction) return construction;
  if (!building || !rule || building.construction !== 1 || building.worker !== actor.uid) return undefined;
  if (building.productionPaused) return "building-paused";
  if (missingTool(actor, building, home, rule)) return "tool-missing";
  if (waitingForStorage(actor, building, rule, facts.outputCapacity ?? PRODUCTION_OUTPUT_CAPACITY))
    return "waiting-for-storage";
  if (waitingForWare(actor, building, rule, inputReturns)) return "waiting-for-ware";
  return undefined;
};

const isCarrierWithoutClaim = (actor: Readonly<SettlementActor>) =>
  actor.job === "Carrier" && !actor.delivery && !actor.handcart?.trip &&
  CARRIER_IDLE_PHASES.has(actor.phase);

/** Phases outside the shared clock table still move or work through their action. */
const actionReason = (actor: Readonly<SettlementActor>): UnitDecisionReasonCode => {
  if (HORSE_IDLE_PHASES.has(actor.phase)) return "resting";
  if (actor.action === "walk" || actor.action === "carry" || actor.pathIndex < actor.path.length)
    return "walking";
  if (actor.action !== "idle") return "working";
  return "waiting";
};

const clockReason = (
  actor: Readonly<SettlementActor>
): UnitDecisionReasonCode => {
  switch (workerPhaseClock(actor)) {
    case "construction":
    case "growth":
    case "handling":
    case "work": return "working";
    case "inactive": return "inactive";
    case "rest": return "resting";
    case "travel": return "walking";
    case "wait": return "waiting";
    default: return actionReason(actor);
  }
};

/**
 * The one pure derivation. Order matters: a proven route failure and an explicit door/queue wait
 * explain the unit more precisely than its generic handler clock.
 */
export const resolveUnitDecisionReason = (facts: UnitDecisionFacts): UnitDecisionReasonCode => {
  const { actor, soldier } = facts;
  if (isInactive(actor.phase)) return "inactive";
  const military = militaryReason(actor, soldier);
  if (military) return military;
  if (isDoorBlocked(actor)) return "blocked-door";
  if (isQueued(actor)) return "queued";
  if (hasProvenNoRoute(actor)) return "no-path";
  if (isSearchBudgetExhausted(actor)) return "search-budget";
  if (actor.phase === "workSearchWait") return "no-work";
  const building = buildingReason(facts);
  if (building) return building;
  if (isBlockedPhase(actor.phase)) return "no-path";
  if (isCarrierWithoutClaim(actor)) return "no-claim";
  return clockReason(actor);
};

/** Read the reason of one actor; only public, existing state is consulted. */
export const unitDecisionDiagnostics = (
  context: SettlementContext, actor: SettlementActor, soldier?: MilitaryCombatant,
  buildingOf?: (uid: number) => SettlementBuilding | undefined
): UnitDecisionDiagnostics => {
  const findBuilding = buildingOf ?? ((uid: number) => context.buildings.find(entry => entry.uid === uid));
  const building = findBuilding(actor.building);
  const home = actor.home === actor.building ? building : findBuilding(actor.home);
  const rule = building && building.construction === 1
    ? getBuildingProductionRule(building, buildingNation(context, building))
    : undefined;
  const inputReturns = rule && building && building.typeId === SAWMILL_TYPE_ID
    ? Object.fromEntries(rule.inputs.map(ware => [ware, reservedInputReturns(context, building, ware)]))
    : undefined;
  return {
    actor: actor.uid,
    phase: actor.phase,
    reason: resolveUnitDecisionReason({ actor, building, home, inputReturns, rule, soldier })
  };
};

export interface UnitDecisionSnapshotUnit {
  actor: number;
  job: string;
  reason: UnitDecisionReasonCode;
  x: number;
  y: number;
  z: number;
}
export interface UnitDecisionSnapshot {
  counts: UnitDecisionReasonCounts;
  /** Bounded: at most the requested number of per-actor entries. */
  units: UnitDecisionSnapshotUnit[];
  visible: number;
}

/** Development-overlay snapshot: aggregate counts plus a bounded label list of visible units. */
export const unitDecisionSnapshot = (
  context: SettlementContext, maximumLabels: number,
  soldierOf?: (uid: number) => MilitaryCombatant | undefined
): UnitDecisionSnapshot => {
  const buildings = new Map(context.buildings.map(building => [building.uid, building]));
  const buildingOf = (uid: number) => buildings.get(uid);
  const counts = emptyUnitDecisionReasonCounts();
  const units: UnitDecisionSnapshotUnit[] = [];
  let visible = 0;
  for (const actor of context.actors) {
    if (actor.visible === false || actor.phase === "retired") continue;
    visible++;
    const diagnostics = unitDecisionDiagnostics(context, actor, soldierOf?.(actor.uid), buildingOf);
    counts[diagnostics.reason]++;
    if (units.length >= maximumLabels) continue;
    units.push({ actor: actor.uid, job: actor.job, reason: diagnostics.reason,
      x: actor.x, y: actor.y, z: actor.z });
  }
  return { counts, units, visible };
};
