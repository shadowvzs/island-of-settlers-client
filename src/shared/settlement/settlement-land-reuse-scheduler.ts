import { DMath } from "../math/deterministic-math";
import { selectCarrierFleet } from "./settlement-carrier-fleet";
import { cartWorthyUnits } from "./settlement-cart-priority";
import { stoneRouteFrom } from "./settlement-handcart-roads";
import { restartDemandWait } from "./settlement-demand-ranking";
import { createLandReusePassMemo, type LandReusePassMemo } from "./settlement-land-reuse-memo";
import {
  availableTransportGood, claimNextDelivery, completeNextTransferDispatch, reconcileNextDelivery, takeNextDelivery
} from "./settlement-land-transport-claims";
import {
  canPromiseUnloadingHandcart, canPromiseWalkingCarrier, canReuseReturningHandcart, canReuseWalkingCarrier
} from "./settlement-land-transport-reuse";
import type { WalkingCarrierPickup } from "./settlement-land-transport-selection";
import { actorEconomyOwnerOf, economyOwnerOf } from "./settlement-ownership";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementNextDelivery, SettlementPoint
} from "./settlement-types";
import {
  chooseNextTransportJob, chooseTransportForJob, type TransportReuseCandidate
} from "./transport-reuse-policy";

export interface LandReuseJob {
  allowClaim?: boolean;
  /** Owner cart priority: serving or fetchable carts cover this cart-worthy job, so walkers skip it. */
  cartOnly?: boolean;
  /** A ranked consumer demand: serving it restarts the consumer's wait (owner 2026-11-09). */
  demandRanked?: boolean;
  destination: SettlementBuilding;
  fallback?: boolean;
  limit: number;
  remainingNeed: number;
  source: SettlementBuilding;
  sourceInput?: boolean;
  transferId?: number;
  upgrade?: boolean;
  ware: string;
}
type Dispatch = (job: LandReuseJob, actor: SettlementActor, pickup?: WalkingCarrierPickup) => number;
type NextRequest = Omit<SettlementNextDelivery, "leaseStartedTick" | "leaseDeadlineTick">;
interface PlannedJob { job: LandReuseJob; pickup?: WalkingCarrierPickup; claim: NextRequest }

const pathLength = (from: SettlementPoint, points: readonly SettlementPoint[]) => {
  let total = 0, previous = from;
  for (const point of points) { total += DMath.hypot(point.x - previous.x, point.z - previous.z); previous = point; }
  return total;
};

/** One demand owner supplies jobs; this service chooses only an uncommitted unit's next leg. */
export const createLandReuseScheduler = (
  context: SettlementContext, collectJobs: (source?: number) => LandReuseJob[], dispatch: Dispatch
) => {
  const createMemo = () => createLandReusePassMemo(context, collectJobs);
  const cartCandidates = (job: LandReuseJob): TransportReuseCandidate<SettlementActor | null>[] => {
    if (job.upgrade || job.sourceInput) return [];
    const cart = selectCarrierFleet(context, job.source, job.destination, job.ware,
      Math.min(job.limit, availableTransportGood(context, job.source, job.ware)), job.allowClaim !== false);
    return cart.fleet === "handcart" && cart.selection ? [{ ...cart.selection, value: cart.carrier ?? null }] : [];
  };
  const bestUnit = (memo: LandReusePassMemo, job: LandReuseJob) => {
    const carts = cartCandidates(job);
    // A cart-only job never goes to a walker, nor to a new walker from an idle storage.
    if (job.cartOnly) return chooseTransportForJob(carts);
    return memo.walkers(job.source, job.allowClaim !== false)
      .choose<SettlementActor | null>(pickup => pickup.actor, [...memo.idleStorages(job.source), ...carts]);
  };

  /**
   * Only walking candidates and a hand-cart crew are units, so a cartless actor the job's walking pool
   * cannot hold cannot be its best unit: skip the full (cart) selection for it.
   */
  const isBestUnit = (memo: LandReusePassMemo, job: LandReuseJob, actor: SettlementActor) => {
    if (!actor.handcart && !memo.walkers(job.source, job.allowClaim !== false).mayHold(actor)) return false;
    return memo.bestUnit(job, () => bestUnit(memo, job)) === actor;
  };

  const choose = (memo: LandReusePassMemo, actor: SettlementActor, atBoundary?: SettlementBuilding) => {
    const cart = actor.handcart;
    const unloading = cart ? canPromiseUnloadingHandcart(actor, cart.trip?.destination ?? -1)
      : canPromiseWalkingCarrier(actor, actor.delivery?.destination ?? -1);
    const sourceUid = atBoundary?.uid ?? (unloading ? cart?.trip?.destination ?? actor.delivery?.destination : undefined);
    const plans: {
      cartWorthy: boolean; remainingNeed: number; routeDistance: number; order: number; value: PlannedJob
    }[] = [];
    const owner = actorEconomyOwnerOf(context, actor);
    for (const [order, job] of memo.jobs(sourceUid).entries()) {
      if ((unloading && !job.allowClaim) || (!cart && job.cartOnly)) continue;
      if (economyOwnerOf(context, job.destination) !== owner) continue;
      if (!atBoundary && !isBestUnit(memo, job, actor)) continue;
      const route = context.options.roads.route(job.source.access, job.destination.access);
      if (!route) continue;
      let capacity = 1, units = 1, approach = 0, pickup: WalkingCarrierPickup | undefined;
      if (cart) {
        if (job.upgrade || job.sourceInput) continue;
        const assignment = selectCarrierFleet(context, job.source, job.destination, job.ware,
          Math.min(job.limit, availableTransportGood(context, job.source, job.ware)), unloading, actor);
        if (assignment.fleet !== "handcart" || assignment.carrier !== actor) continue;
        capacity = assignment.capacity; units = assignment.units;
        if (!unloading && !atBoundary) {
          const path = stoneRouteFrom(context, actor, job.source.access);
          if (!path) continue;
          approach = pathLength(actor, path.points);
        }
      } else if (!atBoundary) {
        pickup = memo.walkers(job.source, unloading).pickup(actor);
        if (!pickup) continue;
        if (!unloading) approach = pathLength(actor, pickup.points);
      }
      const claim: NextRequest = { source: job.source.uid, destination: job.destination.uid,
        ware: job.ware, units, capacity, mode: cart ? "handcart" : "carrier", ...(job.upgrade ? { upgrade: true } : {}),
        ...(job.sourceInput ? { sourceInput: true } : {}),
        ...(job.transferId === undefined ? {} : { transferId: job.transferId }) };
      plans.push({ cartWorthy: Boolean(cart) && units >= cartWorthyUnits(capacity),
        remainingNeed: job.remainingNeed, routeDistance: approach + route.length, order,
        value: { job, pickup, claim } });
    }
    const requested = plans.filter(plan => !plan.value.job.fallback);
    const pool = requested.length ? requested : plans;
    // Owner cart priority: a cart crew takes the largest uncovered cart-worthy job first.
    const worthy = pool.filter(plan => plan.cartWorthy);
    return chooseNextTransportJob(worthy.length ? worthy : pool);
  };

  const served = (job: LandReuseJob) => {
    if (job.demandRanked) restartDemandWait(context, job.destination, job.ware);
  };
  const commit = (actor: SettlementActor, plan: PlannedJob) => {
    const sent = dispatch(plan.job, actor, plan.pickup);
    if (!sent) return false;
    completeNextTransferDispatch(context, { transferId: plan.job.transferId, units: sent });
    served(plan.job);
    return true;
  };

  const atBoundary = (actor: SettlementActor, source: SettlementBuilding) => {
    if (context.buildings.some(building => building.worker === actor.uid)) return false;
    const next = takeNextDelivery(context, actor, source.uid);
    const memo = createMemo();
    if (next) {
      // The paid/current cargo is already delivered. Re-read the real next purpose after releasing
      // this intent's incoming once: changed recipes, cancelled upgrades and removed orders are gone.
      const job = memo.jobs(source.uid).find(candidate => candidate.destination.uid === next.destination &&
        candidate.ware === next.ware && candidate.transferId === next.transferId &&
        Boolean(candidate.upgrade) === Boolean(next.upgrade) &&
        Boolean(candidate.sourceInput) === Boolean(next.sourceInput));
      if (job) {
        if (commit(actor, { claim: next, job: { ...job, limit: Math.min(next.units, job.limit) } })) return true;
        memo.invalidate();
      }
    }
    const plan = choose(memo, actor, source);
    return plan ? commit(actor, plan) : false;
  };

  const schedule = () => {
    const unloadingAt = (actor: SettlementActor) => actor.handcart
      ? canPromiseUnloadingHandcart(actor, actor.handcart.trip?.destination ?? -1)
      : canPromiseWalkingCarrier(actor, actor.delivery?.destination ?? -1);
    const actors = [...context.actors].sort((a, b) => Number(unloadingAt(b)) - Number(unloadingAt(a)) || a.uid - b.uid);
    const memo = createMemo();
    for (const actor of actors) {
      if (memo.crew().workers.has(actor.uid)) continue;
      const held = actor.nextDelivery;
      reconcileNextDelivery(context, actor);
      if (actor.nextDelivery) continue;
      // A released next-job returned its destination's incoming: every cached answer is stale.
      if (held) memo.invalidate();
      const unloading = actor.handcart
        ? canPromiseUnloadingHandcart(actor, actor.handcart.trip?.destination ?? -1)
        : canPromiseWalkingCarrier(actor, actor.delivery?.destination ?? -1);
      if (!unloading && !canReuseWalkingCarrier(actor) && !canReuseReturningHandcart(actor)) continue;
      const plan = choose(memo, actor);
      if (!plan) continue;
      if (!unloading) commit(actor, plan);
      else if (claimNextDelivery(context, actor, plan.claim)) served(plan.job);
      // Claims and dispatch attempts write reservations, actors and stock even when they fail late.
      memo.invalidate();
    }
  };
  return { atBoundary, schedule };
};
