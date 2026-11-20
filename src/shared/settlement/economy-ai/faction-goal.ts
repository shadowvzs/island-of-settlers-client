import {
  checkValue, enumOf, integer, number, objectOf, optional
} from "../../../../../island-of-settlers-shared/src/validation/index";
import { DMath } from "../../math/deterministic-math";
import { FACTION_AI_GOALS } from "../../world/constants";
import type { DirectorTarget } from "../commander/director-types";
import {
  type AreaRef, type CommanderStrategicApi, isFinished, type StrategicIntent
} from "../commander/strategic-intents";
import type { SettlementContext } from "../settlement-types";
import { GOAL_AREA_LIMIT, GOAL_ATTACK_STRENGTH } from "./constants";
import type { FactionAiState } from "./faction-ai-types";

/**
 * A map script's strategic goal for a computer faction (`setFactionGoal`, enemy economy AI plan §5.2, lane EAI4c):
 * a saved override of the faction's posture that ends at its tick. The military layer carries it out through the
 * director's strategic contract (A14 plan §5.4): `attack` names only a building the faction knows and scouts
 * while it knows none, `defend` and `hold` post its free soldiers in the goal's area, `expand` gives no order and
 * makes the build program score as if no enemy were known. While a military goal runs it replaces the faction's
 * intents; when it ends they are dropped and the director acts on its defaults again.
 */
export type FactionGoalKind = (typeof FACTION_AI_GOALS)[number];

/** One faction's running goal (saved as it is). */
export interface FactionGoal {
  /** Where: the attack's or the scout's region, a post's area. Absent: anywhere (attack, expand). */
  area?: AreaRef;
  goal: FactionGoalKind;
  /** The known building the attack goes for; it keeps it until the building falls. */
  target?: number;
  /** The game tick the goal ends at; absent: it stays until the next goal. */
  until?: number;
}

const coordinate = number({ max: GOAL_AREA_LIMIT, min: -GOAL_AREA_LIMIT });

const goalCheck = objectOf({
  area: optional(objectOf({ radius: number({ max: GOAL_AREA_LIMIT, min: 0 }), x: coordinate, z: coordinate })),
  goal: enumOf(FACTION_AI_GOALS),
  target: optional(integer(0)),
  until: optional(integer(0))
});

/** The goals that order soldiers; `expand` only changes what the faction builds. */
const isMilitaryGoal = (kind: FactionGoalKind) => kind !== "expand";

/** A well-formed goal: a script argument or a save may hold anything. A post needs its area. */
export const isFactionGoal = (value: unknown): value is FactionGoal => {
  if (checkValue(goalCheck, value).length) return false;
  const { area, goal, target } = value as FactionGoal;
  if ((goal === "defend" || goal === "hold") && !area) return false;
  return target === undefined || goal === "attack";
};

export const copyFactionGoal = ({ area, goal, target, until }: FactionGoal): FactionGoal => ({
  ...(area ? { area: { radius: area.radius, x: area.x, z: area.z } } : {}), goal,
  ...(target === undefined ? {} : { target }), ...(until === undefined ? {} : { until })
});

/** The goal while it runs at `now`; undefined once its tick has come (the faction AI clears it in that tick). */
export const activeFactionGoal = (goal: FactionGoal | undefined, now: number) =>
  goal && (goal.until === undefined || now < goal.until) ? goal : undefined;

/** A military goal runs: it states the faction's intents, so the faction's own strategy waits (EAI4b). */
export const isMilitaryGoalActive = (goal: FactionGoal | undefined, now: number) => {
  const active = activeFactionGoal(goal, now);
  return active !== undefined && isMilitaryGoal(active.goal);
};

/** An `expand` goal runs: the build program scores as if the faction knew of no enemy soldier. */
export const isExpanding = (goal: FactionGoal | undefined, now: number) =>
  activeFactionGoal(goal, now)?.goal === "expand";

/** The known building an offensive goes for: `current` while it is still a target, else the most urgent one. */
export const pickKnownTarget = (targets: readonly DirectorTarget[], current: number | undefined) =>
  targets.find(entry => entry.uid === current) ?? targets[0];

const inArea = (area: AreaRef | undefined, target: DirectorTarget) =>
  !area || DMath.hypot(target.x - area.x, target.z - area.z) <= area.radius;

/**
 * The attack's order: the building it already goes for while the faction still knows it as a target, else the most
 * urgent known one (inside the goal's area when it has one); a scout while it knows none. No building is read:
 * `targets` is the director's list of what the faction knows.
 */
const attackIntent = (goal: FactionGoal, targets: readonly DirectorTarget[]): StrategicIntent => {
  const known = targets.filter(target => inArea(goal.area, target));
  const target = pickKnownTarget(known, goal.target);
  goal.target = target?.uid;
  if (!target) return { kind: "scout", ...(goal.area ? { area: goal.area } : {}) };
  return { kind: "attack", minStrength: GOAL_ATTACK_STRENGTH, target: { kind: "site", uid: target.uid } };
};

/** The intents a running military goal states (plan §5.2 → A14 plan §5.4). */
export const factionGoalIntents = (goal: FactionGoal, targets: readonly DirectorTarget[]): StrategicIntent[] => {
  if (goal.goal === "attack") return [attackIntent(goal, targets)];
  if (goal.goal === "defend" && goal.area) return [{ area: goal.area, kind: "defend", priority: 1 }];
  return goal.goal === "hold" && goal.area ? [{ area: goal.area, kind: "hold" }] : [];
};

/**
 * States the goal's intents. A finished intent (the scout is back, the target fell, the force was lost) is dropped
 * for this decision, so the next one orders it again (A14-4c: a restated finished intent stays finished).
 */
const orderFactionGoal = (strategy: CommanderStrategicApi, faction: number, goal: FactionGoal) => {
  const finished = strategy.status(faction).some(entry => isFinished(entry.status));
  strategy.setIntents(faction, finished ? [] : factionGoalIntents(goal, strategy.knownTargets(faction)));
};

/** A military goal that ends or gives way to `expand` hands the faction's soldiers back to the director. */
export const releaseFactionGoal = (context: SettlementContext, faction: number, goal: FactionGoal | undefined) => {
  if (goal && isMilitaryGoal(goal.goal)) context.militaryDirector?.strategy.setIntents(faction, []);
};

/**
 * The military layer's goal step, on its cadence also while the faction takes no decisions: a goal past its tick
 * ends; a running military goal of a deciding faction states its intents (the same ones keep their force).
 */
export const runFactionGoal = (context: SettlementContext, state: FactionAiState, now: number, deciding: boolean) => {
  const { faction, goal } = state;
  if (!goal) return;
  if (!activeFactionGoal(goal, now)) {
    releaseFactionGoal(context, faction, goal);
    state.goal = undefined;
    return;
  }
  const strategy = context.militaryDirector?.strategy;
  if (deciding && strategy && isMilitaryGoal(goal.goal)) orderFactionGoal(strategy, faction, goal);
};
