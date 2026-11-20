import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../../shared/math/deterministic-math";
import {
  findGroundPath,
  isGroundSegmentClear,
  isNavigationClear} from "../../shared/settlement/settlement-navigation";
import type { SettlementContext, SettlementPoint } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";

const contexts = new WeakMap<WorldData, SettlementContext>();
const caches = new WeakMap<WorldData, { revision: string; points: Map<string, SettlementPoint> }>();
/** Site piles stay put; a nearby tree must not make their sole hardcoded handoff unreachable. */
export const constructionStockApproach = (
  world: WorldData,
  access: SettlementPoint,
  stock: SettlementPoint,
  nominal: SettlementPoint,
  isOccupied?: (x: number, z: number) => boolean
): SettlementPoint => {
  let context = contexts.get(world);
  if (!context) {
    // This selector checks physical nature. Actual actor routing still checks building plots and people.
    context = { options: { world }, buildings: [], actors: [], occupied: new Uint8Array(0) } as unknown as SettlementContext;
    contexts.set(world, context);
  }
  const occupiedAt = (point: SettlementPoint) => isOccupied?.(point.x, point.z) ?? false;
  const revision = `${world.buildRevision ?? 0}:${world.terrainRevision ?? 0}:${world.props.count}`;
  let cache = caches.get(world);
  if (!cache || cache.revision !== revision) {
    cache = { revision, points: new Map() };
    caches.set(world, cache);
  }
  const key = `${access.x},${access.z}:${stock.x},${stock.z}:${nominal.x},${nominal.z}`;
  const cached = cache.points.get(key);
  if (cached && !occupiedAt(cached) &&
    isNavigationClear(context, cached, false, false, WORKER_RADIUS) &&
    isGroundSegmentClear(context, access, cached, occupiedAt)) return cached;
  const remember = (point: SettlementPoint) => {
    cache.points.set(key, point);
    return point;
  };
  const dx = nominal.x - stock.x;
  const dz = nominal.z - stock.z;
  const alternatives: SettlementPoint[] = [];
  for (const angle of [
    0,
    Math.PI / 6,
    -Math.PI / 6,
    Math.PI / 3,
    -Math.PI / 3,
    Math.PI / 2,
    -Math.PI / 2,
    Math.PI * 2 / 3,
    -Math.PI * 2 / 3,
    Math.PI * 5 / 6,
    -Math.PI * 5 / 6,
    Math.PI
  ]) {
    const point = {
      x: stock.x + dx * DMath.cos(angle) - dz * DMath.sin(angle),
      z: stock.z + dx * DMath.sin(angle) + dz * DMath.cos(angle)
    };
    if (occupiedAt(point) || !isNavigationClear(context, point, false, false, WORKER_RADIUS)) continue;
    if (isGroundSegmentClear(context, access, point, occupiedAt)) return remember(point);
    alternatives.push(point);
  }
  // A dry stance around a pile may require a short real detour around surrounding trunks.
  for (const alternative of alternatives) {
    if (findGroundPath(context, access, alternative, occupiedAt, undefined, 0.125, 4096))
      return remember(alternative);
  }
  // A neighbour may occupy every nominal side. The building's own access is the one point the
  // placement rules guarantee to keep clear; the handoff can still reach the pile inside.
  return remember(access);
};
