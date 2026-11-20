import { DEFAULT_BUILD_PROGRAM_STYLE } from "@shared/catalog/ai/build-programs";

import { contextBuildingAvailability, factionAvailabilityRefusal } from "../building-availability-rules";
import { commanderLevelOf, commanderPaceOf } from "../commander/commander-profile-source";
import { outstandingConstructionNeed } from "../settlement-local-stock";
import { nationOf } from "../settlement-nation";
import { ownerOf } from "../settlement-ownership";
import type { SettlementBuilding, SettlementContext } from "../settlement-types";
import { type ResolvedBuildProgram, resolvedBuildProgram } from "./build-program";
import {
  DEVELOP_PACES, FORTIFY_POSTURE, FULL_PERCENT, MAX_OPEN_SITES, NO_EXPANSION_TARGET, RAID_MIN_SOLDIERS
} from "./constants";
import { developGoalReport } from "./develop-diagnostics";
import { expansionTarget, raiseExpansion } from "./develop-expansion";
import { chooseBuildGoal, fillWantedCounts, goalDeficit, programPosture } from "./develop-goals";
import { factionSoldierCount } from "./develop-military";
import type { DevelopState } from "./develop-state";
import { raiseToolmaking } from "./develop-tools";
import { factionAiGoalProbe } from "./faction-ai-probe";
import type { FactionAiState, FactionAiThreat } from "./faction-ai-types";
import { isExpanding } from "./faction-goal";
import { backOffGoal, isGoalDue } from "./maintain-state";
import { strategyRowOf } from "./style-strategy";

/**
 * The goal the planner builds for: the building type and how many of it the faction wants in total; an expansion
 * goal also the cell it grows towards (`expansionTarget`, `NO_EXPANSION_TARGET`: the farthest edge).
 */
export interface FactionAiGoal {
  id: string;
  target: number;
  toward: number;
  typeId: number;
}

/** The style the faction plays: a script's, else the map's, else balanced. */
export const factionStyle = (state: FactionAiState) =>
  state.style ?? state.authored.style ?? DEFAULT_BUILD_PROGRAM_STYLE;

/** The faction's offensive row: its level's, as its style plays it (EAI5a). */
export const factionStrategyRow = (context: SettlementContext, state: FactionAiState) =>
  strategyRowOf(factionStyle(state), commanderLevelOf(context, state.faction));

/**
 * Soldiers that may man a new expansion tower: all, or those beyond a least raid party while the level keeps one
 * (easy's raids, owner 2026-11-17).
 */
const expansionSoldiers = (context: SettlementContext, state: FactionAiState) => {
  const count = factionSoldierCount(context, state.faction);
  return factionStrategyRow(context, state).raidParty > 0 ? count - RAID_MIN_SOLDIERS : count;
};

/** The program the faction plays: its style for its computer nation. */
export const factionProgram = (context: SettlementContext, state: FactionAiState) =>
  resolvedBuildProgram(factionStyle(state), nationOf(context, state.faction));

const goalIndexOf = (program: ResolvedBuildProgram, id: string | undefined) =>
  id === undefined ? -1 : program.goals.findIndex(goal => goal.id === id);

const countOwnBuilding = (program: ResolvedBuildProgram, building: SettlementBuilding) => {
  const { counts, finished, stock } = program.view;
  program.view.ownBuildings++;
  if (building.construction < 1) program.view.ownSites++;
  for (let ware = 0; ware < program.wares.length; ware++)
    stock[ware]! -= outstandingConstructionNeed(building, program.wares[ware]!);
  const goal = program.goalOfType[building.typeId] ?? -1;
  if (goal < 0) return;
  counts[goal]!++;
  if (building.construction >= 1) finished[goal]!++;
};

/**
 * Fills the program's view with the faction's own economy (plan §3.2: own state is fully known): its buildings per
 * goal and in total, and the free stock of its pools (minus what its sites still wait for).
 */
const readOwnEconomy = (context: SettlementContext, faction: number, program: ResolvedBuildProgram) => {
  const { counts, finished, stock } = program.view;
  counts.fill(0);
  finished.fill(0);
  stock.fill(0);
  program.view.ownBuildings = 0;
  program.view.ownSites = 0;
  for (const building of context.buildings) if (ownerOf(building) === faction) countOwnBuilding(program, building);
  for (const pool of context.storagePools?.pools ?? []) {
    if (pool.owner !== faction) continue;
    for (let ware = 0; ware < program.wares.length; ware++) stock[ware]! += pool.available[program.wares[ware]!] ?? 0;
  }
};

/** Drops the backoffs of reached or unknown goals, then marks the goals still waiting at `now`. */
const markBackoffs = (program: ResolvedBuildProgram, develop: DevelopState, now: number) => {
  program.view.blocked.fill(0);
  for (let at = develop.backoffs.length - 1; at >= 0; at--) {
    const entry = develop.backoffs[at]!;
    const index = goalIndexOf(program, entry.goal);
    if (index < 0 || !goalDeficit(program, index)) develop.backoffs.splice(at, 1);
    else if (!isGoalDue(entry, now)) program.view.blocked[index] = 1;
  }
};

/**
 * Goals the map's bans or tier cap rule out are never opened (MAP BUILDING AVAILABILITY: the faction ignores the
 * player's level but follows the map); placement would refuse them anyway, this saves the refused attempts.
 */
const markMapBans = (context: SettlementContext, faction: number, program: ResolvedBuildProgram) => {
  if (!contextBuildingAvailability(context)) return;
  program.goals.forEach((goal, index) => {
    if (factionAvailabilityRefusal(context, faction, goal.typeId)) program.view.blocked[index] = 1;
  });
};

/** The program's commitment margin at the faction's level (plan §5.1: a harder faction drops a stale goal sooner). */
const levelCommitment = (context: SettlementContext, faction: number, program: ResolvedBuildProgram) =>
  Math.floor(program.commitmentPercent * DEVELOP_PACES[commanderPaceOf(context, faction)].commitmentPercent /
    FULL_PERCENT);

/**
 * The strategic layer of a `develop` faction (plan §3.4, every 10 s at medium): scores its build program against its
 * own economy and what it knows of enemy soldiers in its style's posture, and commits to the goal the planner builds
 * for next (or none).
 * `threat` is the A13 knowledge summary the same decision just read.
 */
export const runDevelopStrategy = (
  context: SettlementContext, state: FactionAiState, threat: Readonly<FactionAiThreat>, now: number
) => {
  const program = factionProgram(context, state);
  const { develop } = state;
  readOwnEconomy(context, state.faction, program);
  fillWantedCounts(program);
  raiseExpansion(program, develop, expansionSoldiers(context, state),
    expansionTarget(context, state.faction, program, develop));
  raiseToolmaking(program);
  markBackoffs(program, develop, now);
  markMapBans(context, state.faction, program);
  // A script's `expand` goal (EAI4c): the faction plays as if no enemy soldier were known (the grow posture).
  const knownSoldiers = isExpanding(state.goal, now) ? 0 : threat.soldiers;
  develop.fortify = programPosture(program, knownSoldiers) === FORTIFY_POSTURE;
  // Its builders and carriers finish what stands before it opens more sites (a small economy spread over many
  // sites finishes none and runs out of tools).
  const busy = program.view.ownSites >= MAX_OPEN_SITES;
  const committed = goalIndexOf(program, develop.goal?.id);
  const chosen = busy ? -1
    : chooseBuildGoal(program, committed, knownSoldiers, levelCommitment(context, state.faction, program));
  factionAiGoalProbe()?.(state.faction, now, developGoalReport(program, chosen, knownSoldiers));
  if (chosen < 0) {
    develop.goal = undefined;
    return;
  }
  const { id } = program.goals[chosen]!;
  const target = program.view.wanted[chosen]!;
  if (develop.goal?.id === id) develop.goal.target = target;
  else develop.goal = { id, target };
};

/** The committed goal with its building type; undefined when there is none or the program no longer has it. */
export const committedGoal = (context: SettlementContext, state: FactionAiState): FactionAiGoal | undefined => {
  const { goal } = state.develop;
  if (!goal) return undefined;
  const program = factionProgram(context, state);
  const index = goalIndexOf(program, goal.id);
  if (index < 0) return undefined;
  const { expands, typeId } = program.goals[index]!;
  const toward = expands ? expansionTarget(context, state.faction, program, state.develop) : NO_EXPANSION_TARGET;
  return { id: goal.id, target: goal.target, toward, typeId };
};

/**
 * The planner could not place the committed goal (plan §3.5): the goal backs off (10 s per refusal, at most 60 s)
 * and the faction holds no goal until its next strategic decision picks another.
 */
export const refuseCommittedGoal = (develop: DevelopState, now: number) => {
  const { goal } = develop;
  if (!goal) return false;
  let entry = develop.backoffs.find(backoff => backoff.goal === goal.id);
  if (!entry) {
    entry = { attempts: 0, goal: goal.id, retryTick: now };
    develop.backoffs.push(entry);
  }
  backOffGoal(entry, now);
  develop.goal = undefined;
  return true;
};
