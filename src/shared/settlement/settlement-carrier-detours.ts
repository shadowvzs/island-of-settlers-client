import { DMath } from "../math/deterministic-math";
import { getBuilding } from "./settlement-building-index";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { settlementWorkCounters } from "./settlement-work-counters";
interface Retry {
  cursor: number;
  path: SettlementPoint[];
  phase: string;
  remaining: number;
}
const retries = new WeakMap<SettlementActor, Retry>();
const state = (actor: SettlementActor) => {
  let value = retries.get(actor);
  if (!value || value.path !== actor.path || value.phase !== actor.phase) {
    value = {
      cursor: actor.pathIndex + 1,
      path: actor.path,
      phase: actor.phase,
      remaining: value?.phase === actor.phase ? value.remaining : 0
    };
    retries.set(actor, value);
  }
  return value;
};
/** Failed crowd detours retry at most once per simulated second, rather than every fixed tick. */
export const canRetryCarrierDetour = (actor: SettlementActor, dt: number, needed: boolean,
  grant: () => boolean = () => true) => {
  const retry = state(actor);
  retry.remaining = Math.max(0, retry.remaining - dt);
  if (!needed || retry.remaining > 0) return false;
  if (!grant()) return false;
  retry.remaining = 1;
  return true;
};
/** Bound expensive A* calls; rotate through later rejoin points on subsequent attempts. */
export const carrierDetourCandidates = (
  actor: SettlementActor,
  allowed: (point: SettlementPoint) => boolean
) => {
  const retry = state(actor),
    indices: number[] = [];
  let cursor = Math.max(actor.pathIndex + 1, retry.cursor);
  for (; cursor < actor.path.length && indices.length < 4; cursor++) {
    const point = actor.path[cursor]!;
    if (DMath.hypot(point.x - actor.x, point.z - actor.z) >= 0.8 && allowed(point))
      indices.push(cursor);
  }
  retry.cursor = cursor >= actor.path.length ? actor.pathIndex + 1 : cursor;
  return indices;
};

interface JourneyProgress {
  phase: string;
  destinationX: number;
  destinationZ: number;
  closest: number;
  path: SettlementPoint[];
  elapsed: number;
}
/**
 * `replaced`: the remembered path is no longer the actor's current one (the next check starts afresh), which a
 * load must keep: both records compare path identity.
 */
interface SavedJourney {
  phase: string; destinationX: number; destinationZ: number; closest: number; elapsed: number; replaced?: true;
}
/**
 * The start of the straight leg the carrier walks on its current path waypoint (format 21, AI-RELOAD-DRIFT): its
 * clear-leg proof runs from there, so a reload that started the leg afresh at the carrier proved another segment.
 */
interface SavedLeg { directionX?: number; directionZ?: number; x: number; z: number }
/** The retry fields (`phase`, `pathIndex`, `cursor`, `remaining`) are present only for a saved retry. */
export interface SavedCarrierDetour {
  actor: number;
  phase?: string;
  pathIndex?: number;
  cursor?: number;
  remaining?: number;
  replaced?: true;
  journey?: SavedJourney;
  leg?: SavedLeg;
}
const replacedFlag = (path: SettlementPoint[], actor: SettlementActor) =>
  path === actor.path ? {} : { replaced: true as const };
/** Never an actor's path: a restored record whose path was replaced compares unequal. */
const replacedPath = (): SettlementPoint[] => [];
/**
 * Retries and journeys are saved even while dormant (another phase or destination): a later check may find
 * them current again, and an uninterrupted run resumes them then.
 */
const saveRetry = (actor: SettlementActor): Omit<SavedCarrierDetour, "actor" | "journey"> => {
  const retry = retries.get(actor);
  if (!retry) return {};
  return { phase: retry.phase, pathIndex: actor.pathIndex, cursor: retry.cursor, remaining: retry.remaining,
    ...replacedFlag(retry.path, actor) };
};
const saveJourney = (actor: SettlementActor): Pick<SavedCarrierDetour, "journey"> => {
  const journey = journeys.get(actor);
  if (!journey) return {};
  const { closest, destinationX, destinationZ, elapsed, path, phase } = journey;
  return { journey: { closest, destinationX, destinationZ, elapsed, phase, ...replacedFlag(path, actor) } };
};
/** A leg of another path or waypoint starts afresh at the next check, exactly as no leg does. */
const saveLeg = (actor: SettlementActor): Pick<SavedCarrierDetour, "leg"> => {
  const origin = legOrigins.get(actor);
  if (!origin || origin.path !== actor.path || origin.pathIndex !== actor.pathIndex) return {};
  const { directionX, directionZ, x, z } = origin;
  return { leg: { ...(directionX === undefined ? {} : { directionX }),
    ...(directionZ === undefined ? {} : { directionZ }), x, z } };
};
/** Persist the bounded retry cursor, stall age and leg start; otherwise a reload starts them over. */
export const saveCarrierDetourState = (context: SettlementContext): SavedCarrierDetour[] =>
  context.actors.flatMap(actor => {
    const entry: SavedCarrierDetour = { actor: actor.uid, ...saveRetry(actor), ...saveJourney(actor),
      ...saveLeg(actor) };
    return entry.phase === undefined && !entry.journey && !entry.leg ? [] : [entry];
  });
export const restoreCarrierDetourState = (context: SettlementContext, saved?: readonly SavedCarrierDetour[]) => {
  if (!saved) return;
  const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
  for (const { actor: uid, cursor, journey, leg, phase, remaining, replaced } of saved) {
    const actor = actors.get(uid);
    if (!actor) continue;
    if (leg) legOrigins.set(actor, { ...leg, path: actor.path, pathIndex: actor.pathIndex });
    if (phase !== undefined && cursor !== undefined && remaining !== undefined)
      retries.set(actor, { cursor, path: replaced ? replacedPath() : actor.path, phase, remaining });
    if (!journey) continue;
    const { replaced: journeyReplaced, ...progress } = journey;
    journeys.set(actor, { ...progress, path: journeyReplaced ? replacedPath() : actor.path });
  }
};
const journeys = new WeakMap<SettlementActor, JourneyProgress>();
const suffixLengths = new WeakMap<SettlementPoint[], Float64Array>();
/** Route length from each waypoint to the end, built once per path object (paths are replaced,
 * never mutated). Float64 keeps the stall threshold comparison equal to the old forward sum. */
const pathSuffixLengths = (path: SettlementPoint[]) => {
  let suffix = suffixLengths.get(path);
  if (suffix) return suffix;
  suffix = new Float64Array(path.length);
  for (let index = path.length - 2; index >= 0; index--) {
    const point = path[index]!,
      next = path[index + 1]!;
    suffix[index] = suffix[index + 1]! + DMath.hypot(next.x - point.x, next.z - point.z);
  }
  suffixLengths.set(path, suffix);
  return suffix;
};
/** O(1) remaining route length: cached suffix plus the live distance to the next waypoint. */
export const remainingRouteLength = (actor: SettlementActor) => {
  const next = actor.path[actor.pathIndex];
  if (!next) return 0;
  return pathSuffixLengths(actor.path)[actor.pathIndex]! + DMath.hypot(next.x - actor.x, next.z - actor.z);
};
/** Follow remaining route length, preserving failure age across equivalent replacement paths. */
export const carrierJourneyStalled = (actor: SettlementActor, dt: number) => {
  const destination = actor.path.at(-1);
  if (!destination || actor.pathIndex >= actor.path.length) {
    journeys.delete(actor);
    return false;
  }
  const distance = remainingRouteLength(actor);
  let journey = journeys.get(actor);
  if (
    !journey ||
    journey.phase !== actor.phase ||
    journey.destinationX !== destination.x ||
    journey.destinationZ !== destination.z
  ) {
    journey = {
      phase: actor.phase,
      destinationX: destination.x,
      destinationZ: destination.z,
      closest: distance,
      path: actor.path,
      elapsed: 0
    };
    journeys.set(actor, journey);
  }
  if (journey.path !== actor.path) {
    journey.path = actor.path;
    journey.closest = distance;
  }
  if (!actor.queueTarget && distance < journey.closest - 0.12) {
    journey.closest = distance;
    journey.elapsed = 0;
  } else journey.elapsed += dt;
  return journey.elapsed >= 6;
};

interface LegOrigin {
  directionX?: number; directionZ?: number; path: SettlementPoint[]; pathIndex: number; x: number; z: number;
}
interface ProvenLeg {
  buildRevision: number;
  origin: LegOrigin;
  props: number;
  stockBuilding: number | undefined;
  stockSignature: number;
}
/** Yard stock piles change which court points are walkable, so they are part of a proof's key. */
const goodsSignature = (goods: Record<string, number>) => {
  let signature = 0;
  for (const ware in goods) {
    let code = 0;
    for (let index = 0; index < ware.length; index++) code = (code * 31 + ware.charCodeAt(index)) | 0;
    signature = (signature + code * ((goods[ware] ?? 0) + 1)) | 0;
  }
  return signature;
};
const courtStockSignature = (context: SettlementContext, actor: SettlementActor) => {
  const building = getBuilding(context, actor.stockBuilding);
  return building ? (goodsSignature(building.input) * 7 + goodsSignature(building.output)) | 0 : 0;
};
/** Off its straight line by more than this (a sidestep, a court slot walk) the carrier starts a new leg. */
const LEG_TOLERANCE = 1e-4;
const legOrigins = new WeakMap<SettlementActor, LegOrigin>();
/** Still on the straight line it has walked since the origin (toward its waypoint or road lane). */
const isOnLeg = (actor: SettlementActor, origin: LegOrigin) => {
  const ox = actor.x - origin.x, oz = actor.z - origin.z, moved = DMath.hypot(ox, oz);
  if (moved <= LEG_TOLERANCE) return true;
  if (origin.directionX === undefined || origin.directionZ === undefined) {
    origin.directionX = ox / moved; origin.directionZ = oz / moved;
    return true;
  }
  const along = ox * origin.directionX + oz * origin.directionZ;
  return along > 0 && Math.abs(ox * origin.directionZ - oz * origin.directionX) <= LEG_TOLERANCE;
};
/**
 * Where the carrier started its current straight leg. Walking straight on keeps the origin; a new
 * waypoint, a new path or any turn or displacement starts a new leg at the current position.
 */
const carrierLegOrigin = (actor: SettlementActor): SettlementPoint => {
  const origin = legOrigins.get(actor);
  if (origin && origin.path === actor.path && origin.pathIndex === actor.pathIndex && isOnLeg(actor, origin))
    return origin;
  const fresh = { path: actor.path, pathIndex: actor.pathIndex, x: actor.x, z: actor.z };
  legOrigins.set(actor, fresh);
  return fresh;
};
const provenLegs = new WeakMap<SettlementActor, ProvenLeg>();
let legCacheEnabled = true;
/** Equivalence tests compare traces with the proof cache on and off. */
export const setCarrierLegCacheEnabled = (enabled: boolean) => {
  legCacheEnabled = enabled;
};
const isProvenLeg = (context: SettlementContext, actor: SettlementActor, leg: ProvenLeg, origin: SettlementPoint) =>
  legCacheEnabled &&
  leg.origin === origin &&
  leg.buildRevision === (context.options.world.buildRevision ?? 0) &&
  leg.props === context.options.world.props.count &&
  leg.stockBuilding === actor.stockBuilding &&
  leg.stockSignature === courtStockSignature(context, actor);
/**
 * The carrier's current straight leg is proven statically clear from its origin, so the proof is the
 * same on every tick of the leg and can be reused until terrain, props or the court stock change.
 */
export const isCarrierLegClear = (
  context: SettlementContext,
  actor: SettlementActor,
  prove: (origin: SettlementPoint) => boolean
) => {
  const counters = settlementWorkCounters(context);
  const origin = carrierLegOrigin(actor) as LegOrigin;
  const leg = provenLegs.get(actor);
  if (leg && isProvenLeg(context, actor, leg, origin)) {
    counters.carrierSegmentSkips++;
    return true;
  }
  counters.carrierSegmentChecks++;
  if (!prove(origin)) {
    provenLegs.delete(actor);
    return false;
  }
  provenLegs.set(actor, {
    buildRevision: context.options.world.buildRevision ?? 0,
    origin,
    props: context.options.world.props.count,
    stockBuilding: actor.stockBuilding,
    stockSignature: courtStockSignature(context, actor)
  });
  return true;
};
