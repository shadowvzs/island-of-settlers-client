import { DMath } from "../math/deterministic-math";
import { navigationRevisionKey } from "./settlement-revision-key";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export interface CorridorReservation {
  actor: number;
  cells: readonly string[];
  expiresAtTick: number;
  phase: string;
  revision: string;
}

export interface CorridorAcquireResult {
  conflict?: number;
  ok: boolean;
  reason?: "stationary" | "reservation";
  reservation?: CorridorReservation;
}

const reservations = new WeakMap<SettlementContext, Map<number, CorridorReservation>>();
/** A reservation that is not refreshed by its owner expires after this many logical ticks. */
const CORRIDOR_RESERVATION_TTL_TICKS = 600;
const nowTick = (context: SettlementContext) => context.clock?.tick() ?? 0;
const prune = (context: SettlementContext) => {
  const map = reservations.get(context);
  if (!map) return;
  const now = nowTick(context);
  for (const [uid, reservation] of map)
    if (reservation.expiresAtTick <= now) map.delete(uid);
};
const mapFor = (context: SettlementContext) => {
  let map = reservations.get(context);
  if (!map) { map = new Map(); reservations.set(context, map); }
  return map;
};
const cell = (point: SettlementPoint) => `${Math.floor(point.x * 2)},${Math.floor(point.z * 2)}`;
const actorBodyRadius = (actor: SettlementActor) => {
  if (actor.mounted) return 1.05;
  return actor.handcart ? .45 : .3;
};
const pointToPathDistance = (point: SettlementPoint, path: readonly SettlementPoint[]) => {
  let best = Infinity;
  for (let index = 1; index < path.length; index++) {
    const start = path[index - 1]!, end = path[index]!;
    const dx = end.x - start.x, dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
      : 0;
    best = Math.min(best, DMath.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount)));
  }
  return best;
};

/** Half-cell sampling; the corridor is a coarse navigation footprint, not a rendering path. */
const corridorCells = (path: readonly SettlementPoint[], radius = .25) => {
  const cells = new Set<string>();
  const add = (point: SettlementPoint) => {
    if (radius <= 0) { cells.add(cell(point)); return; }
    cells.add(cell({ x: point.x - radius, z: point.z - radius }));
    cells.add(cell({ x: point.x + radius, z: point.z - radius }));
    cells.add(cell({ x: point.x - radius, z: point.z + radius }));
    cells.add(cell({ x: point.x + radius, z: point.z + radius }));
    cells.add(cell(point));
  };
  let previous: SettlementPoint | undefined;
  for (const point of path) {
    if (!previous) { add(point); previous = point; continue; }
    const distance = DMath.hypot(point.x - previous.x, point.z - previous.z);
    const steps = Math.max(1, Math.ceil(distance / .5));
    for (let step = 1; step <= steps; step++)
      add({
        x: previous.x + (point.x - previous.x) * step / steps,
        z: previous.z + (point.z - previous.z) * step / steps
      });
    previous = point;
  }
  return [...cells];
};

/**
 * Claim a complete corridor for one actor. The caller must still run moveActorStep; this only owns
 * conflict detection until a movement layer is able to skip ticks safely.
 */
export const acquireCorridor = (
  context: SettlementContext, actor: SettlementActor, path: readonly SettlementPoint[],
  phase = actor.phase, refresh = false, radius = .25, checkActors = true
): CorridorAcquireResult => {
  const cells = corridorCells(path, radius);
  if (!cells.length) return { ok: false };
  prune(context);
  const map = mapFor(context), own = new Set(cells);
  const existing = map.get(actor.uid);
  if (!refresh && existing && existing.phase === phase && existing.revision === navigationRevisionKey(context) &&
    existing.cells.length === cells.length && existing.cells.every((key, index) => key === cells[index]))
    return { ok: true, reservation: existing };
  if (checkActors) for (const other of context.actors ?? []) {
    if (other.uid === actor.uid || !other.visible) continue;
    if (pointToPathDistance(other, path) < radius + actorBodyRadius(other))
      return { conflict: other.uid, ok: false, reason: "stationary" };
  }
  for (const [uid, reservation] of map) {
    if (uid === actor.uid) continue;
    if (reservation.cells.some(key => own.has(key))) return { conflict: uid, ok: false, reason: "reservation" };
  }
  const reservation: CorridorReservation = {
    actor: actor.uid, cells, expiresAtTick: nowTick(context) + CORRIDOR_RESERVATION_TTL_TICKS,
    phase, revision: navigationRevisionKey(context)
  };
  map.set(actor.uid, reservation);
  return { ok: true, reservation };
};

/** Extend a lease only after the owner actually made movement progress. */
export const refreshCorridor = (context: SettlementContext, uid: number) => {
  const reservation = reservations.get(context)?.get(uid);
  if (reservation) reservation.expiresAtTick = nowTick(context) + CORRIDOR_RESERVATION_TTL_TICKS;
};

export const releaseCorridor = (context: SettlementContext, uid: number) => {
  reservations.get(context)?.delete(uid);
};

export const corridorReservation = (context: SettlementContext, uid: number) => {
  prune(context);
  return reservations.get(context)?.get(uid);
};

export const isCorridorCellReserved = (
  context: SettlementContext, point: SettlementPoint, excludeUid?: number
) => {
  prune(context);
  const key = cell(point);
  for (const [uid, reservation] of mapFor(context))
    if (uid !== excludeUid && reservation.cells.includes(key)) return uid;
  return undefined;
};

export const clearCorridorReservations = (context: SettlementContext) => reservations.delete(context);

export type SavedCorridorReservations = [
  actor: number, phase: string, revision: string, expiresAtTick: number, cells: string[]
][];

export const saveCorridorReservations = (context: SettlementContext): SavedCorridorReservations => {
  prune(context);
  return [...(reservations.get(context) ?? new Map()).values()]
    .sort((first, second) => first.actor - second.actor)
    .map(reservation => [reservation.actor, reservation.phase, reservation.revision,
      reservation.expiresAtTick, [...reservation.cells]]);
};

export const restoreCorridorReservations = (
  context: SettlementContext, saved: SavedCorridorReservations | undefined
) => {
  const map = new Map<number, CorridorReservation>();
  for (const [actor, phase, revisionValue, expiresAtTick, cells] of saved ?? []) {
    if (!Number.isSafeInteger(actor) || typeof phase !== "string" ||
      typeof revisionValue !== "string" || !Number.isSafeInteger(expiresAtTick) ||
      !Array.isArray(cells) || !cells.every(value => typeof value === "string")) continue;
    map.set(actor, { actor, cells: [...cells], expiresAtTick, phase, revision: revisionValue });
  }
  reservations.set(context, map);
};
