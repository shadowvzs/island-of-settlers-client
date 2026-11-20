import { AI_POSTURES } from "@shared/catalog/ai/build-programs";

import type { ResolvedBuildGoal, ResolvedBuildProgram } from "./build-program";
import { MAX_SCORED_BUILD_GOALS } from "./constants";
import {
  goalCostPenalty, goalDeficit, goalScore, goalStaffable, goalThreatPenalty, goalWanted, prerequisitesMet,
  programPosture
} from "./develop-goals";

/**
 * Why a missing goal was (not) scored, in the order `chooseBuildGoal` tests it: in backoff, a required goal not
 * finished, no tool for its worker, past the scored-goal quota, its construction not payable, or scored.
 */
export type DevelopGoalStatus = "backoff" | "prerequisite" | "scored" | "tool" | "unpaid" | "unscored";

/** The first construction ware the free stock does not pay. */
export interface DevelopGoalShortage {
  have: number;
  need: number;
  ware: string;
}

/** One missing goal of a strategic decision with the terms of its score (hundredths of a weight point). */
export interface DevelopGoalTerms {
  /** The `cost/stock` penalty. */
  cost: number;
  /** Buildings still missing. */
  deficit: number;
  /** Style × posture factor, in percent² (10,000 = ×1). */
  factor: number;
  id: string;
  score: number;
  shortage?: DevelopGoalShortage;
  status: DevelopGoalStatus;
  /** The threat penalty of an exposed goal. */
  threat: number;
  typeId: number;
  /** `deficit × weight × factor`. */
  wanted: number;
  weight: number;
}

/** What one `develop` strategic decision saw (dev overlay "why" panel, never saved, never read by a decision). */
export interface DevelopGoalReport {
  /** The goal the decision committed to. */
  chosen?: string;
  /** Every goal with missing buildings, in program order. */
  goals: DevelopGoalTerms[];
  /** The faction's unfinished construction sites (it commits to nothing new from `MAX_OPEN_SITES` on). */
  openSites: number;
  posture: string;
  soldiers: number;
}

const shortageOf = (program: ResolvedBuildProgram, goal: ResolvedBuildGoal): DevelopGoalShortage | undefined => {
  const { stock } = program.view;
  for (let ware = 0; ware < goal.cost.length; ware++) {
    const have = stock[ware]!, need = goal.cost[ware]!;
    if (have < need) return { have, need, ware: program.wares[ware]! };
  }
  return undefined;
};

const statusOf = (program: ResolvedBuildProgram, index: number, scoredBefore: number, paid: boolean
): DevelopGoalStatus => {
  if (program.view.blocked[index]) return "backoff";
  if (!prerequisitesMet(program, program.goals[index]!)) return "prerequisite";
  if (!goalStaffable(program, program.goals[index]!)) return "tool";
  if (scoredBefore >= MAX_SCORED_BUILD_GOALS) return "unscored";
  return paid ? "scored" : "unpaid";
};

/**
 * The score terms of every missing goal, read from the program's view right after `chooseBuildGoal` (`chosen`: its
 * result) filled and read it. Built only while a probe recorder listens.
 */
export const developGoalReport = (program: ResolvedBuildProgram, chosen: number, soldiers: number
): DevelopGoalReport => {
  const goals: DevelopGoalTerms[] = [];
  const posture = programPosture(program, soldiers);
  let open = 0;
  for (let index = 0; index < program.goals.length; index++) {
    const deficit = goalDeficit(program, index);
    if (!deficit) continue;
    const goal = program.goals[index]!, shortage = shortageOf(program, goal);
    const status = statusOf(program, index, open, !shortage);
    if (status !== "backoff" && status !== "prerequisite" && status !== "tool") open++;
    goals.push({
      cost: goalCostPenalty(program, goal), deficit, factor: goal.postureStyle[posture]!, id: goal.id,
      score: goalScore(program, goal, deficit, soldiers), ...(shortage ? { shortage } : {}), status,
      threat: goalThreatPenalty(program, goal, soldiers), typeId: goal.typeId,
      wanted: goalWanted(program, goal, deficit, soldiers), weight: goal.weight
    });
  }
  return {
    ...(chosen < 0 ? {} : { chosen: program.goals[chosen]!.id }), goals, openSites: program.view.ownSites,
    posture: AI_POSTURES[posture]!, soldiers
  };
};
