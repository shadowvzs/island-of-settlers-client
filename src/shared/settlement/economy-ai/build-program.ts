import { type BuildGoal, buildingEntry, type BuildProgram, getContentEntry } from "@shared/catalog";
import { AI_POSTURES, buildProgramOf, styleStrategyOf } from "@shared/catalog/ai/build-programs";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { GARRISON_CAPACITIES } from "../../balance/military";
import { TERRITORY_RADII } from "../../balance/territory";
import { getConstructionCost } from "../construction-costs";
import { METALWORKS_TYPE } from "../mixed-output";
import { getProductionRule } from "../production-rules";

/** One goal of a program as one nation plays it: numbers only, so a decision allocates nothing. */
export interface ResolvedBuildGoal {
  /** Construction cost per program ware (`ResolvedBuildProgram.wares` order). */
  readonly cost: Int32Array;
  /** A garrison building that claims land: the planner sets it at the territory's edge (EAI4a expansion). */
  readonly expands: boolean;
  readonly exposed: boolean;
  readonly id: string;
  /** Group factor per posture in `AI_POSTURES` order, times the style factor (percent²). */
  readonly postureStyle: Int32Array;
  /** Required goal index and finished count pairs. */
  readonly requires: Int32Array;
  /** Own building count and wanted count pairs, ascending. */
  readonly target: Int32Array;
  /** The program ware index of the tool its worker needs; -1: none. */
  readonly tool: number;
  readonly typeId: number;
  readonly weight: number;
}

/**
 * Per-decision scratch of one faction's economy (never saved; every decision writes all of it before reading):
 * goals in backoff, buildings per goal (sites included), finished per goal, free stock per program ware, own
 * buildings in total and the count wanted per goal (its target, raised to what a waiting later goal requires).
 */
export interface BuildProgramView {
  readonly blocked: Uint8Array;
  readonly counts: Int32Array;
  readonly finished: Int32Array;
  ownBuildings: number;
  /** Own construction sites not finished yet (any type). */
  ownSites: number;
  readonly stock: Int32Array;
  readonly wanted: Int32Array;
}

/** A style's program for one computer nation: the goals it plays in build order, with their wares and scratch. */
export interface ResolvedBuildProgram {
  /** The posture (`AI_POSTURES` index) the style plays while the faction knows of no enemy soldier (EAI5a). */
  readonly calmPosture: number;
  readonly commitmentPercent: number;
  readonly costWeight: number;
  /** The first goal that expands the territory (`ResolvedBuildGoal.expands`); -1: none. */
  readonly expansion: number;
  /** Goal index per building type id; -1: no goal. */
  readonly goalOfType: Int16Array;
  readonly goals: readonly ResolvedBuildGoal[];
  readonly threatPenalty: number;
  /** The goal that makes worker tools (the Metalworks, EAI4-FOLLOWUP); -1: none. */
  readonly toolmaking: number;
  readonly view: BuildProgramView;
  /** Every construction ware and worker tool of the goals, sorted. */
  readonly wares: readonly string[];
}

/** A garrison building that claims land once manned: the faction grows its territory with it (EAI4a). */
export const isExpansionType = (typeId: number) =>
  TERRITORY_RADII[typeId] !== undefined && GARRISON_CAPACITIES[typeId] !== undefined;

const typeIdOf = (goal: BuildGoal) => {
  const code = getContentEntry(goal.building)?.code;
  if (code === undefined || !buildingEntry(code)) throw new Error(`Unknown build goal building ${goal.building}`);
  return code;
};

/**
 * The tool the goal's worker needs; none for a garrison building, whose soldiers come from the faction's reserve
 * (their sword is the recruit's, not a stock tool).
 */
const workerTool = (typeId: number, nation: WorkerNation | undefined) =>
  (GARRISON_CAPACITIES[typeId] === undefined ? getProductionRule(typeId, nation)?.tool : undefined);

const pairs = <Item>(items: readonly Item[] | undefined, pair: (item: Item) => readonly [number, number]) =>
  Int32Array.from((items ?? []).flatMap(item => pair(item)));

const resolveGoal = (
  program: BuildProgram, goal: BuildGoal, played: readonly BuildGoal[], wares: readonly string[],
  nation: WorkerNation | undefined
): ResolvedBuildGoal => {
  const group = program.groups[goal.group]!;
  const typeId = typeIdOf(goal);
  const cost = getConstructionCost(typeId, nation);
  const target = (nation !== undefined && goal.nationTargets?.[nation]) || goal.target;
  return {
    cost: Int32Array.from(wares, ware => cost[ware] ?? 0),
    expands: isExpansionType(typeId),
    exposed: group.exposed,
    id: goal.id,
    postureStyle: Int32Array.from(AI_POSTURES, posture => group.postures[posture] * group.style),
    requires: pairs(goal.requires, required =>
      [played.findIndex(entry => entry.id === required.goal), required.count]),
    target: pairs(target, step => [step.buildings, step.count]),
    tool: wares.indexOf(workerTool(typeId, nation) ?? ""),
    typeId,
    weight: goal.weight
  };
};

const goalIndexByType = (goals: readonly ResolvedBuildGoal[]) => {
  const index = new Int16Array(Math.max(...goals.map(goal => goal.typeId)) + 1).fill(-1);
  goals.forEach((goal, at) => { index[goal.typeId] = at; });
  return index;
};

const resolveProgram = (program: BuildProgram, nation: WorkerNation | undefined): ResolvedBuildProgram => {
  const played = program.goals.filter(goal => !goal.nations || (nation !== undefined && goal.nations.includes(nation)));
  const costs = played.map(goal => getConstructionCost(typeIdOf(goal), nation));
  const tools = played.flatMap(goal => workerTool(typeIdOf(goal), nation) ?? []);
  const wares = [...new Set([...costs.flatMap(cost => Object.keys(cost).filter(ware => cost[ware]! > 0)), ...tools])]
    .sort();
  const goals = played.map(goal => resolveGoal(program, goal, played, wares, nation));
  return {
    calmPosture: AI_POSTURES.indexOf(styleStrategyOf(program.style).calmPosture),
    commitmentPercent: program.commitmentPercent, costWeight: program.costWeight,
    expansion: goals.findIndex(goal => goal.expands), goalOfType: goalIndexByType(goals),
    goals, threatPenalty: program.threatPenalty, toolmaking: goals.findIndex(goal => goal.typeId === METALWORKS_TYPE),
    view: {
      blocked: new Uint8Array(goals.length), counts: new Int32Array(goals.length),
      finished: new Int32Array(goals.length), ownBuildings: 0, ownSites: 0,
      stock: new Int32Array(wares.length), wanted: new Int32Array(goals.length)
    },
    wares
  };
};

/** Resolved once per style and nation (catalog data is frozen), so decisions only read numbers. */
const resolved = new Map<string, ResolvedBuildProgram>();

/**
 * The program a computer nation plays in a style (`data/ai/<style>.json`); without a nation (bare fixtures) the
 * shared base receipts and only the goals of every nation.
 */
export const resolvedBuildProgram = (style: string, nation: WorkerNation | undefined) => {
  const program = buildProgramOf(style);
  const key = `${program.style}/${nation}`;
  const cached = resolved.get(key);
  if (cached) return cached;
  const created = resolveProgram(program, nation);
  resolved.set(key, created);
  return created;
};
