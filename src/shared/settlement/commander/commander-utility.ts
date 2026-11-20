import { DMath } from "../../math/deterministic-math";
import { clamp01 } from "../../world/noise";
import type { CommanderAction, CommanderWeights, SquadView } from "./commander-types";

/** The current action scores this much more (no flip-flop between two close choices). */
const COMMITMENT = 0.1;
/** A squad further than this from its camp (tiles) walks back to defend it. */
export const HOME_RADIUS = 6;
/** Morale (A14 plan §4.2-§4.3): shaken members halve their share of the attack; this share regroups. */
const SHAKEN_ATTACK_FACTOR = 0.5;
const SHAKEN_REGROUP_SHARE = 0.4;
const SHAKEN_REGROUP_BONUS = 0.3;
/** An enemy closer than this (tiles) keeps a squad from regrouping. */
export const REGROUP_CONTACT = 10;
/** The fixed tie order of the actions. */
const ACTIONS: readonly CommanderAction[] = ["attack", "defend", "retreat", "regroup"];

const logistic = (value: number) => 1 / (1 + DMath.exp(-value));

/**
 * Utility of every action for a squad (higher is better). `moraleUse` (the level's weight) scales the regroup
 * bonus of a shaken squad.
 */
export const scoreActions = (
  view: SquadView,
  weights: CommanderWeights,
  moraleUse = 1
): Record<CommanderAction, number> => {
  const shaken = view.shaken ?? 0;
  const reach = weights.attackRadius;
  const proximity =
    view.enemyDistance === Infinity ? 0 : clamp01(2 - (2 * view.enemyDistance) / reach);
  const ratio = view.own / Math.max(0.01, view.enemyStrength);
  const local = view.support / Math.max(0.01, view.threat);
  const scores = {
    attack: weights.aggression * logistic(4 * (ratio - weights.attackRatio)) * proximity *
      (1 - SHAKEN_ATTACK_FACTOR * shaken),
    defend: weights.defend + (view.homeDistance > HOME_RADIUS && proximity === 0 ? 0.2 : 0),
    regroup:
      weights.cohesion *
      clamp01((view.spread - 3) / 6) *
      (view.enemyDistance > REGROUP_CONTACT ? 1 : 0.2),
    retreat:
      view.threat > 0 && !view.retreatSpent
        ? weights.caution * logistic(5 * (weights.retreatRatio - local))
        : 0
  };
  if (shaken >= SHAKEN_REGROUP_SHARE) scores.regroup += SHAKEN_REGROUP_BONUS * moraleUse;
  if (view.current) scores[view.current] += COMMITMENT;
  return scores;
};

/** The best action (ties keep the fixed order attack, defend, retreat, regroup). */
export const bestAction = (scores: Record<CommanderAction, number>) => {
  let best: CommanderAction = "attack";
  for (const action of ACTIONS) if (scores[action] > scores[best]) best = action;
  return best;
};
