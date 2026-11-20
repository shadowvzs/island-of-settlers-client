import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import { nearestClearCell } from "./boat-fishing-nets";
import { classifyBoatWater, isSkiffWaterClear } from "./boat-fishing-water";
import { FISHER_BOAT_LEG_SAMPLE, FISHER_BOAT_ROUTE_CACHE } from "./constants";
import { findSeaRoute } from "./settlement-sea-navigation";
import { straightenSeaRoute } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

const caches = new WeakMap<WorldData, { revision: number; routes: Map<string, SettlementPoint[] | null> }>();

const legClear = (world: WorldData, clear: Uint8Array, from: SettlementPoint, to: SettlementPoint) => {
  const samples = Math.max(1, Math.ceil(DMath.hypot(to.x - from.x, to.z - from.z) / FISHER_BOAT_LEG_SAMPLE));
  for (let index = 0; index <= samples; index++) {
    const x = from.x + (to.x - from.x) * index / samples, z = from.z + (to.z - from.z) * index / samples;
    if (!clear[Math.floor(z) * world.cellsX + Math.floor(x)]) return false;
    if (!isSkiffWaterClear(world, x, z)) return false;
  }
  return true;
};

const planRoute = (world: WorldData, launch: SettlementPoint, net: SettlementPoint) => {
  const classes = classifyBoatWater(world);
  const start = nearestClearCell(world, classes, launch);
  if (start < 0) return null;
  const first = { x: start % world.cellsX + .5, z: Math.floor(start / world.cellsX) + .5 };
  const clear = (from: SettlementPoint, to: SettlementPoint) => legClear(world, classes.clear, from, to);
  if (!clear(launch, first)) return null;
  const cells = clear(first, net) ? [{ ...net }] : findSeaRoute(world, classes.clear, first, net, clear);
  if (!cells) return null;
  return [{ x: launch.x, z: launch.z }, first, ...straightenSeaRoute(first, cells, clear)];
};

/**
 * The skiff's rowing route from its launch water to a net point, over skiff-clear water of the same
 * component (FISHER-BOAT §2). Deterministic and never saved: a restored trip recomputes it.
 */
export const fisherBoatRoute = (world: WorldData, launch: SettlementPoint, net: SettlementPoint) => {
  const revision = world.terrainRevision ?? 0;
  let cache = caches.get(world);
  if (cache?.revision !== revision) {
    cache = { revision, routes: new Map() };
    caches.set(world, cache);
  }
  const key = `${launch.x},${launch.z}:${net.x},${net.z}`;
  if (cache.routes.has(key)) return cache.routes.get(key)!;
  const route = planRoute(world, launch, net);
  if (cache.routes.size >= FISHER_BOAT_ROUTE_CACHE) cache.routes.delete(cache.routes.keys().next().value!);
  cache.routes.set(key, route);
  return route;
};

export const fisherBoatRouteLength = (route: readonly SettlementPoint[]) => {
  let length = 0;
  for (let index = 1; index < route.length; index++)
    length += DMath.hypot(route[index]!.x - route[index - 1]!.x, route[index]!.z - route[index - 1]!.z);
  return length;
};
