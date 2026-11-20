import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { harbourLighterCount, passengerPlaceAt } from "./harbour-lighters";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { NavalPassengerHooks, NavalShip } from "./settlement-naval-fleet";
import type { createHarbourLighters, LighterJob } from "./settlement-naval-lighters";
import { availableIdleSettlers } from "./settlement-population";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { routeLength } from "./ship-cargo-handling";
import { SMALL_BOAT_ROWERS } from "./small-boat-crew";

/** Seconds a passenger takes over the pier, two in file (measured: 16 s for 2, 68 s for 10). */
const PIER_SECONDS_PER_PASSENGER = 6.5;

/** The point `distance` tiles along a walking route, facing along it. */
const pointAlong = (points: readonly SettlementPoint[], distance: number) => {
  let left = distance;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!, length = DMath.hypot(to.x - from.x, to.z - from.z);
    if (left > length && index < points.length - 1) { left -= length; continue; }
    const share = length ? Math.min(1, left / length) : 1;
    return { x: from.x + (to.x - from.x) * share, yaw: DMath.atan2(to.x - from.x, to.z - from.z),
      z: from.z + (to.z - from.z) * share };
  }
  return { ...points.at(-1)!, yaw: 0 };
};

type FerryLoad = Pick<NavalShip, "colony" | "expedition" | "passengers" | "troops" | "visitor">;
/**
 * A load the lighters may ferry: settlers or scouts and nothing military (no soldier, horse or troop aboard);
 * colony and expedition voyages and visitors keep to the pier.
 */
export const isFerryLoad = (ship: FerryLoad, isMilitary: (uid: number) => boolean) =>
  Boolean(ship.passengers?.length) && !ship.troops?.length && !ship.colony && !ship.expedition &&
  !ship.visitor && !ship.passengers!.some(isMilitary);

export interface NavalFerriesOptions {
  berthing: FleetBerthing;
  context: SettlementContext;
  hooks?: NavalPassengerHooks;
  lighters: ReturnType<typeof createHarbourLighters>;
  ships: readonly NavalShip[];
}

/**
 * Passengers by boat (owner, 2026-10-21): a ship with settlers or scouts but no soldiers, horses or troops
 * aboard, at a harbour that has lighters and whose pier is busy (every berth taken or ships queued), lies at a
 * waiting spot and the lighters ferry its passengers (a barge
 * load per trip, never with boxes) and its boxes; otherwise it docks at the pier as before. The passengers stay
 * actors throughout (phase `navalFerry` while off the deck and out of the harbour), placed each tick from the
 * job's plan, so a save mid-trip restores each one where it was. Created once per fleet.
 */
export const createNavalFerries = ({ berthing, context, hooks, lighters, ships }: NavalFerriesOptions) => {
  const actorOf = (uid: number) => context.actors.find(actor => actor.uid === uid);
  const isMilitary = (uid: number) => actorOf(uid)?.job === "Soldier" ||
    context.military?.troopType?.(uid) !== undefined;
  const eligible = (ship: FerryLoad) => isFerryLoad(ship, isMilitary);
  /** The waiting spot where `ship` lies to be ferried at harbour `uid`, or null: the pier as before. */
  const spot = (uid: number, ship: NavalShip, passengers: Pick<NavalShip, "colony" | "expedition" | "passengers">,
    loading: boolean) => {
    const harbour = berthing.harbor(uid);
    if (!harbour || !eligible({ ...passengers, troops: ship.troops, visitor: ship.visitor })) return null;
    if (!harbourLighterCount(harbour.inventory.boat ?? 0) ||
      availableIdleSettlers(context, harbour) < SMALL_BOAT_ROWERS) return null;
    // Only while the pier is busy (owner, 2026-10-21): a free berth and no queue, the ship docks as before.
    if (berthing.dock(uid, ship) && !berthing.queuedNear(uid, ship)) return null;
    const at = berthing.anchorage(uid, ship);
    return at && sooner(uid, { ...ship, ...passengers, x: at.x, yaw: at.yaw ?? ship.yaw, z: at.z }, loading) ? at : null;
  };
  /**
   * By boat only when it finishes first (owner, 2026-10-21): the lighters' job from the waiting spot against
   * waiting for a berth and boarding over the pier.
   */
  const sooner = (uid: number, ship: NavalShip, loading: boolean) => {
    const harbour = berthing.harbor(uid)!, job = lighters.ferryJob(ship, harbour, loading);
    const pier = PIER_SECONDS_PER_PASSENGER * (ship.passengers?.length ?? 0);
    return Boolean(job) && job!.plan.seconds < lighters.pierFinish(ship, uid, pier);
  };
  /**
   * The ship reached its waiting spot: the lighters take over (`started`), its passengers are not all at the
   * harbour yet (`wait`), or no lighter can come after all (`pier`).
   */
  const start = (ship: NavalShip) => {
    const loading = ship.phase === "positioning", uid = loading ? ship.sourceUid : ship.destinationUid;
    const harbour = uid === undefined ? undefined : berthing.harbor(uid);
    if (!harbour) return "pier";
    if (loading && !(hooks?.ready(ship.passengers ?? []) ?? true)) return "wait";
    const job = lighters.ferryJob(ship, harbour, loading);
    if (!job) return "pier";
    lighters.begin(ship, harbour, job, loading);
    ship.ferryAt = undefined;
    return "started";
  };
  /** A ferried passenger where the plan says: walking, at the landing, in the barge or on deck. */
  const placePassenger = (actor: SettlementActor, job: LighterJob, index: number, elapsed: number,
    unloading: boolean) => {
    const at = passengerPlaceAt(job.plan, index, elapsed, unloading);
    if (at.stage === "aboard") {
      if (actor.phase !== "navalAboard") Object.assign(actor, { action: "idle", phase: "navalAboard", visible: true });
      return;
    }
    const ashore = at.stage === "walk" || at.stage === "landing";
    Object.assign(actor, { action: at.stage === "walk" ? "walk" : "idle", phase: "navalFerry", visible: ashore });
    if (!ashore) return;
    const route = job.boats[at.lighter]!.route, length = routeLength(route);
    const point = pointAlong(route, at.share * length), { world } = context.options;
    Object.assign(actor, { locomotionSpeed: job.plan.walk ? length / job.plan.walk : 0, x: point.x,
      y: sampleSmooth(world, world.heights, point.x, point.z), yaw: unloading ? point.yaw + Math.PI : point.yaw,
      z: point.z });
  };
  /** Every tick: the ferried passengers of each ship worked by lighters, placed from the job's plan. */
  const update = () => {
    for (const ship of ships) {
      const job = ship.lighters, working = ship.phase === "loading" || ship.phase === "unloading";
      if (!job?.plan.passengers || !working) continue;
      const elapsed = job.plan.seconds - ship.timer, unloading = ship.phase === "unloading";
      (ship.passengers ?? []).forEach((uid, index) => {
        const actor = actorOf(uid);
        if (actor) placePassenger(actor, job, index, elapsed, unloading);
      });
    }
  };
  /** A ferry load stops (its order cancelled): passengers not yet aboard go back into the harbour. */
  const abandon = (ship: NavalShip) => {
    const job = ship.lighters, source = ship.sourceUid === undefined ? undefined : berthing.harbor(ship.sourceUid);
    if (!job?.plan.passengers || ship.phase !== "loading" || !source) return;
    const ashore = (ship.passengers ?? []).filter(uid => actorOf(uid)?.phase !== "navalAboard");
    hooks?.release(ashore, source.uid);
    ship.passengers = (ship.passengers ?? []).filter(uid => !ashore.includes(uid));
    ship.cargoCount -= ashore.length;
  };
  return { abandon, spot, start, update };
};
