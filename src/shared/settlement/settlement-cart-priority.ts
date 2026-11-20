import { cartCapacityFor } from "../../render-common/logistics/handcart-rules";
import { HANDCART_LOGISTICS } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import { STORAGE_IDS } from "./production-rules";
import { cartDepotApproach } from "./settlement-carrier-fleet";
import { sendCarrierHomeTo } from "./settlement-carrier-home";
import { cartLayBys } from "./settlement-carrier-laybys";
import { isDoorExitQueueFull } from "./settlement-door-exit-queue";
import { canCrewCart } from "./settlement-handcart-crew";
import { isCompletedStorage } from "./settlement-handcart-ledger";
import { canReuseWalkingCarrier } from "./settlement-land-transport-reuse";
import { economyOwnerOf, servesBuildingEconomy } from "./settlement-ownership";
import { availableIdleSettlers } from "./settlement-population";
import { talentsOf } from "./settlement-talents";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { isSettlerRelocating, startSettlerRelocation } from "./settler-relocation";
import { storageDispatchLimit } from "./storage-capacity";

/**
 * Owner cart priority (2026-11-08). Carts take the big jobs, walkers keep the small ones:
 * - A job is cart-worthy when one departure could carry at least `cartWorthyUnits` items.
 * - A cart "serves" a cart-worthy job when it can reach the job's source over stone and it has a
 *   crew or a crew on the way: an idle crew in its storage (also while the source bay is busy, i.e.
 *   the cart waits for the bay), a carrier walking home to that storage, a settler relocating there,
 *   or a hitched cart already out (on a trip, unloading or returning) and not promised to another job.
 * - While carts serve the job, walkers take only the small uncovered tail: the need minus one full
 *   load per serving cart, when that is above zero and below the cart-worthy threshold.
 * - With no serving cart but a crewless one, the job waits for a fetch: the nearest free carrier
 *   (a walking return or an idle settler of another storage) goes to the cart's storage, when that
 *   detour stays within `fetchDetourFactor` of its own walking trip. Otherwise walkers go as before.
 * Everything is derived from the saved state (phases, homes, targets), so it is replay and save safe.
 */
const WALKING_LOAD = 1;

/** More than one walking load, and at least the configured share of a full cart load. */
export const cartWorthyUnits = (capacity: number) =>
  Math.max(WALKING_LOAD + 1, Math.ceil(capacity * HANDCART_LOGISTICS.cartWorthyLoadShare));

export interface CartWalkerHold {
  /** Walkers must not take this job now: serving carts cover it, or a fetch is possible. */
  blocked: boolean;
  /** The nearest crewless cart storage, when no cart serves the job yet. */
  fetchDepot?: SettlementBuilding;
}

const OPEN: CartWalkerHold = Object.freeze({ blocked: false });
const HOME_PHASES = new Set(["enterHome", "home", "returnBlockedCarrier"]);

/** Storages a free carrier or a relocating settler is heading into (its future cart crew). */
const crewHeadingHome = (context: SettlementContext) => {
  const storages = new Set<number>();
  for (const actor of context.actors) {
    if (isSettlerRelocating(actor)) storages.add(actor.building);
    else if (actor.job === "Carrier" && HOME_PHASES.has(actor.phase) && !actor.delivery && !actor.handcart &&
      !actor.ware && !actor.nextDelivery) storages.add(actor.home);
  }
  return storages;
};

/** Units one cart departure could take, or 0 when no cart can ever serve this trip. */
const cartLoadFor = (
  context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding, ware: string, need: number
) => {
  const stoneRoute = context.options.roads.stoneRoute;
  if (!HANDCART_LOGISTICS.enabled || !stoneRoute) return { capacity: 0, units: 0 };
  const capacity = cartCapacityFor(ware, talentsOf(context, economyOwnerOf(context, source)).handcartCapacity);
  const units = storageDispatchLimit(context, source, destination, ware, Math.min(capacity, need));
  if (units < cartWorthyUnits(capacity) || !cartLayBys(context, source, destination) ||
    !stoneRoute(source.access, destination.access)) return { capacity, units: 0 };
  return { capacity, units };
};

interface CartCoverage { fetchDepot?: SettlementBuilding; serving: number }

/** One actor/building scan shared by every trip of a pass. */
interface CartFleet {
  /** Owning storage of each crewed cart that is out and not promised elsewhere (one entry per cart). */
  activeOwners: SettlementBuilding[];
  /** Finished storages holding at least one cart. */
  depots: SettlementBuilding[];
  heading?: Set<number>;
}

/** A pass's cart coverage: valid while nothing writes; a writing pass clears it after a fetch. */
export interface CartCoverageCache { fleet?: CartFleet; trips: Map<number, CartCoverage> }
export const createCartCoverageCache = (): CartCoverageCache => ({ trips: new Map() });
export const clearCartCoverage = (cache: CartCoverageCache) => {
  cache.fleet = undefined;
  cache.trips.clear();
};

/**
 * Carts already out with a crew (on a trip, unloading or returning) and not promised elsewhere come
 * free for their next job, so each counts when its owning storage could serve a trip.
 */
const scanFleet = (context: SettlementContext): CartFleet => {
  const depots: SettlementBuilding[] = [];
  const storages = new Map<number, SettlementBuilding>();
  for (const building of context.buildings) {
    if (!isCompletedStorage(building)) continue;
    storages.set(building.uid, building);
    if (building.handcarts ?? 0) depots.push(building);
  }
  const activeOwners: SettlementBuilding[] = [];
  for (const actor of context.actors) {
    if (!actor.handcart || actor.nextDelivery || actor.handcart.state !== "hitched") continue;
    const owner = storages.get(actor.handcart.owner);
    if (owner) activeOwners.push(owner);
  }
  return { activeOwners, depots };
};

/** Cheapest test first; the actor scan for crews on the way runs only when a depot needs it. */
const hasCrew = (context: SettlementContext, depot: SettlementBuilding, fleet: CartFleet) => {
  if (availableIdleSettlers(context, depot) > 0 || canCrewCart(context, depot)) return true;
  fleet.heading ??= crewHeadingHome(context);
  return fleet.heading.has(depot.uid);
};

/** Carts serving the trip, and the nearest crewless cart storage to fetch from. */
const cartCoverage = (
  context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding, fleet: CartFleet
): CartCoverage => {
  let serving = 0;
  for (const owner of fleet.activeOwners)
    if (cartDepotApproach(context, owner, source, destination) !== undefined) serving++;
  let fetch: { depot: SettlementBuilding; length: number } | undefined;
  for (const depot of fleet.depots) {
    const length = cartDepotApproach(context, depot, source, destination);
    if (length === undefined) continue;
    if (hasCrew(context, depot, fleet)) serving++;
    else if (!fetch || length < fetch.length) fetch = { depot, length };
  }
  return { fetchDepot: fetch?.depot, serving };
};

const cachedCoverage = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  cache?: CartCoverageCache
) => {
  if (!cache) return cartCoverage(context, source, destination, scanFleet(context));
  const key = source.uid * 0x100000 + destination.uid;
  const cached = cache.trips.get(key);
  if (cached) return cached;
  cache.fleet ??= scanFleet(context);
  const coverage = cartCoverage(context, source, destination, cache.fleet);
  cache.trips.set(key, coverage);
  return coverage;
};

/** Whether walkers may take one more unit of a job that still needs `need` units. */
export const cartWalkerHold = (
  context: SettlementContext,
  source: SettlementBuilding,
  destination: SettlementBuilding,
  ware: string,
  need: number,
  cache?: CartCoverageCache
): CartWalkerHold => {
  const { capacity, units } = cartLoadFor(context, source, destination, ware, need);
  if (!units) return OPEN;
  const { fetchDepot, serving } = cachedCoverage(context, source, destination, cache);
  if (!serving) return fetchDepot ? { blocked: true, fetchDepot } : OPEN;
  const uncovered = need - serving * capacity;
  return { blocked: !(uncovered > 0 && uncovered < cartWorthyUnits(capacity)) };
};

const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(from.x - to.x, from.z - to.z);

interface FetchCandidate { cost: number; actor?: SettlementActor; storage?: SettlementBuilding; uid: number }

/**
 * Straight-line approaches (cheap and deterministic) plus the real road leg: fetching costs the walk
 * to the cart, the cart's approach and the leg at cart speed; walking costs the approach and the leg.
 */
const fetchCost = (
  from: SettlementPoint, depot: SettlementBuilding, source: SettlementBuilding, leg: number
) => {
  const fetching = distance(from, depot.access) + distance(depot.access, source.access) +
    leg / HANDCART_LOGISTICS.speedFactor;
  const walking = distance(from, source.access) + leg;
  return fetching <= walking * HANDCART_LOGISTICS.fetchDetourFactor ? fetching : undefined;
};

const better = (best: FetchCandidate | undefined, candidate: FetchCandidate) =>
  !best || candidate.cost < best.cost || (candidate.cost === best.cost && candidate.uid < best.uid);

const nearestFetcher = (
  context: SettlementContext, depot: SettlementBuilding, source: SettlementBuilding, leg: number
) => {
  let best: FetchCandidate | undefined;
  for (const storage of context.buildings) {
    if (storage === depot || storage.construction !== 1 || !STORAGE_IDS.has(storage.typeId) ||
      !servesBuildingEconomy(context, storage, depot) || availableIdleSettlers(context, storage) < 1 ||
      isDoorExitQueueFull(context, storage)) continue;
    const cost = fetchCost(storage.access, depot, source, leg);
    const candidate = { cost: cost ?? Infinity, storage, uid: storage.uid };
    if (cost !== undefined && better(best, candidate)) best = candidate;
  }
  let workers: Set<number> | undefined;
  for (const actor of context.actors) {
    if (actor.nextDelivery || actor.home === depot.uid || !canReuseWalkingCarrier(actor)) continue;
    const cost = fetchCost(actor, depot, source, leg);
    if (cost === undefined || !better(best, { cost, uid: actor.uid })) continue;
    workers ??= new Set(context.buildings.map(building => building.worker ?? -1));
    if (!workers.has(actor.uid)) best = { actor, cost, uid: actor.uid };
  }
  return best;
};

/** Sends the nearest worthwhile free carrier to crew the cart at `depot`; true when one left. */
export const fetchCrewlessCart = (
  context: SettlementContext, depot: SettlementBuilding, source: SettlementBuilding, leg: number
) => {
  const fetcher = nearestFetcher(context, depot, source, leg);
  if (fetcher?.actor) return sendCarrierHomeTo(context, fetcher.actor, depot);
  if (!fetcher?.storage) return false;
  const route = context.options.roads.route(fetcher.storage.access, depot.access);
  if (!route) return false;
  startSettlerRelocation(context, fetcher.storage, depot, route.points);
  return true;
};
