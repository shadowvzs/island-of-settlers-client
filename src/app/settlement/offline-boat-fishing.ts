import { PRODUCTION_OUTPUT_CAPACITY, WORKER_WALK_SPEED } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import {
  FISHER_BOAT_BEACH_SECONDS, FISHER_BOAT_CATCH, FISHER_BOAT_LAUNCH_SECONDS, FISHER_BOAT_NET_SECONDS,
  FISHER_BOAT_ROW_SPEED
} from "../../shared/settlement/constants";
import { fisherBoatRoute, fisherBoatRouteLength } from "../../shared/settlement/fisher-boat-route";
import { isBoatFishing } from "../../shared/settlement/settlement-fisher-boat-mode";
import { groundPath } from "../../shared/settlement/settlement-paths";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "../../shared/settlement/settlement-types";

/**
 * FISHER-POLISH fast offline credit of a boat-mode Fishery (owner 2026-11-11): one job cycle is one full
 * trip that lands FISHER_BOAT_CATCH fish in one basket. Deterministic: saved site, cached rowing routes.
 */
export interface OfflineBoatFishingTrip {
  /** Launch, net and beach seconds before the worker rate (the in-place phases). */
  inPlaceSeconds: number;
  /** Door to launch slot and back, plus the mean rowing round trip over the site's nets. */
  travelSeconds: number;
}

/** The yard holds 9 after a catch: a trip only starts below six, so 5 + 4 is the largest shelf. */
export const BOAT_FISHERY_SHELF = PRODUCTION_OUTPUT_CAPACITY + FISHER_BOAT_CATCH - 1;

const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(to.x - from.x, to.z - from.z);

const pathLength = (from: SettlementPoint, path: readonly SettlementPoint[]) => {
  let length = 0, previous = from;
  for (const point of path) { length += distance(previous, point); previous = point; }
  return length;
};

/** The full trip of the saved site and slot; undefined when the site, walk or a rowing route is gone. */
export const offlineBoatFishingTrip = (
  navigation: SettlementContext, building: SettlementBuilding
): OfflineBoatFishingTrip | undefined => {
  const site = building.boatSite;
  if (!site?.ok || !site.nets.length) return undefined;
  const slot = site.slots[Math.min(building.fisherBoat?.slot ?? 0, site.slots.length - 1)];
  if (!slot) return undefined;
  const walk = groundPath(navigation, building.workerApproach, slot);
  if (!walk) return undefined;
  let rowing = 0;
  for (const net of site.nets) {
    const route = fisherBoatRoute(navigation.options.world, slot.launch, net);
    if (!route) return undefined;
    rowing += fisherBoatRouteLength(route);
  }
  const walking = distance(building.doorThreshold, building.workerApproach) + pathLength(building.workerApproach, walk);
  return {
    inPlaceSeconds: FISHER_BOAT_LAUNCH_SECONDS + FISHER_BOAT_NET_SECONDS + FISHER_BOAT_BEACH_SECONDS,
    travelSeconds: 2 * walking / WORKER_WALK_SPEED + 2 * rowing / site.nets.length / FISHER_BOAT_ROW_SPEED
  };
};

/** Fish a saved trip in progress will still land when play resumes; their shelf space stays held. */
const pendingCatch = (worker: SettlementActor | undefined) => {
  if (!worker) return 0;
  if (worker.boatTrip) return FISHER_BOAT_CATCH;
  return worker.ware === "fish" ? worker.wareUnits ?? 1 : 0;
};

/**
 * Producer-yard space of a boat Fishery for the event model. A cycle needs room for the whole catch, so
 * `stock + FISHER_BOAT_CATCH <= capacity` is exactly the live "start below six" rule with the 9 cap.
 */
export const offlineBoatFisheryShelf = (
  building: SettlementBuilding, worker: SettlementActor | undefined, held: number
) => isBoatFishing(building) ? BOAT_FISHERY_SHELF - held - pendingCatch(worker) : undefined;

/** Production cycles one completed job cycle stands for: every fish of a boat catch counts (live parity). */
export const offlineCyclesPerJobCycle = (building: SettlementBuilding) =>
  isBoatFishing(building) ? FISHER_BOAT_CATCH : 1;
