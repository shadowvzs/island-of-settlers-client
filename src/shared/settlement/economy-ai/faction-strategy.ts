import { commanderLevelOf } from "../commander/commander-profile-source";
import type { DirectorTarget } from "../commander/director-types";
import {
  type AreaRef, type CommanderStrategicApi, type IntentKind, type IntentStatus, isFinished, type StrategicIntent
} from "../commander/strategic-intents";
import type { SettlementContext } from "../settlement-types";
import {
  DEVELOP_MODE, FULL_PERCENT, STRATEGY_HOLD_RADIUS, STRATEGY_MAX_FAILURES, STRATEGY_RAID_STRENGTH,
  STRATEGY_RETREAT_PERCENT, STRATEGY_THREAT_RING, type StrategyLevel
} from "./constants";
import { factionStyle } from "./develop-strategy";
import { createKnownForces, type KnownForces, readKnownForces } from "./faction-ai-perception";
import { factionStrategyProbe } from "./faction-ai-probe";
import type { FactionAiState } from "./faction-ai-types";
import { baseArea, frontArea } from "./faction-base";
import { pickKnownTarget } from "./faction-goal";
import { musterReserve, reserveStrength } from "./faction-muster";
import type { FactionStrategyState } from "./faction-strategy-state";
import { strategyRowOf } from "./style-strategy";

/**
 * A computer faction's own strategic intents (enemy economy AI plan §3.7, lane EAI4b), stated through the
 * director's strategic contract (A14 plan §5.4) at the military layer while no script goal runs:
 * - a known enemy soldier near its base: `defend` the base;
 * - its offensive broken (its strength below half of the known enemy's): `retreat`;
 * - `develop` only, from its level's first attack tick and outside a back-off or a rest after its last offensive
 *   (scaled by its style, EAI5a):
 *   `attack` (or a smaller `raid`) on a building the faction knows, when its strength against the known enemy
 *   soldiers allows; a `scout` while it knows none or a target was rejected as unknown; spare depot soldiers count
 *   and march out for it (EAI4-FOLLOWUP, `faction-muster.ts`);
 * - otherwise, while it knows enemy soldiers: `hold` its front (the building nearest to the nearest of them).
 * A `maintain` faction only defends and holds. Receipts adapt it: a failed offensive backs off, a finished intent
 * is dropped for one decision (a restated finished intent stays finished). Enemies are read only through A13
 * knowledge and the director's known-sites ledger, so the faction never targets what it has not seen.
 */

/** One decision's reads (scratch: every field is read again at each decision, nothing here is saved). */
interface StrategyView {
  base: AreaRef | undefined;
  /** The intent kinds of the faction's own intents that finished since its last decision. */
  readonly finished: IntentKind[];
  readonly known: KnownForces;
  /** Strength of the faction's uncommitted field soldiers (what a new intent's force can take now). */
  field: number;
  /** The faction's running attack or raid. */
  offense: IntentStatus | undefined;
  /** Strength of its free field soldiers plus what its intents have committed. */
  own: number;
  /** Strength of its spare soldiers stored in its depot (`develop` only): what it can call up into the field. */
  reserve: number;
  /** An offensive was rejected as unknown: it scouts first. */
  scoutFirst: boolean;
}

const view: StrategyView = {
  base: undefined, field: 0, finished: [], known: createKnownForces(), offense: undefined, own: 0, reserve: 0,
  scoutFirst: false
};

const isOffensive = (kind: IntentKind) => kind === "attack" || kind === "raid";

/** The level's rest after a finished offensive (easy's rare raids); a level without one keeps the memory as it is. */
const rest = (memory: FactionStrategyState, row: StrategyLevel, now: number) => {
  if (row.offensiveRestTicks <= 0) return;
  memory.retryTick = Math.max(memory.retryTick, now + row.offensiveRestTicks);
};

const backOff = (memory: FactionStrategyState, row: StrategyLevel, now: number) => {
  memory.failures = Math.min(STRATEGY_MAX_FAILURES, memory.failures + 1);
  memory.retryTick = now + row.retryTicks * memory.failures;
  memory.target = undefined;
  rest(memory, row, now);
};

/** Reads one receipt of the faction's own intents (plan §5.4 statuses) into the memory and the view. */
const readReceipt = (
  memory: FactionStrategyState, entry: IntentStatus, knowsTarget: boolean, row: StrategyLevel, now: number
) => {
  const { kind, status } = entry;
  view.own += entry.strength;
  if (isFinished(status)) view.finished.push(kind);
  if (kind === "scout" && status === "done" && !knowsTarget) memory.retryTick = now + row.retryTicks;
  if (!isOffensive(kind)) return;
  if (status === "rejectedUnknownTarget") {
    memory.target = undefined;
    view.scoutFirst = true;
  } else if (status === "failed") backOff(memory, row, now);
  else if (status === "done") {
    memory.failures = 0;
    memory.target = undefined;
    rest(memory, row, now);
  } else view.offense = entry;
};

const readView = (
  context: SettlementContext, state: FactionAiState, strategy: CommanderStrategicApi,
  targets: readonly DirectorTarget[], row: StrategyLevel, now: number
) => {
  const { faction, strategy: memory } = state;
  view.base = baseArea(context, faction);
  view.finished.length = 0;
  view.offense = undefined;
  view.field = strategy.fieldStrength(faction);
  view.own = view.field;
  view.reserve = state.mode === DEVELOP_MODE ? reserveStrength(context, faction) : 0;
  view.scoutFirst = false;
  readKnownForces(context, faction, view.base, STRATEGY_THREAT_RING, view.known);
  if (!memory.stated) return;
  for (const entry of strategy.status(faction)) readReceipt(memory, entry, targets.length > 0, row, now);
};

/** The faction's strength falls below the share of the known enemy's that breaks an offensive. */
const isBroken = () => view.own * FULL_PERCENT < view.known.strength * STRATEGY_RETREAT_PERCENT;

const offensiveIntent = (kind: IntentKind, uid: number, row: StrategyLevel): StrategicIntent =>
  kind === "raid" ? { kind, target: { kind: "site", uid } }
    : { kind: "attack", minStrength: row.attackStrength, target: { kind: "site", uid } };

/**
 * The kind of a new offensive the faction's strength (with its spare depot soldiers, which it calls up) allows;
 * undefined: too weak for either. A level without full attacks (easy) only raids.
 */
const affordableOffensive = (row: StrategyLevel): IntentKind | undefined => {
  const strength = view.own + view.reserve;
  if (strength * FULL_PERCENT < view.known.strength * row.attackRatioPercent) return undefined;
  if (row.attacks && strength >= row.attackStrength) return "attack";
  return row.raids && strength >= STRATEGY_RAID_STRENGTH ? "raid" : undefined;
};

/**
 * A `develop` faction's offensive: the running one goes on while its target is known; a new one waits for the
 * level's first attack tick, the back-off and free field or spare depot soldiers, scouts while no target is known,
 * and goes for the most urgent known building when the strength allows.
 */
const offensive = (
  memory: FactionStrategyState, targets: readonly DirectorTarget[], row: StrategyLevel, now: number
): StrategicIntent | undefined => {
  const { offense } = view, current = memory.target;
  if (offense && current !== undefined && targets.some(target => target.uid === current))
    return offensiveIntent(offense.kind, current, row);
  if (now < row.firstAttackTicks || now < memory.retryTick || view.field + view.reserve <= 0)
    return undefined;
  if (view.scoutFirst || !targets.length) return { kind: "scout" };
  const kind = affordableOffensive(row);
  if (!kind) return undefined;
  const target = pickKnownTarget(targets, memory.target)!;
  memory.target = target.uid;
  return offensiveIntent(kind, target.uid, row);
};

/** The faction's intents in priority order (≤ 2 of the contract's 4), finished kinds left out for one decision. */
const chooseIntents = (
  context: SettlementContext, state: FactionAiState, targets: readonly DirectorTarget[], row: StrategyLevel,
  now: number
): StrategicIntent[] => {
  const { base, known } = view, memory = state.strategy;
  const intents: StrategicIntent[] = [];
  const threatened = base !== undefined && known.nearBase > 0;
  if (threatened) intents.push({ area: base, kind: "defend", priority: 1 });
  else if (view.offense && isBroken()) {
    backOff(memory, row, now);
    return [{ kind: "retreat" }];
  }
  const attack = !threatened && state.mode === DEVELOP_MODE ? offensive(memory, targets, row, now) : undefined;
  if (attack) intents.push(attack);
  const front = intents.length || known.nearest === Infinity ? undefined
    : frontArea(context, state.faction, known.nearestX, known.nearestZ, STRATEGY_HOLD_RADIUS);
  if (front) intents.push({ area: front, kind: "hold" });
  return intents.filter(intent => !view.finished.includes(intent.kind));
};

const NO_TARGETS: readonly DirectorTarget[] = [];

/**
 * The military layer's own strategy of a deciding faction while no script goal runs (EAI4b). It states its intents
 * only when it has some or had some: an island where it never orders one never touches the director.
 */
export const runFactionStrategy = (context: SettlementContext, state: FactionAiState, now: number) => {
  const strategy = context.militaryDirector?.strategy;
  if (!strategy) return;
  const { faction, strategy: memory } = state;
  const row = strategyRowOf(factionStyle(state), commanderLevelOf(context, faction));
  const targets = state.mode === DEVELOP_MODE ? strategy.knownTargets(faction) : NO_TARGETS;
  readView(context, state, strategy, targets, row, now);
  const intents = chooseIntents(context, state, targets, row, now);
  factionStrategyProbe()?.(faction, now, intents);
  if (!intents.length && !memory.stated) return;
  strategy.setIntents(faction, intents);
  memory.stated = intents.length > 0;
  if (view.reserve > 0) musterReserve(context, faction, intents, view.own, row.raidParty);
};
