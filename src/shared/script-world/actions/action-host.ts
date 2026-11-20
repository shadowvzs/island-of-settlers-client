import { secondsToTicks } from "../../../../../island-of-settlers-shared/src/time/constants";
import {
  type MapRegion, rasterizeRegion
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { ScriptEngine } from "../../../../../island-of-settlers-shared/src/script/engine/engine";
import type { ScriptEvalScope } from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import type { ActorSelector } from "../../../../../island-of-settlers-shared/src/script/types/actors";
import type { PlayerFilter } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type { ActionArg, ActionOutcome } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import type { ActorHandleValue, Expr } from "../../../../../island-of-settlers-shared/src/script/types/values";
import { DMath } from "../../math/deterministic-math";
import { isNavigationClear } from "../../settlement/settlement-navigation";
import type { SettlementActor, SettlementContext, SettlementPoint } from "../../settlement/settlement-types";
import { findUnit, type ScriptGenerations } from "../script-actors";
import type { ScriptMembers } from "../script-world-members";
import type { WorldEnvironment } from "../world-environment";
import type { ScriptActionState } from "./action-state";
import { BODY_CLEARANCE, GUARANTEED_SEARCH_RADIUS } from "./constants";

/**
 * What every presence/movement action handler shares (TRG5a): the island, the engine, the saved action state,
 * argument evaluation, unit targets and free places inside a region.
 */
export interface ScriptActionHost {
  context: SettlementContext;
  engine: () => ScriptEngine;
  /** The island's world environment (ENV0); absent when the script never reads the hour or the weather. */
  environment: () => WorldEnvironment | undefined;
  generations: ScriptGenerations;
  /** Guaranteed mode (§6.6, CIN4 hook): actions never fail for lack of a path or room. */
  guaranteed: () => boolean;
  members: ScriptMembers;
  state: ScriptActionState;
}

export const scriptTickOf = (host: ScriptActionHost) => host.engine().state.scriptTick;

export const ticksOfMs = (ms: number) => secondsToTicks(Math.max(0, ms) / 1000);

/** A new action id when the step waits for it (pending result), else null. */
export const takeActionId = (host: ScriptActionHost) => host.state.nextActionId++;

const isExpr = (arg: ActionArg | undefined): arg is Expr =>
  typeof arg === "object" && arg !== null && !Array.isArray(arg) && "k" in arg && arg.k !== "ref";

export const valueArg = (scope: ScriptEvalScope, arg: ActionArg | undefined) =>
  isExpr(arg) ? scope.evaluate(arg) : null;

export const numberArg = (scope: ScriptEvalScope, arg: ActionArg | undefined, fallback: number) => {
  const value = valueArg(scope, arg);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const booleanArg = (scope: ScriptEvalScope, arg: ActionArg | undefined, fallback: boolean) => {
  const value = valueArg(scope, arg);
  return typeof value === "boolean" ? value : fallback;
};

export const stringArg = (scope: ScriptEvalScope, arg: ActionArg | undefined, fallback: string) => {
  const value = valueArg(scope, arg);
  return typeof value === "string" ? value : fallback;
};

export const refIdArg = (arg: ActionArg | undefined) =>
  (arg as { id?: string; k?: string } | null | undefined)?.k === "ref" ? (arg as { id: string }).id : undefined;

/** The faction a player argument names (`slot`), or null (neutral, groups). */
export const factionArg = (arg: ActionArg | undefined) => {
  const filter = arg as PlayerFilter | undefined;
  return filter?.kind === "slot" ? filter.faction : null;
};

export interface UnitTarget {
  actor: SettlementActor;
  handle: ActorHandleValue;
}

/** Live units a selector argument names (other spaces are not handled by these actions). */
export const unitTargets = (host: ScriptActionHost, scope: ScriptEvalScope, arg: ActionArg | undefined) => {
  const selector = arg as ActorSelector | undefined;
  if (!selector || typeof selector !== "object" || !("kind" in selector)) return [];
  return scope.resolveActors(selector).flatMap((handle): UnitTarget[] => {
    if (handle.space !== "actor") return [];
    const actor = findUnit(host.context, handle.id);
    return actor ? [{ actor, handle }] : [];
  });
};

export const regionOf = (host: ScriptActionHost, arg: ActionArg | undefined) => {
  const id = refIdArg(arg);
  return id === undefined ? undefined : host.members.region(id);
};

export const regionCentre = ({ shape }: MapRegion): SettlementPoint => {
  if (shape.kind === "rect") return { x: (shape.minX + shape.maxX) / 2, z: (shape.minZ + shape.maxZ) / 2 };
  if (shape.kind === "circle") return { x: shape.centerX, z: shape.centerZ };
  return { x: shape.x, z: shape.z };
};

/** The circle round a region: a circle's own, a rectangle's corners, `pointRadius` round a point. */
export const regionCircle = (region: MapRegion, pointRadius: number) => {
  const { shape } = region, centre = regionCentre(region);
  if (shape.kind === "circle") return { ...centre, radius: shape.radius };
  if (shape.kind !== "rect") return { ...centre, radius: pointRadius };
  return { ...centre, radius: DMath.hypot(shape.maxX - shape.minX, shape.maxZ - shape.minZ) / 2 };
};

/** The facing a point region carries (radians), else undefined. */
export const regionFacing = ({ shape }: MapRegion) => shape.kind === "point" ? shape.facing : undefined;

const cellCentre = (cell: number, cellsX: number): SettlementPoint =>
  ({ x: cell % cellsX + .5, z: Math.floor(cell / cellsX) + .5 });

const byDistanceTo = (centre: SettlementPoint) => (a: SettlementPoint, b: SettlementPoint) =>
  DMath.hypot(a.x - centre.x, a.z - centre.z) - DMath.hypot(b.x - centre.x, b.z - centre.z) ||
  a.z - b.z || a.x - b.x;

/** Cells around the centre out to the guaranteed search radius (expanding search, §6.6). */
const ringCells = (centre: SettlementPoint, cellsX: number, cellsZ: number) => {
  const cells: SettlementPoint[] = [];
  const x0 = Math.floor(centre.x), z0 = Math.floor(centre.z);
  for (let dz = -GUARANTEED_SEARCH_RADIUS; dz <= GUARANTEED_SEARCH_RADIUS; dz++) {
    for (let dx = -GUARANTEED_SEARCH_RADIUS; dx <= GUARANTEED_SEARCH_RADIUS; dx++) {
      const x = x0 + dx, z = z0 + dz;
      if (x >= 0 && z >= 0 && x < cellsX && z < cellsZ) cells.push({ x: x + .5, z: z + .5 });
    }
  }
  return cells;
};

/**
 * Candidate places for units in a region, nearest to its centre first (ties by cell); guaranteed mode appends the
 * cells around it, so a spawn never ends `blocked` there.
 */
export const regionPlaces = (host: ScriptActionHost, region: MapRegion) => {
  const { cellsX, cellsZ } = host.context.options.world;
  const centre = regionCentre(region), order = byDistanceTo(centre);
  const inside = rasterizeRegion(region, cellsX, cellsZ).map(cell => cellCentre(cell, cellsX)).sort(order);
  if (region.shape.kind === "point") inside.unshift({ x: region.shape.x, z: region.shape.z });
  if (!host.guaranteed()) return inside;
  return [...inside, ...ringCells(centre, cellsX, cellsZ).sort(order)];
};

/** Open ground with no other visible body on it (the spawn rule), ignoring `self`. */
export const isPlaceClear = (context: SettlementContext, point: SettlementPoint, self?: number) =>
  isNavigationClear(context, point) && !context.actors.some(actor => actor.uid !== self && actor.visible &&
    DMath.hypot(actor.x - point.x, actor.z - point.z) < BODY_CLEARANCE);

/**
 * Ends one record of an action; the action's outcome reaches its waiting run when the last record sharing its id
 * ends (a group outcome is the outcome of its last member).
 */
export const finishRecord = <Entry extends { actionId: number | null }>(
  host: ScriptActionHost, list: Entry[], record: Entry, outcome: ActionOutcome
) => {
  const index = list.indexOf(record);
  if (index >= 0) list.splice(index, 1);
  if (record.actionId === null || list.some(other => other.actionId === record.actionId)) return;
  host.engine().completeAction(record.actionId, outcome);
};
