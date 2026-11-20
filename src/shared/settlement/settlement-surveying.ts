import { settlerTool } from "@shared/catalog";

import { DMath } from "../math/deterministic-math";
import { countIslandAction } from "../script-world/script-action-counters";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { HEADQUARTERS_TYPE_ID } from "./building-type-ids";
import { addGood, STORAGE_IDS } from "./production-rules";
import { nextScoutLeg, SCOUT_DISTANCE_LIMIT, SCOUT_LEG_LIMIT, SCOUT_LOOK_SECONDS,
  scoutCell, type ScoutExploration } from "./scout-exploration";
import { exitPath } from "./settlement-entrance";
import { civilianOwnerOf, economyOwnerOf, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { createActor, groundPath, moveActor, setActorPath } from "./settlement-paths";
import { availableIdleSettlers, ownerSpareSettlers } from "./settlement-population";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { isZoneSurveyed, type SurveyJob, type SurveyTarget, surveyTargets } from "./survey-targets";
export type { SurveyJob } from "./survey-targets";
export interface SurveyState {
  job: SurveyJob;
  origin: SettlementPoint;
  targets: SurveyTarget[];
  index: number;
  scout?: ScoutExploration;
}
const assignments = new WeakMap<SettlementContext, Map<number, SurveyState>>();
const states = (context: SettlementContext) => {
  let state = assignments.get(context);
  if (!state) {
    state = new Map();
    assignments.set(context, state);
  }
  return state;
};
export type SurveyAssignmentResult =
  { ok: true; actor: SettlementActor } | { ok: false; reason: string };
/**
 * Dispatch real ground-walking surveyors; Scouts require a fog target and one spyglass. `owner` is the economy that
 * sends one (a computer faction's geologist, EAI3c): its own storages, settlers, tools and surveyed deposits.
 */
export const assignSurveyJob = (
  context: SettlementContext,
  job: SurveyJob,
  target: SettlementPoint,
  owner = PLAYER_FACTION
): SurveyAssignmentResult => {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.z))
    return { ok: false, reason: "Choose reachable ground" };
  if (ownerSpareSettlers(context, owner, "worker") < 1)
    return { ok: false, reason: "No settlers available inside storage" };
  const targets = surveyTargets(context, job, target, owner);
  if (!targets.length) return { ok: false, reason: job === "Scout"
    ? "Choose undiscovered fog on reachable ground" : "No reachable unsurveyed deposit near this ground" };
  const tool = settlerTool(job)!;
  const stocked = context.buildings.filter(building => building.construction === 1 &&
    STORAGE_IDS.has(building.typeId) && economyOwnerOf(context, building) === owner &&
    (building.inventory[tool] ?? 0) > 0);
  if (!stocked.length) return { ok: false, reason: `No ${tool} available in storage` };
  const staffed = stocked.filter(building => availableIdleSettlers(context, building) > 0);
  if (!staffed.length) return { ok: false, reason: `No idle settler in storage with a ${tool}` };
  const homes = staffed
    .map((building) => {
      const path = groundPath(context, building.access, target);
      const route = path && { points: path, cost: path.reduce((sum, point, i) => {
        const previous = path[i - 1] ?? building.access;
        return sum + DMath.hypot(point.x - previous.x, point.z - previous.z);
      }, 0) };
      return { building, route };
    })
    .filter((entry) => entry.route)
    .sort((a, b) => a.route!.cost - b.route!.cost || a.building.uid - b.building.uid);
  const home = homes[0];
  if (!home) return { ok: false, reason: `The ${tool} is in storage, but no usable route reaches this ground` };
  const actor = createActor(context, job, home.building.uid);
  actor.tool = tool;
  addGood(home.building.inventory, tool, -1);
  states(context).set(actor.uid, { job, origin: { ...target }, targets, index: 0,
    scout: job === "Scout" ? { distance: 0, legDistance: 0,
      visited: [scoutCell(context.options.world, target)] } : undefined });
  setActorPath(actor, [...exitPath(home.building), ...home.route!.points], "assigned");
  return { ok: true, actor };
};
const isHeadquarters = (building: { typeId: number }) => building.typeId === HEADQUARTERS_TYPE_ID;
const returnHome = (context: SettlementContext, actor: SettlementActor, state: SurveyState) => {
  const owner = civilianOwnerOf(actor);
  const options = context.buildings.filter(building => building.construction === 1 &&
    STORAGE_IDS.has(building.typeId) && ownerOf(building) === owner &&
    (state.job === "Scout" || building.uid === actor.home));
  options.sort((a, b) => Number(isHeadquarters(b)) - Number(isHeadquarters(a)) || a.uid - b.uid);
  let destination: { home: typeof options[number]; path: SettlementPoint[] } | undefined;
  for (const home of options) {
    const path = groundPath(context, actor, home.access);
    if (path) { destination = { home, path }; break; }
  }
  if (!destination) {
    actor.phase = "surveyReturnWait";
    actor.action = "idle";
    actor.timer = 1;
    return;
  }
  actor.home = destination.home.uid;
  actor.building = destination.home.uid;
  actor.job = "Settler";
  setActorPath(actor, destination.path, "retire");
  states(context).delete(actor.uid);
};
const nextScoutTarget = (context: SettlementContext, actor: SettlementActor, state: SurveyState) => {
  const scout = state.scout!;
  const leg = nextScoutLeg(context, actor, scout);
  if (!leg) { returnHome(context, actor, state); return; }
  scout.legDistance = 0;
  state.targets = [leg.target]; state.index = 0;
  setActorPath(actor, leg.path, "surveyWalk");
};
const pauseScout = (context: SettlementContext, actor: SettlementActor, state: SurveyState) => {
  actor.phase = "surveyWork"; actor.action = "work"; actor.timer = SCOUT_LOOK_SECONDS; actor.animationTime = 0;
  const cell = scoutCell(context.options.world, actor);
  if (!state.scout!.visited.includes(cell)) state.scout!.visited.push(cell);
};
const nextTarget = (context: SettlementContext, actor: SettlementActor, state: SurveyState) => {
  while (state.index < state.targets.length) {
    const target = state.targets[state.index]!;
    const zone = target.zoneId ? context.options.world.mineZones.find(entry => entry.id === target.zoneId) : undefined;
    if (zone && isZoneSurveyed(context, zone, civilianOwnerOf(actor))) {
      state.index++;
      continue;
    }
    const path = groundPath(context, actor, target);
    if (path) {
      setActorPath(actor, path, "surveyWalk");
      return;
    }
    state.index++;
  }
  returnHome(context, actor, state);
};
/** The map editor may delete the deposit a geologist is walking to; it is then no target at all. */
const isTargetZoneRemoved = (context: SettlementContext, state: SurveyState) => {
  const zoneId = state.targets[state.index]?.zoneId;
  if (!zoneId) return false;
  return !context.options.world.mineZones.some(zone => zone.id === zoneId);
};
/**
 * The geologist found the target's deposit: the player's shows its signpost; a computer faction's is recorded only
 * in its own knowledge (its AI's surveyed deposits), never on the shared map.
 */
const surveyDeposit = (context: SettlementContext, actor: SettlementActor, target: SurveyTarget) => {
  const zone = target.zoneId ? context.options.world.mineZones.find(entry => entry.id === target.zoneId) : undefined;
  const owner = civilianOwnerOf(actor);
  if (!zone || isZoneSurveyed(context, zone, owner)) return;
  if (owner !== PLAYER_FACTION) { context.factionAi?.recordDeposit(owner, zone.id); return; }
  zone.surveyed = true;
  countIslandAction(context, "survey");
  context.options.onSurveyDeposit?.(zone.id);
  bumpBuildRevision(context.options.world, null);
};
/** True means this actor was handled here; false delegates normal workers/returning settlers. */
export const updateSurveyWorker = (
  context: SettlementContext,
  actor: SettlementActor,
  dt: number
): boolean => {
  const state = states(context).get(actor.uid);
  if (!state) return false;
  if (actor.phase === "surveyReturnWait") {
    actor.timer -= dt;
    if (actor.timer <= 0) returnHome(context, actor, state);
    return true;
  }
  if (actor.phase === "surveyWalk" && !state.scout && isTargetZoneRemoved(context, state)) {
    state.index++;
    nextTarget(context, actor, state);
    return true;
  }
  if (actor.phase === "assigned" || actor.phase === "surveyWalk") {
    const scout = actor.phase === "surveyWalk" ? state.scout : undefined;
    const remaining = scout ? Math.min(SCOUT_LEG_LIMIT - scout.legDistance, SCOUT_DISTANCE_LIMIT - scout.distance) : Infinity;
    const arrived = moveActor(context, actor, Math.min(dt, Math.max(0, remaining) / .9), scout ? moved => {
      scout.distance += moved; scout.legDistance += moved;
    } : undefined);
    if (scout) {
      if (scout.distance >= SCOUT_DISTANCE_LIMIT - 1e-6 || scout.legDistance >= SCOUT_LEG_LIMIT - 1e-6) {
        pauseScout(context, actor, state); return true;
      }
    }
    if (!arrived) return true;
    if (actor.phase === "assigned") {
      if (state.scout) nextScoutTarget(context, actor, state);
      else nextTarget(context, actor, state);
      return true;
    }
    if (state.scout) { pauseScout(context, actor, state); return true; }
    actor.phase = "surveyWork";
    actor.action = state.job === "Geologist" ? "work" : "idle";
    actor.timer = state.job === "Geologist" ? 4 : 1;
    return true;
  }
  if (actor.phase === "surveyWork") {
    actor.timer -= dt;
    if (actor.timer > 0) return true;
    if (state.scout) { nextScoutTarget(context, actor, state); return true; }
    surveyDeposit(context, actor, state.targets[state.index]!);
    state.index++;
    nextTarget(context, actor, state);
  }
  return true;
};

export const saveSurveyAssignments = (context: SettlementContext) => [...states(context)];
export const restoreSurveyAssignments = (context: SettlementContext, entries: [number, SurveyState][]) => {
  assignments.set(context, new Map(entries));
};
