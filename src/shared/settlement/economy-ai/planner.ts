import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { findFactionHome } from "../settlement-home";
import { ownerOf } from "../settlement-ownership";
import { settlementTerritory } from "../settlement-territory";
import type { SettlementContext } from "../settlement-types";
import { isExpansionType } from "./build-program";
import {
  EXPANSION_BAND_PERCENT, FULL_PERCENT, NO_CANDIDATE_PLOT, NO_EXPANSION_TARGET, PLANNER_CANDIDATES,
  PLANNER_FULL_CHECKS, PLANNER_IDLE, PLANNER_REFUSED, PLANNER_SCANNED_KEYS, PLANNER_STAGE_CHECK, PLOT_ROTATIONS,
  RESOURCE_WEIGHT
} from "./constants";
import type { FactionAiGoal } from "./develop-strategy";
import { reportGoalRefused } from "./faction-ai-probe";
import { needsResources, plotHasResource, plotResourceScore } from "./planner-goal-score";
import { draftOfEntry } from "./planner-placement";
import type { PlannerState } from "./planner-state";
import { factionPlotEntries } from "./plot-cache";
import { entryOfKey, type PlotClassEntries, turnsOfEntry } from "./plot-cache-entries";
import { isMemoBlocked, pruneMemo } from "./plot-memo";

/** Module scratch of one decision (decisions run one at a time): the candidates and their goal scores. */
const candidates = new Int32Array(PLANNER_CANDIDATES);
const scores = new Int32Array(PLANNER_CANDIDATES);

/** The faction's buildings and sites of a type (the goal's count includes sites). */
const ownedCount = (context: SettlementContext, faction: number, typeId: number) => {
  let count = 0;
  for (const building of context.buildings) if (building.typeId === typeId && ownerOf(building) === faction) count++;
  return count;
};

/**
 * Whether the plot covers a crop or charcoal site (the real rules refuse it; fields change too often for the cached
 * pre-check, so the scan skips them instead of spending the memo on them, EAI4a).
 */
const coversFieldSite = (context: SettlementContext, typeId: number, entry: number) => {
  const fields = context.fieldCycles;
  if (!fields) return false;
  const { cellsX } = context.options.world, [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const turned = entry % 2 === 1, spanX = turned ? depth : width, spanZ = turned ? width : depth;
  const corner = Math.floor(entry / PLOT_ROTATIONS), left = corner % cellsX, top = Math.floor(corner / cellsX);
  for (let z = top; z < top + spanZ; z++)
    for (let x = left; x < left + spanX; x++) if (fields.hasSite(z * cellsX + x)) return true;
  return false;
};

/** Whether a key's plot is worth a check: no field under it; a woodcutter or quarry needs its resource in reach. */
const servesGoal = (context: SettlementContext, typeId: number, entry: number) => {
  if (coversFieldSite(context, typeId, entry)) return false;
  if (!needsResources(typeId)) return true;
  const { x, z } = draftOfEntry(context, typeId, entry);
  return plotHasResource(context, typeId, x, z);
};

/**
 * Where an expansion building's scan starts: the first key at `EXPANSION_BAND_PERCENT` of the farthest plot's
 * distance (squared scores), so it stands well out in the territory yet within road reach (binary search).
 */
const expansionBandStart = (entries: PlotClassEntries) => {
  if (!entries.length) return 0;
  const farthest = Math.floor(entries.keys[entries.length - 1]! / entries.span);
  const threshold = Math.floor(farthest * EXPANSION_BAND_PERCENT * EXPANSION_BAND_PERCENT /
    (FULL_PERCENT * FULL_PERCENT)) * entries.span;
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries.keys[middle]! < threshold) low = middle + 1; else high = middle;
  }
  return low;
};

/** Squared whole-cell distance from a plot centre to `cell` (integers only). */
const distanceSquared = (context: SettlementContext, cell: number, x: number, z: number) => {
  const { cellsX } = context.options.world;
  const dx = cell % cellsX - Math.floor(x), dz = Math.floor(cell / cellsX) - Math.floor(z);
  return dx * dx + dz * dz;
};

/** Keeps the `PLANNER_CANDIDATES` best-scored plots seen so far (stable: an equal score keeps the earlier one). */
const keepBest = (entry: number, score: number, count: number) => {
  if (count === PLANNER_CANDIDATES && score <= scores[count - 1]!) return count;
  let at = Math.min(count, PLANNER_CANDIDATES - 1);
  for (; at > 0 && scores[at - 1]! < score; at--) {
    candidates[at] = candidates[at - 1]!;
    scores[at] = scores[at - 1]!;
  }
  candidates[at] = entry;
  scores[at] = score;
  return Math.min(count + 1, PLANNER_CANDIDATES);
};

/**
 * Up to `PLANNER_CANDIDATES` plots (each key's turns) the memo does not hold back among `PLANNER_SCANNED_KEYS` keys
 * in cache order; a plot whose building would find no resource in reach is passed over (it would stand idle). An
 * expansion building scans from its band outwards (`expansionBandStart`); towards a deposit (`toward`) it keeps the
 * plots nearest to it from the whole scan (EAI4a). Returns their count.
 */
const collectCandidates = (context: SettlementContext, owned: Uint8Array, state: PlannerState, typeId: number,
  entries: PlotClassEntries, toward: number) => {
  const turns = turnsOfEntry(entries.plotClass), stride = PLOT_ROTATIONS / turns;
  const start = isExpansionType(typeId) ? expansionBandStart(entries) : 0;
  const end = Math.min(entries.length, start + PLANNER_SCANNED_KEYS);
  const targeted = toward !== NO_EXPANSION_TARGET;
  let count = 0;
  for (let index = start; index < end && (targeted || count < PLANNER_CANDIDATES); index++) {
    const first = entryOfKey(entries.keys[index]!, entries.span);
    if (!servesGoal(context, typeId, first)) continue;
    for (let turn = 0; turn < turns && (targeted || count < PLANNER_CANDIDATES); turn++) {
      const entry = first + turn * stride;
      if (isMemoBlocked(context, owned, state.memo, typeId, entry)) continue;
      if (!targeted) candidates[count++] = entry;
      else {
        const { x, z } = draftOfEntry(context, typeId, entry);
        count = keepBest(entry, -distanceSquared(context, toward, x, z), count);
      }
    }
  }
  return count;
};

/**
 * The goal score (plan §3.5): resources in reach outweigh the static order (`RESOURCE_WEIGHT` places per
 * resource), then a stable insertion sort, best first. An expansion towards a deposit (`toward`) takes the plot
 * nearest to it (EAI4a). Integers only, ties keep the cache order.
 */
const rankCandidates = (context: SettlementContext, typeId: number, count: number, toward: number) => {
  for (let index = 0; index < count; index++) {
    const { x, z } = draftOfEntry(context, typeId, candidates[index]!);
    scores[index] = toward === NO_EXPANSION_TARGET
      ? plotResourceScore(context, typeId, x, z) * RESOURCE_WEIGHT - index
      : -distanceSquared(context, toward, x, z);
  }
  for (let index = 1; index < count; index++) {
    const entry = candidates[index]!, score = scores[index]!;
    let at = index;
    for (; at > 0 && scores[at - 1]! < score; at--) {
      candidates[at] = candidates[at - 1]!;
      scores[at] = scores[at - 1]!;
    }
    candidates[at] = entry;
    scores[at] = score;
  }
};

/** The goal cannot be placed now: the probe hears why, the caller backs the goal off. */
const refuseGoal = (faction: number, now: number, typeId: number, reason: string) => {
  reportGoalRefused(faction, now, typeId, reason);
  return PLANNER_REFUSED;
};

/**
 * The best `PLANNER_FULL_CHECKS` ranked candidates on different corners: the turns of one corner share its road
 * reach and neighbours, so four turns of one plot would spend the decision's real checks on one place. A corner's
 * other turns stay in the cache for the next decision.
 */
const distinctPlots = (count: number) => {
  const chosen: number[] = [];
  for (let index = 0; index < count && chosen.length < PLANNER_FULL_CHECKS; index++) {
    const corner = Math.floor(candidates[index]! / PLOT_ROTATIONS);
    if (chosen.every(entry => Math.floor(entry / PLOT_ROTATIONS) !== corner)) chosen.push(candidates[index]!);
  }
  return chosen;
};

/**
 * The `develop` build planner decision (plan §3.3/§3.5, EAI3b), on the planner layer after `maintain` placed
 * nothing: the cache's candidates for the strategic layer's committed goal (`target` = the number of that type,
 * sites included, the faction wants), ranked by the goal score; the best `PLANNER_FULL_CHECKS` wait for the staged
 * real checks and the placement on the following ticks (`stepPlannerPlacement`). Count quotas only (§3.1).
 * Returns idle (nothing to do, or a placement still runs) or refused (no candidate; the caller backs the goal
 * off, EAI3a).
 */
export const runPlannerDecision = (context: SettlementContext, faction: number, state: PlannerState,
  goal: Pick<FactionAiGoal, "target" | "toward" | "typeId">, now: number) => {
  const placement = context.factionPlacement;
  if (!placement || state.pending) return PLANNER_IDLE;
  const { typeId } = goal;
  if (ownedCount(context, faction, typeId) >= goal.target) return PLANNER_IDLE;
  const home = findFactionHome(context, faction);
  if (!home) return PLANNER_IDLE;
  pruneMemo(state.memo, now);
  const typeReason = placement.factionTypeReason(faction, typeId);
  if (typeReason) return refuseGoal(faction, now, typeId, typeReason);
  const territory = settlementTerritory(context, faction);
  const count = collectCandidates(context, territory.owned, state, typeId,
    factionPlotEntries(context, faction, home, territory, typeId), goal.toward);
  if (!count) return refuseGoal(faction, now, typeId, NO_CANDIDATE_PLOT);
  rankCandidates(context, typeId, count, goal.toward);
  state.pending = { candidates: distinctPlots(count), road: [], stage: PLANNER_STAGE_CHECK, typeId };
  return PLANNER_IDLE;
};
