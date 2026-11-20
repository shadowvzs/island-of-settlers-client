import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import type { ShipSiteFrame, ShuttleBoatFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import {
  type BoatJetty, boatPointClearOfBerths, boatRouteClearOfShips, findBoatJetty, type ShipChannel
} from "./harbour-boat-jetty";
import { registerBoatJettyReservations } from "./harbour-boat-reservations";
import { type BoatRoutePlanner } from "./harbour-boat-route";
import { harbourLighterCount } from "./harbour-lighters";
import { type ShuttleNeed, shuttleNeeds } from "./harbour-shuttle-demand";
import { shuttleBoatContact } from "./harbour-shuttle-handling";
import {
  emptyShuttleState, planShuttle, SHUTTLE_ROWERS, shuttleBoatFrame, type ShuttleJob, type ShuttleReason,
  type ShuttleState, type ShuttleStatus
} from "./harbour-shuttle-plan";
import { addGood } from "./production-rules";
import { findHarbourDock } from "./settlement-harbour-docks";
import { HARBOUR_LOCAL_SHORE_REACH } from "./settlement-harbour-pier-geometry";
import { isOwnBuilding } from "./settlement-home";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { NavalOrder, NavalShip } from "./settlement-naval-fleet";
import { createShuttleMover } from "./settlement-naval-shuttle-mover";
import { availableIdleSettlers, countOnDuty, takeIdleSettler } from "./settlement-population";
import { STONEMASON_RADIUS } from "./settlement-stone-area";
import { contextTalents } from "./settlement-talents";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { storageSnapshot } from "./shared-storage";
import { SMALL_BOAT_JOB_VERSION } from "./small-boat-crew";
import { storageContribution } from "./storage-capacity";
import { chooseNextTransportJob } from "./transport-reuse-policy";

/** One-way water-route limit: 1.5x the canonical base fishery work radius. */
export const SHUTTLE_MAX_ROUTE = STONEMASON_RADIUS * 1.5;
/** The bounded revalidation cadence for nearby pairs (not every simulation tick). */
export const SHUTTLE_SCAN_SECONDS = 4;
/** Access points can sit up to one jetty search radius beyond each landing, so widen only the prefilter. */
const PAIR_GUARD = 2 * HARBOUR_LOCAL_SHORE_REACH;
const JETTY_ID_OFFSET = 3_000_000;

export interface HarbourShuttleOptions {
  berthing: FleetBerthing;
  context: SettlementContext;
  orders: readonly NavalOrder[];
  planner: BoatRoutePlanner;
  ships: readonly NavalShip[];
}
interface Pair { source: BoatJetty; destination: BoatJetty; route: SettlementPoint[]; distance: number }
interface Candidate { destination: SettlementBuilding; needs: ShuttleNeed[]; pair: Pair }
const routeLength = (route: readonly SettlementPoint[]) => route.reduce((sum, point, index) =>
  sum + (index ? DMath.hypot(point.x - route[index - 1]!.x, point.z - route[index - 1]!.z) : 0), 0);
const addLoad = (goods: Goods, load: Readonly<Goods>) => {
  for (const [ware, count] of Object.entries(load)) addGood(goods, ware, count);
};
const removeLoad = (goods: Goods, ware: string, count: number) => {
  goods[ware] = Math.max(0, (goods[ware] ?? 0) - count);
  if (!goods[ware]) delete goods[ware];
};
const safe = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Nearby harbour boat shuttle (BOAT-P00..P04): one stored boat and two idle rowers from a source
 * harbour carry real wares over a boat-clear water route to a completed friendly harbour. It is not
 * a second transport engine: demand comes from existing transfer orders or the destination's shared
 * expedition/upgrade need, cargo has one owner, and the boat/crew pool is shared with the lighters.
 * A harbour without a safe dedicated landing gets no service.
 */
export const createHarbourShuttles = ({ berthing, context, orders, planner, ships }: HarbourShuttleOptions) => {
  const state = emptyShuttleState();
  const pairs = new Map<string, Pair | null>();
  let scanTimer = 0, channelKey = "", channels: ShipChannel[] = [], pairRevision = "";
  const harbor = (uid: number) => berthing.harbor(uid);
  const finished = () => context.buildings.filter(building => building.typeId === 39 && building.construction === 1 &&
    isOwnBuilding(building));
  const revision = () => [context.navigationRevision ?? 0, context.options.world.buildRevision ?? 0,
    context.options.world.terrainRevision ?? 0, context.options.world.props.count, getKnownRocks(context.options.world).length,
    ...finished().flatMap(building => [building.uid, building.workshopUpgrade?.level ?? 0])].join(":");
  const channelsNow = () => {
    const key = revision();
    if (key === channelKey) return channels;
    channelKey = key;
    planner.clearCache();
    channels = finished().map(building => {
      const berths = berthing.berths.forHarbour(building.uid, true);
      return { berths: berths.map(pose => ({ x: pose.x, yaw: pose.yaw ?? 0, z: pose.z })),
        lanes: berthing.lanesFor(building.uid),
        piers: berths.flatMap(pose => {
          const work = findHarbourDock(context, building.uid, { yaw: pose.yaw ?? 0, x: pose.x, z: pose.z })?.workPier;
          return work ? [{ point: { x: work.point.x, z: work.point.z }, shore: { x: work.shore.x, z: work.shore.z } }] : [];
        }) };
    });
    return channels;
  };
  const jetty = (building: SettlementBuilding) => findBoatJetty(context, building, planner, channelsNow());
  const busyLighters = (uid: number) => ships.reduce((sum, ship) =>
    sum + (ship.lighters?.harbourUid === uid ? ship.lighters.plan.lighters : 0), 0);
  const busyShuttles = (uid: number) => state.jobs.filter(job => (job.homeUid ?? job.sourceUid) === uid).length;
  const storedBoats = (building: SettlementBuilding) => harbourLighterCount(building.inventory.boat ?? 0);
  const freeBoats = (building: SettlementBuilding) =>
    Math.max(0, storedBoats(building) - busyLighters(building.uid) - busyShuttles(building.uid));
  /** The receiving harbour's own per-ware room; another storage's space is not a landing contact. */
  const canReceive = (destination: SettlementBuilding, cargo: Readonly<Goods>) => {
    const pooled = storageSnapshot(context, destination);
    if (pooled) return Object.entries(cargo).every(([ware, count]) =>
      (pooled.stored[ware] ?? 0) + (pooled.incoming[ware] ?? 0) + count <= pooled.capacity);
    const capacity = storageContribution(destination, contextTalents(context).storageCapacity);
    return capacity > 0 && Object.entries(cargo).every(([ware, count]) =>
      (destination.inventory[ware] ?? 0) + (destination.incoming[ware] ?? 0) + count <= capacity);
  };
  /** The job's own load is already in `incoming`; only the final stored+reserved total matters. */
  const canUnload = (destination: SettlementBuilding, cargo: Readonly<Goods>) => {
    const pooled = storageSnapshot(context, destination);
    if (pooled) return Object.keys(cargo).every(ware =>
      (pooled.stored[ware] ?? 0) + (pooled.incoming[ware] ?? 0) <= pooled.capacity);
    const capacity = storageContribution(destination, contextTalents(context).storageCapacity);
    return capacity > 0 && Object.entries(cargo).every(([ware]) =>
      (destination.inventory[ware] ?? 0) + (destination.incoming[ware] ?? 0) <= capacity);
  };
  const shipWaiting = (uid: number) => ships.some(ship => ship.phase !== "idle" && ship.phase !== "away" &&
    (ship.sourceUid === uid || ship.destinationUid === uid) &&
    ["loading", "positioning", "stranded", "unloading"].includes(ship.phase));
  const pairKey = (source: SettlementBuilding, destination: SettlementBuilding) => `${source.uid}:${destination.uid}`;
  const pairFor = (source: SettlementBuilding, destination: SettlementBuilding): Pair | null => {
    const revisionNow = revision();
    if (pairRevision !== revisionNow) { pairs.clear(); pairRevision = revisionNow; }
    const key = pairKey(source, destination);
    if (pairs.has(key)) return pairs.get(key)!;
    const sourceJetty = jetty(source), destinationJetty = jetty(destination);
    let pair: Pair | null = null;
    if (sourceJetty && destinationJetty) {
      const channels = channelsNow();
      const avoid = (point: SettlementPoint) => !boatPointClearOfBerths(point, channels);
      const usable = (route: readonly SettlementPoint[] | null) => Boolean(route && planner.clear(route) &&
        boatRouteClearOfShips(route, channels));
      let route = planner.route(sourceJetty.landing, destinationJetty.landing, avoid);
      // The water is the same either way; use the reverse course when only that one is boat-clear.
      if (!usable(route)) {
        const reverse = planner.route(destinationJetty.landing, sourceJetty.landing, avoid);
        route = usable(reverse) ? [...reverse!].reverse() : null;
      }
      const distance = route ? routeLength(route) : Infinity;
      if (usable(route) && distance <= SHUTTLE_MAX_ROUTE && DMath.hypot(source.access.x - destination.access.x,
        source.access.z - destination.access.z) <= SHUTTLE_MAX_ROUTE + PAIR_GUARD)
        pair = { destination: destinationJetty, distance, route: route!, source: sourceJetty };
    }
    pairs.set(key, pair);
    return pair;
  };
  /** Seconds left in the current phase, for the harbour panel. */
  const secondsLeft = (job: ShuttleJob) => safe(job.timer);
  const reasonFor = (building: SettlementBuilding, active?: ShuttleJob): ShuttleReason => {
    if (active) {
      const loaded = Object.values(active.cargo).some(count => count > 0);
      if (active.interrupted === "destination-full" && loaded) return "destination-full";
      if (active.interrupted === "route-blocked") return "route-blocked";
      if (loaded && (active.interrupted === "source-full" || active.interrupted === "source-lost" ||
        active.interrupted === "destination-lost")) return "cargo-blocked";
      return "active";
    }
    if (!jetty(building)) return "no-landing";
    const partners = finished().filter(other => other.uid !== building.uid &&
      DMath.hypot(other.access.x - building.access.x, other.access.z - building.access.z) <=
        SHUTTLE_MAX_ROUTE + PAIR_GUARD);
    if (!partners.length) return "no-partner";
    // A harbour may receive from a partner even when its own outbound path is the constrained one.
    if (!partners.some(other => pairFor(building, other) || pairFor(other, building))) return "no-route";
    if (freeBoats(building) < 1 || (shipWaiting(building.uid) && freeBoats(building) < 2)) return "waiting-boat";
    if (availableIdleSettlers(context, building) < SHUTTLE_ROWERS) return "no-crew";
    return "idle";
  };
  const statusOf = (building: SettlementBuilding): ShuttleStatus => {
    const active = state.jobs.find(job => job.sourceUid === building.uid || job.destinationUid === building.uid ||
      job.homeUid === building.uid);
    const destination = active && (active.sourceUid === building.uid ? active.destinationUid : active.sourceUid);
    return { cargo: active ? { ...active.cargo } : undefined, destinationUid: destination,
      freeBoats: freeBoats(building), idleRowers: availableIdleSettlers(context, building),
      phase: active?.phase, reason: reasonFor(building, active), secondsLeft: active ? secondsLeft(active) : undefined,
      storedBoats: storedBoats(building), uid: building.uid };
  };
  /** Reserves one ware need from source stock; false leaves every balance untouched. */
  const reserve = (source: SettlementBuilding, destination: SettlementBuilding, need: ShuttleNeed,
    crew: boolean) => {
    if ((source.inventory[need.ware] ?? 0) < need.count) return null;
    const load = { [need.ware]: need.count };
    removeLoad(source.inventory, need.ware, need.count);
    if (!canReceive(destination, load)) {
      addLoad(source.inventory, load); return null;
    }
    if (crew && availableIdleSettlers(context, source) < SHUTTLE_ROWERS) {
      addLoad(source.inventory, load); return null;
    }
    if (crew) {
      let taken = 0;
      for (; taken < SHUTTLE_ROWERS && takeIdleSettler(context, source); taken++);
      if (taken < SHUTTLE_ROWERS) {
        source.idleSettlers = (source.idleSettlers ?? 0) + taken; context.settlers += taken;
        addLoad(source.inventory, load); return null;
      }
      countOnDuty(context, SHUTTLE_ROWERS);
    }
    // The destination reservation is visible to the shared carrier/expedition demand ledger.
    for (const [ware, count] of Object.entries(load)) addGood(destination.incoming, ware, count);
    if (need.transfer) {
      need.transfer.count -= need.count;
      if (need.transfer.count <= 0) context.transfers = context.transfers.filter(order => order !== need.transfer);
    }
    return load;
  };
  const start = (source: SettlementBuilding, destination: SettlementBuilding, pair: Pair, need: ShuttleNeed) => {
    if (freeBoats(source) < 1 || shipWaiting(source.uid) && freeBoats(source) < 2) return false;
    const load = reserve(source, destination, need, true);
    if (!load) return false;
    const plan = planShuttle(load, pair.source, pair.destination, pair.distance);
    const job: ShuttleJob = { cargo: load, crew: SHUTTLE_ROWERS, version: SMALL_BOAT_JOB_VERSION,
      demand: { automatic: need.automatic, count: need.count,
        destination: need.transfer?.destination ?? destination.uid, ware: need.ware },
      destinationLanding: pair.destination.landing, destinationRoute: pair.destination.route,
      destinationUid: destination.uid, homeUid: source.uid, id: state.nextJob++, legIndex: 0, phase: "loading", plan, route: pair.route,
      sourceLanding: pair.source.landing, sourceRoute: pair.source.route, sourceUid: source.uid, timer: plan.loading };
    state.jobs.push(job);
    return true;
  };
  const rankedNeeds = (candidates: readonly Candidate[]) => candidates.flatMap(candidate =>
    candidate.needs.map(need => ({ order: need.order, remainingNeed: need.remainingNeed,
      routeDistance: candidate.pair.distance, value: { ...candidate, need } })));
  /** Select real uncovered needs before choosing the bounded visible boat load. */
  const scan = () => {
    for (const source of finished()) {
      if (state.jobs.some(job => job.sourceUid === source.uid ||
        job.phase === "unloading" && job.destinationUid === source.uid) || freeBoats(source) < 1 ||
        availableIdleSettlers(context, source) < SHUTTLE_ROWERS) continue;
      const candidates: Candidate[] = [];
      for (const destination of finished()) {
        if (destination.uid === source.uid || state.jobs.some(job => job.destinationUid === destination.uid)) continue;
        if (DMath.hypot(source.access.x - destination.access.x, source.access.z - destination.access.z) >
          SHUTTLE_MAX_ROUTE + PAIR_GUARD) continue;
        const pair = pairFor(source, destination);
        if (!pair) continue;
        const needs = shuttleNeeds(context, source, destination, orders, ships);
        if (needs.length) candidates.push({ destination, needs, pair });
      }
      const pending = rankedNeeds(candidates);
      while (pending.length) {
        const next = chooseNextTransportJob(pending);
        if (!next || start(source, next.destination, next.pair, next.need)) break;
        pending.splice(pending.findIndex(entry => entry.value === next), 1);
      }
    }
  };
  /** The same boat and paid paddler serve the largest uncovered onward need at this landing. */
  const reuse = (job: ShuttleJob, source: SettlementBuilding) => {
    if (job.returningHome || job.interrupted || job.homeLost || !harbor(job.homeUid ?? job.sourceUid)) return false;
    job.homeUid ??= job.sourceUid;
    const candidates: Candidate[] = [];
    for (const destination of finished()) {
      if (destination.uid === source.uid || state.jobs.some(other => other !== job &&
        (other.sourceUid === source.uid || other.destinationUid === destination.uid))) continue;
      const pair = pairFor(source, destination);
      if (!pair) continue;
      const needs = shuttleNeeds(context, source, destination, orders, ships);
      if (needs.length) candidates.push({ destination, needs, pair });
    }
    const pending = rankedNeeds(candidates);
    while (pending.length) {
      const candidate = chooseNextTransportJob(pending);
      if (!candidate) break;
      const { need } = candidate;
      const load = reserve(source, candidate.destination, need, false);
      if (!load) {
        pending.splice(pending.findIndex(entry => entry.value === candidate), 1); continue;
      }
      const { destination, pair } = candidate, plan = planShuttle(load, pair.source, pair.destination, pair.distance);
      Object.assign(job, { cargo: load, legIndex: (job.legIndex ?? 0) + 1, demand: { automatic: need.automatic, count: need.count,
        destination: need.transfer?.destination ?? destination.uid, ware: need.ware },
        destinationLanding: pair.destination.landing, destinationLost: undefined,
        destinationRoute: pair.destination.route, destinationUid: destination.uid,
        hold: undefined, interrupted: undefined, phase: "loading", plan, resume: undefined,
        route: pair.route, sourceLanding: pair.source.landing, sourceLost: undefined,
        sourceRoute: pair.source.route, sourceUid: source.uid, timer: plan.loading });
      return true;
    }
    return false;
  };
  const mover = createShuttleMover({ accepting: (uid, cargo) => Boolean(berthing.accepting(uid, cargo)),
    canReceive, canUnload, channelsNow, context, harbor, jetty, jobs: state.jobs, planner, reuse, ships });
  const sweep = () => {
    for (let index = state.jobs.length - 1; index >= 0; index--)
      if (state.jobs[index]!.done) state.jobs.splice(index, 1);
  };
  const update = (dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return;
    scanTimer -= dt;
    if (scanTimer <= 0) { scanTimer = SHUTTLE_SCAN_SECONDS; scan(); }
    for (const job of state.jobs) if (!job.done) mover.advance(job, dt);
    sweep();
  };
  const saveState = (): ShuttleState => ({ jobs: state.jobs, nextJob: state.nextJob });
  const restore = (saved?: ShuttleState) => {
    state.jobs.splice(0, state.jobs.length, ...(saved?.jobs ?? []));
    state.nextJob = saved?.nextJob ?? 1;
    // Reconstruct the current hull-side handling contact, preserving the saved work clock and ownership.
    for (const job of state.jobs) for (const [route, landing] of [
      [job.sourceRoute, job.sourceLanding], [job.destinationRoute, job.destinationLanding]
    ] as const) {
      const jetty = route.at(-2);
      if (jetty) route[route.length - 1] = shuttleBoatContact(landing, jetty);
    }
    scanTimer = 0; pairs.clear(); channelKey = ""; pairRevision = "";
  };
  const frames = (): ShuttleBoatFrame[] => state.jobs.map(job => ({
    ...shuttleBoatFrame(job, job.id, context.options.world.seaLevel), nation: context.playerNation
  }));
  /**
   * Stable jetty frames: the pier renderer rebuilds its merged mesh only when these references change.
   * After a revision move every harbour's jetty is asked for again (each is reused while its copied
   * inputs are unchanged, JETTY-FRAMES); the same jetties keep the same frame list.
   */
  let jettyKey = "", jettyCache: ShipSiteFrame[] = [];
  let jettySites = new Map<number, BoatJetty>();
  const siteFrames = new WeakMap<BoatJetty, ShipSiteFrame>();
  const jettyFrame = (uid: number, site: BoatJetty): ShipSiteFrame => {
    const known = siteFrames.get(site);
    if (known) return known;
    const y = context.options.world.seaLevel;
    const frame: ShipSiteFrame = { id: JETTY_ID_OFFSET + uid, kind: "jetty", nation: context.playerNation,
      progress: 1,
      workPier: { contact: { x: site.landing.x, z: site.landing.z }, point: { x: site.point.x, z: site.point.z },
        shore: { x: site.foot.x, z: site.foot.z }, shoreY: site.footY, y: y + .18 },
      x: site.point.x, y, yaw: DMath.atan2(site.point.x - site.foot.x, site.point.z - site.foot.z), z: site.point.z };
    siteFrames.set(site, frame);
    return frame;
  };
  const sameSites = (first: ReadonlyMap<number, BoatJetty>, second: ReadonlyMap<number, BoatJetty>) =>
    first.size === second.size && [...first].every(([uid, site]) => second.get(uid) === site);
  const jettyFrames = (): ShipSiteFrame[] => {
    const key = `${revision()}:${context.playerNation}`;
    if (key === jettyKey) return jettyCache;
    jettyKey = key;
    const sites = new Map<number, BoatJetty>();
    for (const building of finished()) {
      const site = jetty(building);
      if (site) sites.set(building.uid, site);
    }
    if (sameSites(sites, jettySites)) return jettyCache;
    jettySites = sites;
    jettyCache = [...sites].map(([uid, site]) => jettyFrame(uid, site));
    return jettyCache;
  };
  registerBoatJettyReservations(context, () => { jettyFrames(); return [...jettySites.values()]; });
  return {
    busyBoats: (uid: number) => busyShuttles(uid), cancel: mover.cancel, claimedBoats: busyShuttles,
    frames, jettyFrames, jobs: () => state.jobs, removeHarbour: mover.removeHarbour, restore,
    rowers: () => state.jobs.reduce((sum, job) => sum + job.crew, 0),
    saveState, snapshot: () => finished().map(statusOf), status: (uid: number) => {
      const building = harbor(uid); return building ? statusOf(building) : undefined;
    }, update
  };
};
