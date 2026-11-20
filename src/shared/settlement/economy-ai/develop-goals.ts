import type { ResolvedBuildGoal, ResolvedBuildProgram } from "./build-program";
import {
  FORTIFY_POSTURE, FULL_PERCENT, GOAL_SCORE_SCALE, GROW_POSTURE, MAX_SCORED_BUILD_GOALS
} from "./constants";

/** `fortify` while the faction knows of an enemy soldier, else its style's calm posture (`AI_POSTURES` index). */
export const postureOf = (knownSoldiers: number, calmPosture = GROW_POSTURE) =>
  (knownSoldiers > 0 ? FORTIFY_POSTURE : calmPosture);

/** The posture the program's style plays at `knownSoldiers` (turtle fortifies while calm too, EAI5a). */
export const programPosture = (program: ResolvedBuildProgram, knownSoldiers: number) =>
  postureOf(knownSoldiers, program.calmPosture);

/** The count a goal wants at `ownBuildings`: the last target step the faction's own building count reached. */
export const goalTarget = (goal: ResolvedBuildGoal, ownBuildings: number) => {
  let count = 0;
  for (let at = 0; at < goal.target.length; at += 2) {
    if (goal.target[at]! > ownBuildings) break;
    count = goal.target[at + 1]!;
  }
  return count;
};

/**
 * Raises the wanted counts to the finished count that a later goal still missing buildings requires of it. A goal
 * waiting on an unbuilt prerequisite so commits the faction to that prerequisite (the bakery's well, the mill's
 * farm) instead of idling. Requirements name only earlier goals (validated), so one pass from the last goal carries
 * a whole chain; a later raise (tools) runs it again.
 */
export const pullPrerequisites = (program: ResolvedBuildProgram) => {
  const { counts, wanted } = program.view;
  for (let index = program.goals.length - 1; index >= 0; index--) {
    if (wanted[index]! <= counts[index]!) continue;
    const { requires } = program.goals[index]!;
    for (let at = 0; at < requires.length; at += 2)
      wanted[requires[at]!] = Math.max(wanted[requires[at]!]!, requires[at + 1]!);
  }
};

/** Fills the count each goal wants: its target at the faction's own building count, with its prerequisites. */
export const fillWantedCounts = (program: ResolvedBuildProgram) => {
  const { ownBuildings, wanted } = program.view;
  program.goals.forEach((goal, index) => { wanted[index] = goalTarget(goal, ownBuildings); });
  pullPrerequisites(program);
};

/** Buildings the goal still misses (its sites count as there); reads `fillWantedCounts`' view. */
export const goalDeficit = (program: ResolvedBuildProgram, index: number) =>
  Math.max(0, program.view.wanted[index]! - program.view.counts[index]!);

/** Every required earlier goal has its count of finished buildings. */
export const prerequisitesMet = (program: ResolvedBuildProgram, goal: ResolvedBuildGoal) => {
  const { requires } = goal;
  for (let at = 0; at < requires.length; at += 2)
    if (program.view.finished[requires[at]!]! < requires[at + 1]!) return false;
  return true;
};

/** The faction's free stock pays the goal's construction now. */
export const goalPayable = (program: ResolvedBuildProgram, goal: ResolvedBuildGoal) => {
  const { stock } = program.view;
  for (let ware = 0; ware < goal.cost.length; ware++) if (stock[ware]! < goal.cost[ware]!) return false;
  return true;
};

/** `cost/stock`: each construction ware's cost as a share of the faction's free stock of it. */
export const goalCostPenalty = (program: ResolvedBuildProgram, goal: ResolvedBuildGoal) => {
  const { stock } = program.view;
  let penalty = 0;
  for (let ware = 0; ware < goal.cost.length; ware++) {
    const cost = goal.cost[ware]!;
    if (cost) penalty += Math.floor(cost * program.costWeight * GOAL_SCORE_SCALE / Math.max(1, stock[ware]!));
  }
  return penalty;
};

/** `deficit × weight × styleFactor × postureFactor`, in hundredths of a weight point. */
export const goalWanted = (
  program: ResolvedBuildProgram, goal: ResolvedBuildGoal, deficit: number, knownSoldiers: number
) => Math.floor(deficit * goal.weight * goal.postureStyle[programPosture(program, knownSoldiers)]! / GOAL_SCORE_SCALE);

/** The threat penalty: it lowers the goals of exposed groups per known enemy soldier. */
export const goalThreatPenalty = (program: ResolvedBuildProgram, goal: ResolvedBuildGoal, knownSoldiers: number) =>
  (goal.exposed ? knownSoldiers * program.threatPenalty * GOAL_SCORE_SCALE : 0);

/**
 * Plan §3.4: `deficit × weight × styleFactor × postureFactor − cost/stock − threat`, in hundredths of a weight
 * point (integers only).
 */
export const goalScore = (
  program: ResolvedBuildProgram, goal: ResolvedBuildGoal, deficit: number, knownSoldiers: number
) => goalWanted(program, goal, deficit, knownSoldiers) - goalCostPenalty(program, goal) -
  goalThreatPenalty(program, goal, knownSoldiers);

/** Its worker's tool is in the faction's free stock (a producer without one stands idle; P3 makes no tools). */
export const goalStaffable = (program: ResolvedBuildProgram, goal: ResolvedBuildGoal) =>
  goal.tool < 0 || program.view.stock[goal.tool]! > 0;

/** Open: not backed off, buildings missing, the prerequisites finished and a tool for its worker at hand. */
const isOpen = (program: ResolvedBuildProgram, index: number) => {
  const goal = program.goals[index]!;
  return !program.view.blocked[index] && goalDeficit(program, index) > 0 && prerequisitesMet(program, goal) &&
    goalStaffable(program, goal);
};

/**
 * The goal the faction builds for next (plan §3.4), or -1: the first `MAX_SCORED_BUILD_GOALS` open goals in program
 * order are scored and the best positive one the free stock pays wins; ties keep program order. The committed goal
 * stays unless the best beats it by more than the commitment margin (the program's, scaled by the faction's level).
 * Reads the program's view, which the caller filled for this decision (`fillWantedCounts` included).
 */
export const chooseBuildGoal = (
  program: ResolvedBuildProgram, committed: number, knownSoldiers: number,
  commitmentPercent = program.commitmentPercent
) => {
  let best = -1, bestScore = 0, committedScore = 0, scored = 0;
  for (let index = 0; index < program.goals.length && scored < MAX_SCORED_BUILD_GOALS; index++) {
    if (!isOpen(program, index)) continue;
    scored++;
    const goal = program.goals[index]!;
    if (!goalPayable(program, goal)) continue;
    const score = goalScore(program, goal, goalDeficit(program, index), knownSoldiers);
    if (score <= 0) continue;
    if (index === committed) committedScore = score;
    if (score > bestScore) { best = index; bestScore = score; }
  }
  const margin = FULL_PERCENT + commitmentPercent;
  const keeps = committedScore > 0 && bestScore * FULL_PERCENT <= committedScore * margin;
  return keeps ? committed : best;
};
