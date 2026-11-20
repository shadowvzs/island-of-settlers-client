import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { RoadPlan, RoadPoint } from "../road-types";
import type { FactionBuildingDraft } from "../settlement-faction-placement";
import { findFactionHome } from "../settlement-home";
import { ownerOf } from "../settlement-ownership";
import { findRoadTarget, samePoint } from "../settlement-road-target";
import { settlementTerritory } from "../settlement-territory";
import type { SettlementBuilding, SettlementContext } from "../settlement-types";
import {
  EVERY_CHECKED_PLOT_REFUSED, NO_ROAD_LINK, PLANNER_IDLE, PLANNER_PLACED, PLANNER_REFUSED, PLANNER_RETRY,
  PLANNER_ROAD_TRIES, PLANNER_STAGE_CHECK, PLANNER_STAGE_PLACE, PLANNER_STAGE_ROAD, PLOT_MEMO_CAPACITY, PLOT_ROTATIONS,
  SITE_NOT_PLACED
} from "./constants";
import { reportGoalRefused, reportPlotRefused } from "./faction-ai-probe";
import type { PlannerPending, PlannerState } from "./planner-state";
import { isMemoBlocked, rememberFailedPlot } from "./plot-memo";

/**
 * The staged second half of a planner decision (plan §3.5, worst-tick budget §6.2): one expensive step per tick, so
 * no tick runs the placement rules, the road plan and the claim together.
 * 1. check: the real plot rules and the faction's territory on the best waiting candidate; a refused one is
 *    remembered (negative memo) and the next one waits;
 * 2. road: where its flag joins the faction's network (≤ `PLANNER_ROAD_TRIES` road plans), the checked plan kept;
 * 3. place: the site from the faction's stock, then that plan laid as it is (a plan a new plot now crosses is
 *    planned again between its ends).
 * The waiting state is saved, so a reload resumes the same step.
 */

/** The plot of a cache entry, written into the module scratch draft (placement copies what it keeps). */
const draft: FactionBuildingDraft = { rotation: 0, typeId: 0, x: 0, z: 0 };
export const draftOfEntry = (context: SettlementContext, typeId: number, entry: number) => {
  const { cellsX } = context.options.world, [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const cell = Math.floor(entry / PLOT_ROTATIONS), rotation = entry % PLOT_ROTATIONS, turned = rotation % 2 === 1;
  draft.rotation = rotation;
  draft.typeId = typeId;
  draft.x = cell % cellsX + (turned ? depth : width) / 2;
  draft.z = Math.floor(cell / cellsX) + (turned ? width : depth) / 2;
  return draft;
};

/** The tick of a placement step and why its candidate failed. */
interface PlannerStep {
  now: number;
  reason: string;
}

/** Road plans of this step and the last plan that passed (module scratch). */
let roadTries = 0;
let checkedPlan: RoadPlan | null = null;

const factionFlags = (context: SettlementContext, faction: number) =>
  context.buildings.filter(building => ownerOf(building) === faction).map(building => building.access);

/** Where the site's flag would join the faction's network: ≤ `PLANNER_ROAD_TRIES` road plans. */
const roadTargetOf = (context: SettlementContext, faction: number, home: SettlementBuilding,
  site: SettlementBuilding) => {
  roadTries = 0;
  checkedPlan = null;
  return findRoadTarget(context, {
    draft: site, flags: () => factionFlags(context, faction), home,
    planRoad: (start, end) => {
      if (roadTries++ >= PLANNER_ROAD_TRIES) return null;
      checkedPlan = context.factionPlacement!.planFactionRoad(faction, start, end);
      return checkedPlan;
    },
    targets: PLANNER_ROAD_TRIES
  });
};

/** A plot the real rules refused for `reason`: into the negative memo (the probe hears why). */
const rememberRefusedPlot = (context: SettlementContext, faction: number, state: PlannerState, typeId: number,
  entry: number, step: PlannerStep) => {
  rememberFailedPlot(context, settlementTerritory(context, faction).owned, state.memo, typeId, entry, step.now);
  reportPlotRefused(faction, step.now, typeId, entry, step.reason);
};

/** A plot whose flag found no road: every turn of its corner is remembered (their road reach is the same). */
const rememberUnlinkedCorner = (context: SettlementContext, faction: number, state: PlannerState, typeId: number,
  entry: number, step: PlannerStep) => {
  const { owned } = settlementTerritory(context, faction), corner = entry - entry % PLOT_ROTATIONS;
  for (let turn = 0; turn < PLOT_ROTATIONS; turn++)
    if (!isMemoBlocked(context, owned, state.memo, typeId, corner + turn))
      rememberFailedPlot(context, owned, state.memo, typeId, corner + turn, step.now);
  reportPlotRefused(faction, step.now, typeId, entry, step.reason);
};

/**
 * The candidate failed: remembered (a road refusal for every turn of its corner); the next one waits. With none
 * left the planner retries at its next decision on the plots the memo leaves, so refusals walk down the cache
 * instead of backing the goal off; only a full memo (every remembered plot refused) refuses the goal.
 */
const dropCandidate = (context: SettlementContext, faction: number, state: PlannerState, pending: PlannerPending,
  step: PlannerStep) => {
  const entry = pending.candidates.shift()!;
  const remember = step.reason === NO_ROAD_LINK ? rememberUnlinkedCorner : rememberRefusedPlot;
  remember(context, faction, state, pending.typeId, entry, step);
  pending.stage = PLANNER_STAGE_CHECK;
  if (pending.candidates.length) return PLANNER_IDLE;
  state.pending = undefined;
  if (state.memo.count < PLOT_MEMO_CAPACITY) return PLANNER_RETRY;
  reportGoalRefused(faction, step.now, pending.typeId, EVERY_CHECKED_PLOT_REFUSED);
  return PLANNER_REFUSED;
};

const checkStep = (context: SettlementContext, faction: number, state: PlannerState, pending: PlannerPending,
  now: number) => {
  const placement = context.factionPlacement!;
  const plot = draftOfEntry(context, pending.typeId, pending.candidates[0]!);
  const reason = placement.factionPlotReason(faction, placement.factionSiteDraft(faction, plot));
  if (reason) return dropCandidate(context, faction, state, pending, { now, reason });
  pending.stage = PLANNER_STAGE_ROAD;
  return PLANNER_IDLE;
};

const roadStep = (context: SettlementContext, faction: number, state: PlannerState, pending: PlannerPending,
  now: number) => {
  const placement = context.factionPlacement!, home = findFactionHome(context, faction);
  const site = placement.factionSiteDraft(faction, draftOfEntry(context, pending.typeId, pending.candidates[0]!));
  const target = home && roadTargetOf(context, faction, home, site);
  if (!target) return dropCandidate(context, faction, state, pending, { now, reason: NO_ROAD_LINK });
  pending.road = [];
  const joins = !checkedPlan || samePoint(target, site.access);
  if (!joins) for (const { x, z } of checkedPlan!.points) pending.road.push(x, z);
  pending.stage = PLANNER_STAGE_PLACE;
  return PLANNER_IDLE;
};

/** The waiting road, if it still crosses no building plot (else it is planned again between its ends). */
const pendingRoad = (context: SettlementContext, road: readonly number[]): Pick<RoadPlan, "points"> | undefined => {
  const { cellsX } = context.options.world, points: RoadPoint[] = [];
  for (let index = 0; index < road.length; index += 2) {
    const x = road[index]!, z = road[index + 1]!;
    if (context.occupied[Math.floor(z) * cellsX + Math.floor(x)] === 1) return undefined;
    points.push({ x, z });
  }
  return { points };
};

const placeStep = (context: SettlementContext, faction: number, state: PlannerState, pending: PlannerPending,
  now: number) => {
  const placement = context.factionPlacement!, { road, typeId } = pending;
  const plot = draftOfEntry(context, typeId, pending.candidates[0]!);
  const placed = placement.placeFactionBuilding(faction, plot);
  if (!placed.building) {
    // The plot or the stock changed since its checks: a plot refusal is remembered; the goal backs off.
    const reason = placement.factionPlotReason(faction, placement.factionSiteDraft(faction, plot));
    if (reason) rememberRefusedPlot(context, faction, state, typeId, pending.candidates[0]!, { now, reason });
    state.pending = undefined;
    reportGoalRefused(faction, now, typeId, placed.reason ?? SITE_NOT_PLACED);
    return PLANNER_REFUSED;
  }
  state.pending = undefined;
  if (!road.length) return PLANNER_PLACED;
  const plan = pendingRoad(context, road);
  if (plan) placement.layFactionRoad(faction, plan);
  else placement.connectFactionRoads(faction, { x: road[0]!, z: road[1]! }, { x: road.at(-2)!, z: road.at(-1)! });
  return PLANNER_PLACED;
};

/** One step of the waiting placement, once per tick: idle (more steps follow), placed, retry or refused. */
export const stepPlannerPlacement = (context: SettlementContext, faction: number, state: PlannerState,
  now: number) => {
  const { pending } = state;
  if (!pending || !context.factionPlacement) return PLANNER_IDLE;
  if (pending.stage === PLANNER_STAGE_CHECK) return checkStep(context, faction, state, pending, now);
  if (pending.stage === PLANNER_STAGE_ROAD) return roadStep(context, faction, state, pending, now);
  return placeStep(context, faction, state, pending, now);
};
