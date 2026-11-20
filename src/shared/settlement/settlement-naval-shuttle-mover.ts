import { DMath } from "../math/deterministic-math";
import {
type BoatJetty,   boatPointClearOfBerths, boatPointNearShipLane, boatRouteClearOfShips, type ShipChannel
} from "./harbour-boat-jetty";
import { type BoatRoutePlanner,pointAlongBoatRoute } from "./harbour-boat-route";
import {
  SHUTTLE_FULL_RETURN_SECONDS, SHUTTLE_ROUTE_CHECK_SECONDS, SHUTTLE_ROW_SPEED, type ShuttleInterruption,
  type ShuttleJob
} from "./harbour-shuttle-plan";
import { addGood } from "./production-rules";
import type { NavalShip } from "./settlement-naval-fleet";
import { addIdleSettlers, countOnDuty } from "./settlement-population";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

const SHIP_YIELD_REACH = 24;
const YIELD_LOOKAHEAD = 2.5;
const routeLength = (route: readonly SettlementPoint[]) => route.reduce((sum, point, index) =>
  sum + (index ? DMath.hypot(point.x - route[index - 1]!.x, point.z - route[index - 1]!.z) : 0), 0);
const reverseRoute = (route: readonly SettlementPoint[]) => [...route].reverse();
const addLoad = (goods: Goods, load: Readonly<Goods>) => {
  for (const [ware, count] of Object.entries(load)) addGood(goods, ware, count);
};
const empty = (goods: Readonly<Goods>) => Object.values(goods).every(count => count <= 0);
const safe = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

export interface ShuttleMoverOptions {
  accepting: (uid: number, cargo: Goods) => boolean;
  canReceive: (destination: SettlementBuilding, cargo: Readonly<Goods>) => boolean;
  canUnload: (destination: SettlementBuilding, cargo: Readonly<Goods>) => boolean;
  channelsNow: () => readonly ShipChannel[];
  context: SettlementContext;
  harbor: (uid: number) => SettlementBuilding | undefined;
  jetty: (building: SettlementBuilding) => BoatJetty | null;
  jobs: ShuttleJob[];
  planner: BoatRoutePlanner;
  ships: readonly NavalShip[];
  reuse?: (job: ShuttleJob, source: SettlementBuilding) => boolean;
}

/**
 * Physical phase engine of the nearby harbour boat (BOAT-P03/P04): loading, the real water leg,
 * unloading, return and every interrupted state. It owns no inventory except the job's exclusive
 * cargo; every hand-off is the shared stock/capacity rule used by the rest of the harbour system.
 */
export const createShuttleMover = ({
  accepting, canReceive, canUnload, channelsNow, context, harbor, jetty, jobs, planner, reuse, ships
}: ShuttleMoverOptions) => {
  const pointAt = (job: ShuttleJob, phase: "outbound" | "returning", timer: number) => {
    const returning = phase === "returning", route = returning ? reverseRoute(job.route) : job.route;
    const total = returning ? job.plan.returning : job.plan.outbound;
    const share = total ? Math.max(0, Math.min(1, 1 - timer / total)) : 1;
    return pointAlongBoatRoute(route, share * total * SHUTTLE_ROW_SPEED);
  };
  /** Ships keep priority: wait before the channel, never stop while already inside it. */
  const shouldYield = (job: ShuttleJob, phase: "outbound" | "returning") => {
    const channels = channelsNow(), point = pointAt(job, phase, job.timer);
    const ahead = pointAt(job, phase, Math.max(0, job.timer - YIELD_LOOKAHEAD / SHUTTLE_ROW_SPEED));
    if (boatPointNearShipLane(point, channels) || !boatPointNearShipLane(ahead, channels)) return false;
    return ships.some(ship => (ship.phase === "positioning" || ship.phase === "sailing") &&
      DMath.hypot(ship.x - ahead.x, ship.z - ahead.z) < SHIP_YIELD_REACH);
  };
  const blockRoute = (job: ShuttleJob, phase: "outbound" | "returning") => {
    const point = pointAt(job, phase, job.timer);
    job.resume = { phase, share: job.plan ? Math.max(0, Math.min(1, 1 - job.timer /
      (phase === "outbound" ? job.plan.outbound : job.plan.returning))) : 0, timer: job.timer };
    job.hold = { x: point.x, z: point.z };
    job.phase = "blocked"; job.timer = 1; job.interrupted = "route-blocked"; job.blockedFor = 0;
  };
  const avoidBerths = (point: SettlementPoint) => !boatPointClearOfBerths(point, channelsNow());
  const beginReturn = (job: ShuttleJob, from: SettlementPoint, interruption: ShuttleInterruption) => {
    if (!harbor(job.sourceUid)) return false;
    const route = planner.route(job.sourceLanding, from, avoidBerths);
    if (!route || !planner.clear(route) || !boatRouteClearOfShips(route, channelsNow())) {
      job.hold = { ...from }; job.phase = "blocked"; job.timer = 1;
      job.interrupted = interruption; job.resume = undefined; return false;
    }
    job.route = route; job.plan.returning = routeLength(route) / SHUTTLE_ROW_SPEED;
    job.timer = job.plan.returning; job.phase = "returning";
    job.interrupted = interruption; job.resume = undefined; job.hold = undefined; job.blockedFor = 0;
    return true;
  };
  /** The destination reservation is released when the cargo is unloaded or comes back. */
  const releaseIncoming = (job: ShuttleJob) => {
    const destination = harbor(job.destinationUid);
    if (!destination) return;
    for (const [ware, count] of Object.entries(job.cargo)) addGood(destination.incoming, ware, -count);
  };
  const release = (job: ShuttleJob, recovery?: SettlementBuilding) => {
    const source = job.homeLost ? undefined : harbor(job.homeUid ?? job.sourceUid);
    const destination = recovery ?? harbor(job.destinationUid);
    const pool = source ?? destination;
    if (!pool) return false;
    addIdleSettlers(context, pool, job.crew); countOnDuty(context, -job.crew);
    if (!source) pool.inventory.boat = (pool.inventory.boat ?? 0) + 1;
    return true;
  };
  /** A returned explicit transfer reopens its one shared fulfillment claim exactly once. */
  const restoreDemand = (job: ShuttleJob, count: number) => {
    const demand = job.demand;
    if (!demand || demand.automatic || demand.restored || count < 1 ||
      !context.buildings.some(building => building.uid === demand.destination)) return;
    const existing = context.transfers.find(order => order.source === job.sourceUid &&
      order.destination === demand.destination && order.ware === demand.ware);
    if (existing) existing.count += count;
    else context.transfers.push({ count, destination: demand.destination, source: job.sourceUid, ware: demand.ware });
    demand.restored = true;
  };
  const refund = (job: ShuttleJob, harbour: SettlementBuilding) => {
    if (empty(job.cargo)) return true;
    if (!Object.keys(job.cargo).every(ware => harbour.accepts[ware] !== false) || !canReceive(harbour, job.cargo))
      return false;
    const count = Object.values(job.cargo).reduce((sum, units) => sum + units, 0);
    releaseIncoming(job);
    addLoad(harbour.inventory, job.cargo); job.cargo = {};
    restoreDemand(job, count);
    return true;
  };
  /** End a chain only after rowing the original crew and its boat back to their real home. */
  const returnHome = (job: ShuttleJob, atUid: number, from: SettlementPoint) => {
    const homeUid = job.homeUid ?? job.sourceUid;
    const home = job.homeLost ? undefined : harbor(homeUid);
    const recovery = home ? undefined : harbor(atUid) ?? harbor(job.destinationUid) ?? harbor(job.sourceUid);
    const target = home ?? recovery, site = target && jetty(target);
    if (site && DMath.hypot(site.landing.x - from.x, site.landing.z - from.z) < .01) {
      if (release(job, recovery)) { job.done = true; return true; }
    }
    const route = site && planner.route(site.landing, from, avoidBerths);
    job.returningHome = true;
    job.hold = { ...from };
    if (!site || !route || !planner.clear(route) || !boatRouteClearOfShips(route, channelsNow())) {
      job.phase = "blocked"; job.timer = 1; job.interrupted = "source-lost";
      return false;
    }
    Object.assign(job, { demand: undefined, hold: undefined, interrupted: undefined, phase: "returning",
      resume: undefined, route, sourceLanding: site.landing, sourceLost: undefined,
      sourceRoute: site.route, sourceUid: target!.uid, timer: routeLength(route) / SHUTTLE_ROW_SPEED });
    job.plan.returning = job.timer;
    return true;
  };
  const finishReturn = (job: ShuttleJob) => {
    const source = harbor(job.sourceUid);
    if (!empty(job.cargo)) {
      if (!source || !refund(job, source)) {
        job.phase = "blocked"; job.timer = 1; job.interrupted = source ? "source-full" : "source-lost";
        job.hold = { ...job.sourceLanding }; job.resume = undefined; return false;
      }
    }
    if ((job.homeUid ?? job.sourceUid) !== job.sourceUid)
      return returnHome(job, job.sourceUid, job.sourceLanding);
    if (!release(job)) {
      job.phase = "blocked"; job.timer = 1;
      job.interrupted = "source-lost"; job.hold = { ...job.sourceLanding }; job.resume = undefined; return false;
    }
    job.done = true; return true;
  };
  const finishUnload = (job: ShuttleJob) => {
    const destination = harbor(job.destinationUid);
    if (!destination || !accepting(destination.uid, job.cargo) || !canUnload(destination, job.cargo)) {
      job.hold = { ...job.destinationLanding }; job.phase = "blocked"; job.timer = 1;
      job.interrupted = destination ? "destination-full" : "destination-lost"; job.blockedFor = 0; return;
    }
    releaseIncoming(job);
    addLoad(destination.inventory, job.cargo); job.cargo = {};
    if (reuse?.(job, destination)) return;
    if (job.homeUid !== undefined && job.homeUid !== job.sourceUid) {
      returnHome(job, destination.uid, job.destinationLanding); return;
    }
    if (!harbor(job.sourceUid)) { finishReturn(job); return; }
    job.phase = "returning"; job.timer = job.plan.returning; job.interrupted = undefined;
  };
  /** A source lost mid-job: deliver the recovering cargo to the original destination instead of losing it. */
  const deliverToDestination = (job: ShuttleJob) => {
    const destination = harbor(job.destinationUid), target = destination && jetty(destination);
    if (!destination || !target || !accepting(destination.uid, job.cargo) ||
      !canUnload(destination, job.cargo)) return false;
    const from = job.hold ?? job.sourceLanding;
    const route = planner.route(from, target.landing, avoidBerths);
    if (!route || !planner.clear(route) || !boatRouteClearOfShips(route, channelsNow())) return false;
    job.destinationLanding = target.landing; job.destinationRoute = target.route; job.route = route;
    job.plan.outbound = routeLength(route) / SHUTTLE_ROW_SPEED;
    job.plan.returning = job.plan.outbound; job.phase = "outbound"; job.timer = job.plan.outbound;
    job.interrupted = undefined; job.hold = undefined; job.resume = undefined; job.blockedFor = 0; return true;
  };
  const blocked = (job: ShuttleJob, dt: number) => {
    job.blockedFor = safe(job.blockedFor ?? 0) + dt;
    job.timer = Math.max(0, job.timer - dt);
    if (job.returningHome && !job.resume) {
      const point = job.hold ?? job.destinationLanding;
      const atUid = DMath.hypot(point.x - job.sourceLanding.x, point.z - job.sourceLanding.z) < .01
        ? job.sourceUid : job.destinationUid;
      returnHome(job, atUid, point); return;
    }
    if (job.resume) {
      if (planner.clear(job.route) && boatRouteClearOfShips(job.route, channelsNow())) {
        job.phase = job.resume.phase; job.timer = job.resume.timer; job.resume = undefined; job.hold = undefined;
        job.blockedFor = 0; job.interrupted = undefined;
      }
      return;
    }
    if (job.interrupted === "destination-full") {
      const destination = harbor(job.destinationUid);
      if (destination && accepting(destination.uid, job.cargo) && canUnload(destination, job.cargo)) {
        job.hold = undefined; job.phase = "unloading"; job.timer = job.plan.unloading; job.blockedFor = 0;
        job.interrupted = undefined; return;
      }
      if (job.blockedFor >= SHUTTLE_FULL_RETURN_SECONDS) beginReturn(job, job.destinationLanding, "destination-full");
      return;
    }
    if (job.interrupted === "source-full" || job.interrupted === "source-lost") {
      const source = harbor(job.sourceUid);
      if (source && refund(job, source)) {
        if ((job.homeUid ?? job.sourceUid) !== job.sourceUid)
          returnHome(job, source.uid, job.sourceLanding);
        else if (release(job)) job.done = true;
        return;
      }
      if (!source && !empty(job.cargo) && deliverToDestination(job)) return;
      return;
    }
    if (job.blockedFor >= SHUTTLE_FULL_RETURN_SECONDS && job.interrupted === "destination-lost") {
      job.blockedFor = 0;
      beginReturn(job, job.hold ?? job.destinationLanding, "destination-lost");
    }
  };
  const rejectLoading = (job: ShuttleJob, building: SettlementBuilding) => {
    if (!refund(job, building)) {
      job.phase = "blocked"; job.timer = 1; job.interrupted = "source-full";
      job.hold = { ...job.sourceLanding }; job.resume = undefined;
      return;
    }
    if ((job.homeUid ?? job.sourceUid) !== job.sourceUid) {
      returnHome(job, building.uid, job.sourceLanding); return;
    }
    if (release(job)) job.done = true;
  };
  const advance = (job: ShuttleJob, dt: number) => {
    if (job.phase === "loading" || job.phase === "unloading") {
      const loading = job.phase === "loading", building = harbor(loading ? job.sourceUid : job.destinationUid);
      const site = building && jetty(building), landing = loading ? job.sourceLanding : job.destinationLanding;
      const route = loading ? job.sourceRoute : job.destinationRoute;
      const valid = site && DMath.hypot(site.landing.x - landing.x, site.landing.z - landing.z) < .01 &&
        site.route.length === route.length && site.route.every((point, index) =>
          DMath.hypot(point.x - route[index]!.x, point.z - route[index]!.z) < .01);
      if (!valid) {
        if (loading && building) rejectLoading(job, building);
        else beginReturn(job, job.destinationLanding, "destination-lost");
        return;
      }
    }
    if (job.phase === "blocked") { blocked(job, dt); return; }
    if ((job.phase === "outbound" || job.phase === "returning") && shouldYield(job, job.phase)) {
      job.yielding = true; return;
    }
    job.yielding = false;
    job.timer = Math.max(0, job.timer - dt);
    if (job.phase === "outbound" || job.phase === "returning") {
      job.blockedFor = safe(job.blockedFor ?? 0) + dt;
      if (job.blockedFor >= SHUTTLE_ROUTE_CHECK_SECONDS) {
        job.blockedFor = 0;
        if (!planner.clear(job.route) || !boatRouteClearOfShips(job.route, channelsNow())) {
          blockRoute(job, job.phase); return;
        }
      }
    }
    if (job.timer > 0) return;
    if (job.phase === "loading") {
      job.phase = "outbound"; job.timer = job.plan.outbound; job.blockedFor = 0; return;
    }
    if (job.phase === "outbound") { job.phase = "unloading"; job.timer = job.plan.unloading; job.blockedFor = 0; return; }
    if (job.phase === "unloading") { finishUnload(job); return; }
    if (job.phase === "returning") finishReturn(job);
  };
  const removeHarbour = (uid: number) => {
    for (const job of jobs) {
      if ((job.homeUid ?? job.sourceUid) === uid) {
        job.homeUid ??= uid;
        job.homeLost = true;
        if (job.phase === "returning" && empty(job.cargo)) {
          const from = pointAt(job, "returning", job.timer);
          returnHome(job, job.destinationUid, from);
        }
      }
      if (job.sourceUid === uid) job.sourceLost = true;
      if (job.destinationUid === uid) job.destinationLost = true;
      if (job.sourceUid === uid && job.phase === "loading") {
        job.phase = "outbound"; job.timer = job.plan.outbound; job.interrupted = undefined;
      } else if (job.sourceUid === uid && job.phase === "blocked" && job.interrupted === "source-lost") {
        job.blockedFor = SHUTTLE_FULL_RETURN_SECONDS - 1;
      }
      if (job.destinationUid === uid && ["loading", "outbound", "unloading"].includes(job.phase)) {
        let from = job.sourceLanding;
        if (job.phase === "outbound") from = pointAt(job, "outbound", job.timer);
        else if (job.phase === "unloading") from = job.destinationLanding;
        beginReturn(job, from, "destination-lost");
      }
    }
  };
  const cancel = (id: number) => {
    const job = jobs.find(candidate => candidate.id === id && !candidate.done);
    if (!job) return false;
    if (job.phase === "loading") {
      const source = harbor(job.sourceUid);
      if (source && !refund(job, source)) return false;
      if ((job.homeUid ?? job.sourceUid) !== job.sourceUid)
        return returnHome(job, job.sourceUid, job.sourceLanding);
      if (!release(job)) return false;
      job.done = true; return true;
    }
    job.interrupted = "cancelled";
    if (job.phase === "unloading") return beginReturn(job, job.destinationLanding, "cancelled");
    if (job.phase === "outbound") return beginReturn(job, pointAt(job, "outbound", job.timer), "cancelled");
    if (job.phase === "blocked") {
      if (empty(job.cargo)) return beginReturn(job, job.hold ?? job.sourceLanding, "cancelled");
      return beginReturn(job, job.hold ?? job.destinationLanding, "cancelled");
    }
    return false;
  };
  return { advance, cancel, removeHarbour };
};
