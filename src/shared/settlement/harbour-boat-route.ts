import { LIGHTER_BEAM, LIGHTER_OAR_INBOARD, LIGHTER_OAR_LENGTH }
  from "../../render-common/ships/lighter-dimensions";
import { DMath } from "../math/deterministic-math";
import { sameMaskBytes } from "../world/mask-bytes";
import type { WorldData } from "../world/world-data";
import { countNavigation } from "./navigation-profile";
import { foundationRevision, localFoundationChanges } from "./settlement-foundation-changes";
import { findSeaRoute, refreshSeaMask, registerDerivedSeaMask } from "./settlement-sea-navigation";
import { straightenSeaRoute } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

/**
 * Boat-only water route (BOAT-P01): the hull and its outboard oars must have water the whole way.
 * The dedicated jetty and this route keep clear of every sea ship's berth, rig and approaches; a
 * nearby destination is not proof that a boat can row there (docs/archive/dated/harbour-landing-evaluation-current.md).
 */
export const BOAT_ROUTE_CLEARANCE = LIGHTER_BEAM / 2 + LIGHTER_OAR_LENGTH - LIGHTER_OAR_INBOARD;
/** Conservative hull-and-oars turning disk from the rejected short-landing study (1.983 tiles). */
export const BOAT_TURN_RADIUS = 1.983;
const LEG_SAMPLE = .4;
const ROUTE_CACHE_LIMIT = 128;

type BoatRoute = SettlementPoint[];
interface BoatCache {
  revision: string;
  routes: Map<string, BoatRoute | null>;
}
const caches = new WeakMap<WorldData, BoatCache>();

/** A summed-area mask of water with no dry cell inside the hull/oar envelope. */
const waterMask = (world: WorldData, sea: Uint8Array, radiusX: number, radiusZ: number) => {
  countNavigation("boat.waterMaskBuilds");
  const stride = world.cellsX + 1, summed = new Uint32Array(stride * (world.cellsZ + 1));
  for (let z = 1; z <= world.cellsZ; z++) for (let x = 1; x <= world.cellsX; x++)
    summed[z * stride + x] = Number(!sea[(z - 1) * world.cellsX + x - 1]) +
      summed[(z - 1) * stride + x]! + summed[z * stride + x - 1]! - summed[(z - 1) * stride + x - 1]!;
  const result = new Uint8Array(sea.length);
  for (let z = radiusZ; z < world.cellsZ - radiusZ; z++)
    for (let x = radiusX; x < world.cellsX - radiusX; x++) {
      const left = x - radiusX, right = x + radiusX + 1, top = z - radiusZ, bottom = z + radiusZ + 1;
      const dry = summed[bottom * stride + right]! - summed[top * stride + right]! -
        summed[bottom * stride + left]! + summed[top * stride + left]!;
      if (!dry) result[z * world.cellsX + x] = 1;
    }
  return result;
};

/** A boat route planner: hull/oar-clear water, straightened legs and cached pair routes. */
export const createBoatRoutePlanner = (world: WorldData, sea: Uint8Array) => {
  let revision = -1;
  let foundation = foundationRevision(world);
  let masks: { route: Uint8Array; turning: Uint8Array } | null = null;
  /** The sea bytes the masks were derived from: an unchanged sea keeps them (JETTY-FRAMES). */
  let maskSea = new Uint8Array(0);
  const build = (next: number) => {
    revision = next;
    if (masks && sameMaskBytes(maskSea, sea)) {
      countNavigation("boat.waterMaskKeeps");
      return;
    }
    const routeRadius = Math.ceil(BOAT_ROUTE_CLEARANCE), turnRadius = Math.ceil(BOAT_TURN_RADIUS);
    const route = waterMask(world, sea, routeRadius, routeRadius);
    masks = { route, turning: routeRadius === turnRadius ? route : waterMask(world, sea, turnRadius, turnRadius) };
    maskSea = sea.slice();
  };
  /** Masks are built on the first service/status check, not for every island at boot. */
  const refresh = () => {
    const next = world.terrainRevision ?? 0;
    if (masks && next === revision) return;
    // Foundation receipts prove every affected draft-water vertex kept its classification.
    // The connected sea and both hull/oar masks are then exactly unchanged, even nearby.
    // Unknown edits and changed coastlines deliberately take the complete rebuild path.
    if (masks && localFoundationChanges(world, foundation)) {
      registerDerivedSeaMask(world, sea);
      revision = next;
    } else {
      refreshSeaMask(world, sea);
      build(next);
    }
    foundation = foundationRevision(world);
    // Avoid predicates may depend on newly placed structures although water did not change.
    caches.delete(world);
  };
  const routeCell = (point: SettlementPoint) => Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  const wet = (point: SettlementPoint) => {
    const cell = routeCell(point);
    return point.x >= 0 && point.z >= 0 && point.x < world.cellsX && point.z < world.cellsZ &&
      masks!.route[cell] === 1;
  };
  /** A leg is rowable when its whole swept width stays in boat-clear water and out of `avoid`. */
  const legClear = (from: SettlementPoint, to: SettlementPoint, avoid?: (point: SettlementPoint) => boolean) => {
    const length = DMath.hypot(to.x - from.x, to.z - from.z);
    const samples = Math.max(1, Math.ceil(length / LEG_SAMPLE));
    for (let index = 0; index <= samples; index++) {
      const share = index / samples;
      const point = { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share };
      if (!wet(point) || avoid?.(point)) return false;
    }
    return true;
  };
  const route = (from: SettlementPoint, to: SettlementPoint,
    avoid?: (point: SettlementPoint) => boolean): BoatRoute | null => {
    refresh();
    const key = `${from.x.toFixed(2)},${from.z.toFixed(2)}:${to.x.toFixed(2)},${to.z.toFixed(2)}` +
      (avoid ? ":avoid" : "");
    let cache = caches.get(world);
    if (!cache) { cache = { revision: String(revision), routes: new Map() }; caches.set(world, cache); }
    if (cache.revision !== String(revision)) {
      cache = { revision: String(revision), routes: new Map() }; caches.set(world, cache);
    }
    if (cache.routes.has(key)) return cache.routes.get(key)!;
    let result: BoatRoute | null = null;
    if (wet(from) && wet(to)) {
      const clear = (a: SettlementPoint, b: SettlementPoint) => legClear(a, b, avoid);
      // Preserve the actual fractional landing: snapping it behind a ship-envelope boundary can
      // reject an otherwise entirely clear water leg before A* takes its first step.
      const cells = clear(from, to) ? [{ ...to }] : findSeaRoute(world, masks!.route, from, to, clear);
      if (cells) {
        const legs = straightenSeaRoute(from, cells, clear);
        const last = legs.at(-1);
        if (last && DMath.hypot(last.x - to.x, last.z - to.z) < 1.5) legs.pop();
        legs.push({ x: to.x, z: to.z });
        // Keep the actual landing as the first point: range and boat position both start there.
        result = [{ x: from.x, z: from.z }, ...legs];
      }
    }
    if (cache.routes.size >= ROUTE_CACHE_LIMIT) cache.routes.delete(cache.routes.keys().next().value!);
    cache.routes.set(key, result);
    return result;
  };
  /** The route is still rowable (terrain may have changed since the job began). */
  const clear = (points: readonly SettlementPoint[], from?: SettlementPoint) => {
    refresh();
    if (!points.length) return false;
    let previous = from ?? points[0]!;
    for (const point of points) {
      if (!legClear(previous, point)) return false;
      previous = point;
    }
    return true;
  };
  const clearCache = () => { caches.delete(world); };
  const canTurn = (point: SettlementPoint) => {
    refresh();
    const cell = routeCell(point);
    return point.x >= 0 && point.z >= 0 && point.x < world.cellsX && point.z < world.cellsZ &&
      masks!.turning[cell] === 1;
  };
  /** The current sea mask both boat masks derive from (refreshed first). */
  const currentSea = () => {
    refresh();
    return sea;
  };
  return { canTurn, clear, clearCache, route, routeLength: (points: readonly SettlementPoint[]) => points.reduce(
    (sum, point, index) => sum + (index ? DMath.hypot(point.x - points[index - 1]!.x, point.z - points[index - 1]!.z) : 0),
    0), sea: currentSea };
};

export type BoatRoutePlanner = ReturnType<typeof createBoatRoutePlanner>;

/** The point `distance` tiles along a map route, facing along it. */
export const pointAlongBoatRoute = (points: readonly SettlementPoint[], distance: number) => {
  let left = Math.max(0, distance);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!;
    const length = DMath.hypot(to.x - from.x, to.z - from.z);
    if (left > length && index < points.length - 1) { left -= length; continue; }
    const share = length ? Math.min(1, left / length) : 0;
    return { x: from.x + (to.x - from.x) * share, yaw: DMath.atan2(to.x - from.x, to.z - from.z),
      z: from.z + (to.z - from.z) * share };
  }
  return { ...(points.at(-1) ?? { x: 0, z: 0 }), yaw: 0 };
};
