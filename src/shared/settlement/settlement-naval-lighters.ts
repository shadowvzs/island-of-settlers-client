import { SAILING_SHIP_HULL_BEAM } from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { type LighterLanding, pierLandingPlaces } from "./harbour-lighter-landings";
import { harbourLighterCount, LIGHTER_BOXES, type LighterPlan, planLighters } from "./harbour-lighters";
import { findHarbourDock } from "./settlement-harbour-docks";
import { HARBOUR_GANGWAY_LENGTH } from "./settlement-harbour-piers";
import { findHomeBuilding } from "./settlement-home";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import { harbourPorterSpeed, shipBoxes } from "./settlement-naval-ship-handling";
import { addIdleSettlers, availableIdleSettlers, countOnDuty, takeIdleSettler } from "./settlement-population";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { planCargoHandling, routeLength, TYPICAL_PORTER_ROUTE } from "./ship-cargo-handling";
import { SMALL_BOAT_JOB_VERSION, SMALL_BOAT_ROWERS } from "./small-boat-crew";

/** One lighter of a job: where it lands beside a pier, where it lies alongside the ship, the carriers' way. */
interface LighterBoat {
  alongside: SettlementPoint;
  landing: SettlementPoint;
  /** The landing place's number at its harbour: its carriers keep to their own lane. */
  place: number;
  /** Harbour door → … → where the carriers take the boxes at the landing. */
  route: SettlementPoint[];
}
/** A ship worked by the harbour's lighters at its waiting spot (saved with the ship). */
export interface LighterJob { version: typeof SMALL_BOAT_JOB_VERSION; boats: LighterBoat[]; harbourUid: number; plan: LighterPlan }
interface LandingSlot extends LighterLanding { place: number }

/** Lighters a ship gets at least while others wait (measured: one alone rarely beats the pier, NAV-03). */
const LIGHTERS_PER_SHIP = 2;
/** Rowers per lighter: settlers of the harbour, on duty while they row (they count in the population). */
const LIGHTER_ROWERS = SMALL_BOAT_ROWERS;
/** Tiles off the hull side where a lighter lies alongside, and between lighters alongside the same ship. */
const ALONGSIDE_GAP = .9;
const ALONGSIDE_SPACING = 2.2;
/**
 * Seconds a berth is lost between two ships: one casting off and sailing clear, the next coming in and
 * mooring (measured on the lighter scenarios: 70–90 s per turn beyond the pier time; the lower end is used).
 */
const BERTH_TURNAROUND_SECONDS = 60;
/** Share of a berth turn the lighters must beat the berths by (their estimate leaves out sailing in). */
const ESTIMATE_MARGIN = .25;
/** A ship's own least time at the pier (as `planHandling`'s TRANSFER_SECONDS). */
const PIER_MINIMUM_SECONDS = 10;
/** Water samples per tile along a rowing line (it must stay afloat the whole way). */
const ROW_SAMPLES = 2;

const keyOf = (point: SettlementPoint) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`;
const isQueuedNearby = (ship: NavalShip, reach: number) => ship.queuedAt !== undefined && !ship.waitsAtEdge &&
  DMath.hypot(ship.queuedAt.x - ship.x, ship.queuedAt.z - ship.z) < reach;
/** Only a plain cargo job: passengers, soldiers and voyages beyond the harbour keep to the pier. */
const plainCargo = (ship: NavalShip) => !ship.passengers?.length && !ship.troops?.length && !ship.colony &&
  !ship.expedition && !ship.exploration && !ship.visitor?.pickupTroops && shipBoxes(ship) > 0;
const working = (ship: NavalShip) => ship.phase === "loading" || ship.phase === "unloading";

export interface HarbourLightersOptions {
  berthing: FleetBerthing;
  /** Boats already claimed by other services (the nearby harbour shuttle) at a harbour. */
  boatClaims?: (uid: number) => number;
  context: SettlementContext;
  /** The ship lies within this reach of its waiting spot (tiles). */
  mooringReach: number;
  ships: readonly NavalShip[];
}

/**
 * Lighters of the fleet's harbours (NAV-03): while a harbour's berths are busy, the ship first in its queue,
 * lying at its waiting spot off the harbour, is loaded or unloaded by the harbour's lighters (one per `boat`
 * ware stored there, two slots per harbour, each needing a free landing place beside a pier and one of the harbour's
 * idle settlers to row it). Boats are not ship obstacles. Created once per fleet.
 */
export const createHarbourLighters = ({ berthing, boatClaims, context, mooringReach, ships }: HarbourLightersOptions) => {
  const { world } = context.options;
  const water = (point: SettlementPoint) => sampleSmooth(world, world.heights, point.x, point.z) < world.seaLevel - .05;
  const jobsAt = (uid: number) => ships.filter(ship => working(ship) && ship.lighters?.harbourUid === uid)
    .map(ship => ship.lighters!);
  /** Landing places beside the harbour's piers (`pierLandingPlaces`), numbered for the carriers' lanes. */
  const slotsOf = (uid: number) => berthing.berths.forHarbour(uid).flatMap(berth => slotsAt(uid, berth))
    .map((slot, place) => ({ ...slot, place }));
  const slotsAt = (uid: number, berth: SettlementPoint & { yaw?: number }) => {
    const dock = findHarbourDock(context, uid, { x: berth.x, yaw: berth.yaw ?? 0, z: berth.z });
    if (!dock) return [];
    const { point, shore } = dock.workPier;
    const deck = DMath.hypot(point.x - shore.x, point.z - shore.z) - HARBOUR_GANGWAY_LENGTH;
    return pierLandingPlaces(dock.workPier, deck, dock.porterRoute, water);
  };
  /** Ships waiting for harbour `uid`'s berth (at its waiting spot, at the map edge or beyond it). */
  const waiting = (uid: number) => ships.filter(ship => !working(ship) && !ship.visitor?.leaving &&
    (ship.queuedAt !== undefined || (ship.phase === "away" && ship.visitor !== undefined)) &&
    (ship.retryPhase === "positioning" ? ship.sourceUid : ship.destinationUid) === uid).length;
  /** Lighters the ship gets: free boats, free landing places and rowers, shared with the next waiting ship. */
  const boatsFor = (harbour: SettlementBuilding, slots: readonly LandingSlot[], shared = true) => {
    const jobs = jobsAt(harbour.uid), busy = jobs.reduce((sum, job) => sum + job.plan.lighters, 0) +
      (boatClaims?.(harbour.uid) ?? 0);
    const boats = harbourLighterCount(harbour.inventory.boat ?? 0) - busy;
    const taken = new Set(jobs.flatMap(job => job.boats.map(boat => keyOf(boat.landing))));
    const free = slots.filter(slot => !taken.has(keyOf(slot.landing)));
    const rowers = Math.floor(availableIdleSettlers(context, harbour) / LIGHTER_ROWERS);
    // A lone waiting ship gets every free boat; with more waiting, half of them (beyond two) stay for the next.
    const share = shared && waiting(harbour.uid) > 1 ? Math.max(LIGHTERS_PER_SHIP, Math.ceil(boats / 2)) : boats;
    return free.slice(0, Math.max(0, Math.min(boats, rowers, share)));
  };
  /** Where each lighter lies alongside the ship, on its side facing the landings, spread along the hull. */
  const alongsideOf = (ship: NavalShip, landing: SettlementPoint, index: number, count: number) => {
    const across = { x: DMath.cos(ship.yaw), z: -DMath.sin(ship.yaw) };
    const keel = { x: DMath.sin(ship.yaw), z: DMath.cos(ship.yaw) };
    const side = Math.sign((landing.x - ship.x) * across.x + (landing.z - ship.z) * across.z) || 1;
    const reach = (SAILING_SHIP_HULL_BEAM / 2 + ALONGSIDE_GAP) * side;
    const shift = (index - (count - 1) / 2) * ALONGSIDE_SPACING;
    return { x: ship.x + across.x * reach + keel.x * shift, z: ship.z + across.z * reach + keel.z * shift };
  };
  /** The straight rowing line stays on water. */
  const afloat = (from: SettlementPoint, to: SettlementPoint) => {
    const samples = Math.ceil(DMath.hypot(to.x - from.x, to.z - from.z) * ROW_SAMPLES);
    for (let index = 0; index <= samples; index++) {
      const share = index / Math.max(1, samples);
      if (!water({ x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share })) return false;
    }
    return true;
  };
  /** The job for `ship` with the lighters of `slots`, or null where a lighter cannot row to it. */
  const jobFor = (
    ship: NavalShip, uid: number, slots: readonly LandingSlot[], unloading: boolean, passengers = 0
  ): LighterJob | null => {
    const boats = slots.map((slot, index) =>
      ({ ...slot, alongside: alongsideOf(ship, slot.landing, index, slots.length) }));
    if (!boats.length || !boats.every(boat => afloat(boat.landing, boat.alongside))) return null;
    const row = Math.max(...boats.map(boat =>
      DMath.hypot(boat.alongside.x - boat.landing.x, boat.alongside.z - boat.landing.z)));
    const walk = Math.max(...boats.map(boat => routeLength(boat.route)));
    const plan = planLighters(shipBoxes(ship), boats.length, row, walk, unloading, harbourPorterSpeed(context, uid),
      passengers);
    return { boats, harbourUid: uid, plan, version: SMALL_BOAT_JOB_VERSION };
  };
  /**
   * The lighters help only where they shorten the whole queue (owner, 2026-10-20: more lighters must never be
   * slower than fewer or the piers alone). With no more ships than berths waiting, the ship is done before
   * its own pier turn would be; with more, the job takes a whole turn off the berths' queue and is over
   * before the berths would be done without it. Both with a quarter turn's margin: the estimate leaves out
   * the ships still to sail in from the map edge.
   */
  const sooner = (ship: NavalShip, job: LighterJob, holders: readonly NavalShip[], uid: number) => {
    const pierSeconds = (other: NavalShip) => planCargoHandling(shipBoxes(other), TYPICAL_PORTER_ROUTE,
      PIER_MINIMUM_SECONDS, harbourPorterSpeed(context, uid)).seconds;
    const berthFree = Math.min(...holders.map(holder => working(holder) ? holder.timer : pierSeconds(holder)));
    const turn = pierSeconds(ship) + BERTH_TURNAROUND_SECONDS, ships = Math.max(1, waiting(uid));
    const turns = (count: number) => Math.ceil(count / holders.length);
    const finished = job.plan.seconds + turn * ESTIMATE_MARGIN;
    if (ships <= holders.length) return finished < berthFree + turn;
    return turns(ships - 1) < turns(ships) && finished < berthFree + (turns(ships) - 1) * turn;
  };
  /**
   * Seconds until `ship` would be done at harbour `uid`'s pier, `own` seconds of work once it lies there: at
   * once at a free berth, else after the first berth comes free, the queue ahead's turns and the turnaround.
   */
  const pierFinish = (ship: NavalShip, uid: number, own: number) => {
    const holders = berthing.berthHolders(uid, ship);
    if (!holders.length || holders.some(holder => !holder)) return own;
    const turns = Math.floor(waiting(uid) / holders.length);
    return berthFreeIn(uid, ship) + turns * (own + BERTH_TURNAROUND_SECONDS) + BERTH_TURNAROUND_SECONDS + own;
  };
  /** Seconds until the first of harbour `uid`'s berths comes free (0 while one is free): its ship's pier time left. */
  const berthFreeIn = (uid: number, ship: NavalShip) => {
    const holders = berthing.berthHolders(uid, ship);
    if (!holders.length || holders.some(holder => !holder)) return 0;
    const pierSeconds = (other: NavalShip) => planCargoHandling(shipBoxes(other), TYPICAL_PORTER_ROUTE,
      PIER_MINIMUM_SECONDS, harbourPorterSpeed(context, uid)).seconds;
    // The berth is clear for the next ship once its ship has cast off and sailed clear (a turnaround).
    return BERTH_TURNAROUND_SECONDS +
      Math.min(...(holders as NavalShip[]).map(holder => working(holder) ? holder.timer : pierSeconds(holder)));
  };
  /** The rowers leave the harbour's idle settlers for the job (or come back to them, `count` < 0). */
  const crew = (harbour: SettlementBuilding | undefined, count: number) => {
    if (count > 0) for (let rower = 0; rower < count; rower++) takeIdleSettler(context, harbour!);
    else {
      const home = harbour ?? findHomeBuilding(context);
      if (home) addIdleSettlers(context, home, -count);
    }
    countOnDuty(context, count);
  };
  /**
   * A ship first in a busy harbour's queue, lying at its waiting spot with a plain cargo job, is worked by
   * the harbour's free lighters (the berths stay taken). True when the lighters took it over.
   */
  const tryStart = (ship: NavalShip) => {
    // A cargo of one lighter load is done at the pier sooner than a lighter rows out and back (measured), and
    // own ships' cargo goes by the pier (2026-10-21: with piers of ~40 s, lighters made 8 own ships with
    // 132 stone slower, 531 s against 465 s); lighters still ferry passengers and help queued visitors.
    if (!ship.visitor || !isQueuedNearby(ship, mooringReach) || !plainCargo(ship) || shipBoxes(ship) <= LIGHTER_BOXES)
      return false;
    const loading = ship.retryPhase === "positioning", uid = loading ? ship.sourceUid : ship.destinationUid;
    // Passengers first (owner, 2026-10-21): no cargo job takes a lighter a ferried ship is coming for.
    if (ships.some(other => other.ferryAt && (other.phase === "positioning" ? other.sourceUid :
      other.destinationUid) === uid)) return false;
    const harbour = uid === undefined ? undefined : berthing.harbor(uid);
    if (!harbour || (!loading && !berthing.accepting(harbour.uid, ship.cargo, ship))) return false;
    const slots = boatsFor(harbour, slotsOf(harbour.uid));
    const holders = berthing.berthHolders(harbour.uid, ship);
    // Only while every berth is taken: a ship that can come to the pier soon goes there.
    if (!slots.length || holders.some(holder => !holder)) return false;
    const job = jobFor(ship, harbour.uid, slots, !loading);
    if (!job || !sooner(ship, job, holders as NavalShip[], harbour.uid)) return false;
    berthing.leaveQueue(ship);
    begin(ship, harbour, job, loading);
    return true;
  };
  /** The lighters take the ship's job over: rowers out, the ship worked where it lies. */
  const begin = (ship: NavalShip, harbour: SettlementBuilding, job: LighterJob, loading: boolean) => {
    crew(harbour, job.plan.lighters * LIGHTER_ROWERS);
    Object.assign(ship, { cursor: 0, handling: undefined, lighters: job, phase: loading ? "loading" : "unloading",
      retryPhase: undefined, route: [], speed: 0, timer: job.plan.seconds });
  };
  /**
   * Passengers by boat (owner, 2026-10-21): every free lighter of the harbour (no share kept for the next
   * ship) works the ship and its passengers; null while none can (no boat, rower or landing place free).
   */
  const ferryJob = (ship: NavalShip, harbour: SettlementBuilding, loading: boolean) => {
    const slots = boatsFor(harbour, slotsOf(harbour.uid), false);
    return slots.length ? jobFor(ship, harbour.uid, slots, !loading, ship.passengers?.length ?? 0) : null;
  };
  /** After unloading by lighter, a visitor's pickup is loaded by the same lighters and rowers. */
  const continueLoading = (ship: NavalShip, job: LighterJob | undefined) => {
    if (!job || ship.phase !== "loading" || !plainCargo(ship)) return;
    const next = jobFor(ship, job.harbourUid, job.boats, false);
    if (next) { Object.assign(ship, { handling: undefined, lighters: next, timer: next.plan.seconds }); return; }
    // The pickup goes by the pier's plan after all: the lighters go home now.
    crew(berthing.harbor(job.harbourUid), -job.plan.lighters * LIGHTER_ROWERS);
    ship.lighters = undefined;
  };
  /** Lighters whose ship is no longer worked by them go home: the boats fade away, the rowers rest. */
  const sweep = () => {
    for (const ship of ships) {
      // A visitor gone off the map straight from its job (no way out to sail) also sends its rowers home.
      if (!ship.lighters || (working(ship) && !ship.gone)) continue;
      crew(berthing.harbor(ship.lighters.harbourUid), -ship.lighters.plan.lighters * LIGHTER_ROWERS);
      ship.lighters = undefined;
    }
  };
  /** Rowers out on the water (on duty, for the population count after a load). */
  const rowers = () => ships.reduce((sum, ship) => sum + (ship.lighters?.plan.lighters ?? 0) * LIGHTER_ROWERS, 0);
  return { begin, berthFreeIn, continueLoading, ferryJob, pierFinish, rowers, sweep, tryStart };
};
