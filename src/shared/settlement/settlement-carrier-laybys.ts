import { HANDCART } from "../../render-common/logistics/handcart-rules";
import { DMath } from "../math/deterministic-math";
import { BLOCKING } from "../world/world-data";
import { ROAD_TIER_WIDTH, type RoadSegment, type RoadTier } from "./road-types";
import {
  type CarrierClaimProgress,
  carrierClaimProgressed,
  claimLeaseExpired,
  refreshClaimLease,
  startClaimLease
} from "./settlement-carrier-claims";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementHandcart,
  SettlementHandcartBays,
  SettlementLayByClaim,
  SettlementPoint
} from "./settlement-types";

/** A cart plus its kerb clearance; the cart body must stay outside a building/lane. */
const CART_BODY_HALF_WIDTH = HANDCART.width / 2 + HANDCART.clearance;
/** A shared bay must stay within a short planned walk of the flag it serves. */
export const MAX_SHARED_LAY_BY_WALK = 6;

export interface SharedLayBy extends SettlementPoint {
  roadTier: RoadSegment["tier"];
  /** Short walk from the flag/signpost to the bay; the carrier route includes it as service time. */
  walk: number;
}

export const insideBuildingEnvelope = (building: SettlementBuilding, point: SettlementPoint) =>
  Math.abs(point.x - building.x) <= building.width / 2 + CART_BODY_HALF_WIDTH &&
  Math.abs(point.z - building.z) <= building.depth / 2 + CART_BODY_HALF_WIDTH;

const segmentDistance = (point: SettlementPoint, segment: RoadSegment) => {
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const squared = dx * dx + dz * dz;
  if (squared < 1e-9) {
    return DMath.hypot(point.x - segment.start.x, point.z - segment.start.z);
  }
  const t = Math.max(0, Math.min(1,
    ((point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz) / squared));
  return DMath.hypot(point.x - segment.start.x - dx * t, point.z - segment.start.z - dz * t);
};

interface SavedRoadLike {
  start: SettlementPoint;
  end: SettlementPoint;
  tier?: RoadTier;
  doorway?: boolean;
  preview?: boolean;
}
const roadSegments = (context: SettlementContext): RoadSegment[] =>
  ((context.options.roads.segments?.() ?? []) as SavedRoadLike[])
    .filter(segment => !segment.preview && !segment.doorway)
    .map(segment => ({ start: segment.start, end: segment.end, tier: segment.tier ?? "dirt" }));

/** The cart centre must sit clear of every lane, not just the flag's own approach. */
export const layByClearOfRoads = (
  point: SettlementPoint, segments: readonly RoadSegment[]
) => segments.every(segment =>
  segmentDistance(point, segment) >= ROAD_TIER_WIDTH[segment.tier] / 2 + CART_BODY_HALF_WIDTH - 1e-9);

const layByClearOfBuildings = (
  context: SettlementContext, point: SettlementPoint
) => context.buildings.every(building => !insideBuildingEnvelope(building, point));

const layByOnLand = (context: SettlementContext, point: SettlementPoint) => {
  const world = context.options.world;
  // Bare test contexts may omit terrain; the geometry checks below still apply.
  if (!world || !Number.isFinite(world.cellsX) || !Number.isFinite(world.cellsZ)) return true;
  const x = Math.floor(point.x), z = Math.floor(point.z);
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
  const cell = z * world.cellsX + x;
  const blocking = world.blocking?.[cell];
  return blocking !== BLOCKING.water && blocking !== BLOCKING.cliff;
};

/** A point is a valid shared lay-by when it is off every lane, outside every plot and on land. */
export const isValidSharedLayBy = (
  context: SettlementContext, point: SettlementPoint, segments = roadSegments(context)
) =>
  layByOnLand(context, point) && layByClearOfRoads(point, segments) &&
  layByClearOfBuildings(context, point);

const nearestSegment = (segments: readonly RoadSegment[], point: SettlementPoint) => {
  let best: { distance: number; segment: RoadSegment } | undefined;
  for (const segment of segments) {
    const distance = segmentDistance(point, segment);
    if (!best || distance < best.distance ||
      (distance === best.distance && (segment.start.x < best.segment.start.x ||
        (segment.start.x === best.segment.start.x && segment.start.z < best.segment.start.z))))
      best = { distance, segment };
  }
  return best;
};

const candidatePoints = (segments: readonly RoadSegment[], building: SettlementBuilding) => {
  const nearest = nearestSegment(segments, building.access);
  if (!nearest) return [];
  const { segment } = nearest;
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const length = DMath.hypot(dx, dz);
  if (length < 1e-9) return [];
  const tx = dx / length, tz = dz / length, nx = tz, nz = -tx;
  const lane = ROAD_TIER_WIDTH[segment.tier] / 2 + CART_BODY_HALF_WIDTH;
  const points: Array<SettlementPoint & { roadTier: RoadSegment["tier"] }> = [];
  // Nearest first: the flag's own road endpoint, then progressively farther shared shoulders.
  const alongOffsets = [0, .5, -.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5, 4, -4];
  const sideOffsets = [lane, lane + .06, lane + .24, lane + .48, lane + .84, lane + 1.32];
  for (const side of [1, -1])
    for (const along of alongOffsets)
      for (const offset of sideOffsets) {
        const point = {
          x: building.access.x + tx * along + nx * side * offset,
          z: building.access.z + tz * along + nz * side * offset,
          roadTier: segment.tier
        };
        if (DMath.hypot(point.x - building.access.x, point.z - building.access.z) > MAX_SHARED_LAY_BY_WALK)
          continue;
        points.push(point);
      }
  return points;
};

interface LayByCacheEntry {
  bay: SharedLayBy | null;
  depth: number;
  width: number;
  x: number;
  z: number;
}
interface LayByCache {
  key: string;
  values: Map<number, LayByCacheEntry>;
}
const layByCaches = new WeakMap<SettlementContext, LayByCache>();

const cacheKey = (context: SettlementContext) =>
  `${context.options.roads.revision ?? "static"}/${context.options.world.buildRevision ?? 0}/${context.buildings.length}`;

/**
 * Static deterministic shared/stone-route bay selection. The old 0.8 inward offset was inside
 * 36/39 fixture plots; this searches the actual plot envelope and every lane instead. No bay means
 * the caller must use a cartless capacity-1 carrier; it never parks in the lane.
 */
export const findSharedLayBy = (
  context: SettlementContext, building: SettlementBuilding
): SharedLayBy | undefined => {
  const revision = context.options.roads.revision;
  if (revision === undefined) return findSharedLayByUncached(context, building);
  const key = cacheKey(context);
  let cache = layByCaches.get(context);
  if (!cache || cache.key !== key) {
    cache = { key, values: new Map() };
    layByCaches.set(context, cache);
  }
  const cached = cache.values.get(building.uid);
  if (cached && cached.x === building.x && cached.z === building.z &&
    cached.width === building.width && cached.depth === building.depth)
    return cached.bay ?? undefined;
  const found = findSharedLayByUncached(context, building);
  cache.values.set(building.uid, { bay: found ?? null, depth: building.depth,
    width: building.width, x: building.x, z: building.z });
  return found;
};

const findSharedLayByUncached = (
  context: SettlementContext, building: SettlementBuilding
): SharedLayBy | undefined => {
  const segments = roadSegments(context);
  if (!segments.length || !building.access) return undefined;
  for (const candidate of candidatePoints(segments, building)) {
    if (!layByOnLand(context, candidate) || !layByClearOfRoads(candidate, segments) ||
      !layByClearOfBuildings(context, candidate)) continue;
    return {
      x: candidate.x,
      z: candidate.z,
      roadTier: candidate.roadTier,
      walk: DMath.hypot(candidate.x - building.access.x, candidate.z - building.access.z)
    };
  }
  return undefined;
};

/** A cart bay must open onto an upgraded leg; a dirt shoulder never enables a cart. */
const findCartLayBy = (context: SettlementContext, building: SettlementBuilding) => {
  const bay = findSharedLayBy(context, building);
  return bay && bay.roadTier !== "dirt" ? bay : undefined;
};

/**
 * Physical bay identity. The static id is the served flag, but two flag searches may resolve to the
 * same shoulder; the point at 1 mm precision is the shared identity that prevents double-booking.
 */
const layByPointKey = (point: SettlementPoint) =>
  `${point.x.toFixed(3)}:${point.z.toFixed(3)}`;

export const layByClaimKey = (claim: SettlementLayByClaim) =>
  layByPointKey(claim);

export type LayByRole = "source" | "destination";

export interface LayByOccupant {
  actor: number;
  claim: SettlementLayByClaim;
  role: LayByRole;
}

const cartClaims = (cart: SettlementHandcart | undefined) => {
  const bays = cart?.bays;
  if (!bays) return [];
  const claims: Array<{ claim: SettlementLayByClaim; role: LayByRole }> = [];
  if (bays.source) claims.push({ claim: bays.source, role: "source" });
  if (bays.destination) claims.push({ claim: bays.destination, role: "destination" });
  return claims;
};

/** Active claims only: an expired lease never blocks a new booking. */
export const findLayByOccupant = (
  context: SettlementContext,
  building: SettlementBuilding,
  bay: SettlementPoint,
  exceptActor?: number
): LayByOccupant | undefined => {
  const key = layByPointKey(bay);
  for (const actor of context.actors ?? []) {
    if (actor.uid === exceptActor) continue;
    for (const { claim, role } of cartClaims(actor.handcart)) {
      if (claimLeaseExpired(context, claim)) continue;
      // Same static id also occupies the slot while an old geometry is still saved; expiry ends it.
      if (claim.bay === building.uid || layByClaimKey(claim) === key)
        return { actor: actor.uid, claim, role };
    }
  }
  return undefined;
};

/** The two distinct cart bays of a trip, whether or not another cart occupies them now. */
export const cartLayBys = (
  context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding
): { source: SharedLayBy; destination: SharedLayBy } | undefined => {
  const sourceBay = findCartLayBy(context, source);
  const destinationBay = findCartLayBy(context, destination);
  if (!sourceBay || !destinationBay) return undefined;
  // One physical shoulder cannot host both ends of the same trip.
  if (layByPointKey(sourceBay) === layByPointKey(destinationBay)) return undefined;
  return { source: sourceBay, destination: destinationBay };
};

/** Both bays and their physical identities must be free before a cart plan may be chosen. */
export const cartLayByBooking = (
  context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding, exceptActor?: number
): { source: SharedLayBy; destination: SharedLayBy } | undefined => {
  const bays = cartLayBys(context, source, destination);
  if (!bays) return undefined;
  const { destination: destinationBay, source: sourceBay } = bays;
  if (findLayByOccupant(context, source, sourceBay, exceptActor) ||
    findLayByOccupant(context, destination, destinationBay, exceptActor)) return undefined;
  return bays;
};

/** Claims both ends in one synchronous decision; returns undefined rather than double-booking. */
export const claimCartLayBys = (
  context: SettlementContext,
  actor: number,
  source: SettlementBuilding,
  destination: SettlementBuilding
): SettlementHandcartBays | undefined => {
  const booking = cartLayByBooking(context, source, destination, actor);
  if (!booking) return undefined;
  // One lease for both bays; a cart can hold the source and destination reservations at once.
  const lease = startClaimLease(context);
  return {
    source: { bay: source.uid, x: booking.source.x, z: booking.source.z,
      walk: booking.source.walk, actor, ...lease },
    destination: { bay: destination.uid, x: booking.destination.x, z: booking.destination.z,
      walk: booking.destination.walk, actor, ...lease }
  };
};

const dropEmptyBays = (cart: SettlementHandcart) => {
  if (cart.bays && !cart.bays.source && !cart.bays.destination) cart.bays = undefined;
};

/** Release one end (departed the bay) or both (trip ended). */
export const releaseLayByClaims = (cart: SettlementHandcart, role?: LayByRole) => {
  if (!cart.bays) return;
  if (role) delete cart.bays[role];
  else {
    delete cart.bays.source;
    delete cart.bays.destination;
  }
  dropEmptyBays(cart);
};

/** A demolished/removed flag can never be served again; drop its saved reservation. */
export const releaseLayByClaimsForBuilding = (cart: SettlementHandcart, building: number) => {
  if (cart.bays?.source?.bay === building) delete cart.bays.source;
  if (cart.bays?.destination?.bay === building) delete cart.bays.destination;
  dropEmptyBays(cart);
};

/** Expire only stale ownership; the cart and its cargo stay exactly where they are. */
export const expireLayByClaims = (context: SettlementContext, cart: SettlementHandcart) => {
  if (!cart.bays) return false;
  let expired = false;
  for (const { claim, role } of cartClaims(cart)) {
    if (!claimLeaseExpired(context, claim)) continue;
    delete cart.bays[role];
    expired = true;
  }
  dropEmptyBays(cart);
  return expired;
};

export const expireAllLayByClaims = (context: SettlementContext) => {
  for (const actor of context.actors ?? [])
    if (actor.handcart) expireLayByClaims(context, actor.handcart);
};

/** A claim lease advances only after real movement/handling, exactly like a destination claim. */
export const refreshLayByClaimsOnProgress = (
  context: SettlementContext,
  actor: SettlementActor,
  before: CarrierClaimProgress | undefined
) => {
  if (!actor.handcart?.bays || !carrierClaimProgressed(before, actor)) return;
  for (const { claim } of cartClaims(actor.handcart)) refreshClaimLease(context, claim);
};
