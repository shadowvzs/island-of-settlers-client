import type { ShuttleBoatFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import type { BoatJetty } from "./harbour-boat-jetty";
import { pointAlongBoatRoute } from "./harbour-boat-route";
import { shuttleGangwayContact, shuttleHandling, shuttleRouteLength } from "./harbour-shuttle-handling";
import type { Goods, SettlementPoint } from "./settlement-types";
import { cargoBoxes, wareBoxUnits } from "./ship-cargo-boxes";
import { cargoPresentation } from "./ship-cargo-presentation";
import { SMALL_BOAT_JOB_VERSION, SMALL_BOAT_ROWERS } from "./small-boat-crew";

/** Initial shuttle limits (plan: no more than four boxes and eight ware units, whichever is first). */
export const SHUTTLE_MAX_UNITS = 8;
export const SHUTTLE_MAX_BOXES = 4;
/** One real paddler handles and rows this civilian workboat. */
export const SHUTTLE_ROWERS = SMALL_BOAT_ROWERS;
/** Existing lighter rowing speed; a laden shuttle is not faster than a barge. */
export const SHUTTLE_ROW_SPEED = 1.2;
/** Mooring and handling time at either end, besides the porters' real walk. */
const SHUTTLE_MOOR_SECONDS = 2;
/** Wares the civilian boat service never carries: no boat-on-boat and no military shortcut. */
const EXCLUDED = new Set(["boat"]);
/** Seconds a destination may be full before the boat turns back with its cargo. */
export const SHUTTLE_FULL_RETURN_SECONDS = 30;
/** Route and channel checks run at this cadence while a boat is under way. */
export const SHUTTLE_ROUTE_CHECK_SECONDS = 2;

export interface ShuttlePlan {
  /** Porters bring the boxes to the boat. */
  loading: number;
  /** The real water route. */
  outbound: number;
  /** Porters take the boxes into the destination harbour. */
  unloading: number;
  /** The boat rows home empty (or with returned cargo). */
  returning: number;
  boxes: number;
}
export type ShuttlePhase = "loading" | "outbound" | "unloading" | "returning" | "blocked";
export type ShuttleInterruption = "cancelled" | "destination-full" | "destination-lost" | "route-blocked" |
  "source-full" | "source-lost";
/** A saved one-way boat job: one boat, one paddler and exactly one cargo owner. */
export interface ShuttleJob {
  version: typeof SMALL_BOAT_JOB_VERSION;
  id: number;
  sourceUid: number;
  /** Original boat and paddler owner, preserved across onward cargo legs. */
  homeUid?: number;
  /** Stable cargo receipt identity is (id, legIndex); the boat itself keeps id across a chain. */
  legIndex?: number;
  homeLost?: boolean;
  /** Empty physical leg back to the original owner after a chain. */
  returningHome?: boolean;
  destinationUid: number;
  /** Goods the job owns from loading until the destination (or a safe return) takes them. */
  cargo: Goods;
  crew: number;
  phase: ShuttlePhase;
  timer: number;
  plan: ShuttlePlan;
  /** Water route from the source landing to the destination landing. */
  route: SettlementPoint[];
  sourceLanding: SettlementPoint;
  destinationLanding: SettlementPoint;
  sourceRoute: SettlementPoint[];
  destinationRoute: SettlementPoint[];
  /** Paused leg, so a blocked route resumes at the real position instead of teleporting. */
  resume?: { phase: "outbound" | "returning"; share: number; timer: number };
  hold?: SettlementPoint;
  blockedFor?: number;
  interrupted?: ShuttleInterruption;
  /** Transient: waiting before a ship channel; never a saved claim. */
  yielding?: boolean;
  /** Explicit transfer demand this job consumed, restored once if the cargo comes back. */
  demand?: { automatic: boolean; count: number; destination: number; restored?: boolean; ware: string };
  /** The endpoint building was demolished; the saved job keeps its people/cargo until recovery. */
  destinationLost?: boolean;
  sourceLost?: boolean;
  /** Transient: the job finished this tick and is about to leave the list; never saved. */
  done?: boolean;
}
export interface ShuttleState { jobs: ShuttleJob[]; nextJob: number }
/** Why a harbour's boat shuttle can or cannot start a job now. */
export type ShuttleReason = "active" | "cargo-blocked" | "destination-full" | "idle" | "no-crew" | "no-landing" |
  "no-partner" | "no-route" | "route-blocked" | "waiting-boat";
export interface ShuttleStatus {
  uid: number;
  reason: ShuttleReason;
  destinationUid?: number;
  cargo?: Goods;
  phase?: ShuttlePhase;
  secondsLeft?: number;
  storedBoats: number;
  freeBoats: number;
  idleRowers: number;
}

export const emptyShuttleState = (): ShuttleState => ({ jobs: [], nextJob: 1 });
/** A ware's useful boat load: four visible boxes, capped at eight units (partial boxes allowed). */
export const shuttleCapacityFor = (ware: string) => EXCLUDED.has(ware) ? 0 :
  Math.max(0, Math.min(SHUTTLE_MAX_UNITS, SHUTTLE_MAX_BOXES * wareBoxUnits(ware)));
export const shuttleBoxes = (cargo: Readonly<Goods>) => Math.max(0, cargoBoxes(cargo));
export const shuttleUnits = (cargo: Readonly<Goods>) =>
  Object.values(cargo).reduce((sum, count) => sum + count, 0);

/** The job timetable from validated porter-route lengths and the real water route. */
export const planShuttle = (cargo: Readonly<Goods>, source: Pick<BoatJetty, "route">, destination: Pick<BoatJetty, "route">,
  distance: number): ShuttlePlan => {
  const boxes = Math.max(1, shuttleBoxes(cargo));
  const loading = shuttleHandling(boxes, shuttleRouteLength(source.route), false, 0).seconds + SHUTTLE_MOOR_SECONDS;
  const unloading = shuttleHandling(boxes, shuttleRouteLength(destination.route), true, 0).seconds + SHUTTLE_MOOR_SECONDS;
  const row = distance / SHUTTLE_ROW_SPEED;
  return { boxes, loading, outbound: row, returning: row, unloading };
};
const shoreYaw = (landing: SettlementPoint, route: readonly SettlementPoint[]) => {
  const point = route.at(-2) ?? landing, foot = route.at(-3) ?? route[0] ?? landing;
  return DMath.atan2(point.x - foot.x, point.z - foot.z);
};
const loadingGangway = (landing: SettlementPoint, route: readonly SettlementPoint[], y: number) => {
  const point = route.at(-2);
  if (!point) return undefined;
  const distance = DMath.hypot(landing.x - point.x, landing.z - point.z);
  if (!distance) return undefined;
  const contact = shuttleGangwayContact(landing, point);
  return { from: { x: point.x, y: y + .18, z: point.z },
    to: { x: contact.x, y: y + .24, z: contact.z } };
};
/** A boat's position and visible cargo at a phase and remaining seconds. */
export const shuttleBoatFrame = (job: ShuttleJob, frameId: number, y: number): ShuttleBoatFrame => {
  const handling = job.phase === "loading" || job.phase === "unloading";
  const unloading = job.phase === "unloading", route = unloading ? job.destinationRoute : job.sourceRoute;
  const count = shuttleBoxes(job.cargo), duration = unloading ? job.plan.unloading : job.plan.loading;
  const actual = shuttleHandling(count, shuttleRouteLength(route), unloading, 0, job.crew);
  // The persisted remaining clock maps onto physical handling without changing its completion time.
  const elapsed = Math.max(0, (duration - job.timer) * actual.seconds / Math.max(.001, duration - SHUTTLE_MOOR_SECONDS));
  const work = handling ? { boxes: count, crew: job.crew, elapsed, route, unloading } : undefined;
  const boxes = handling ? shuttleHandling(count, shuttleRouteLength(route), unloading, elapsed, job.crew).boxes : count;
  const laden = shuttleUnits(job.cargo) > 0;
  const cargoManifest = cargoPresentation(job.cargo, count);
  if (job.phase === "loading") return { boxes, cargoManifest, id: frameId, laden, porterWork: work, rowing: false, x: job.sourceLanding.x, y,
    gangway: loadingGangway(job.sourceLanding, job.sourceRoute, y),
    yaw: shoreYaw(job.sourceLanding, job.sourceRoute), z: job.sourceLanding.z };
  if (job.phase === "unloading") return { boxes, cargoManifest, id: frameId, laden, porterWork: work, rowing: false, x: job.destinationLanding.x, y,
    gangway: loadingGangway(job.destinationLanding, job.destinationRoute, y),
    yaw: shoreYaw(job.destinationLanding, job.destinationRoute), z: job.destinationLanding.z };
  if (job.phase === "blocked" && !job.resume) return { boxes, cargoManifest, id: frameId, laden, rowing: false,
    x: job.hold?.x ?? job.sourceLanding.x, y, yaw: 0, z: job.hold?.z ?? job.sourceLanding.z };
  const resuming = job.resume, phase = job.phase === "blocked" ? resuming?.phase ?? "outbound" : job.phase;
  const returning = phase === "returning", waterRoute = returning ? [...job.route].reverse() : job.route;
  const total = returning ? job.plan.returning : job.plan.outbound;
  const timer = job.phase === "blocked" ? resuming?.timer ?? total : job.timer;
  const share = Math.max(0, Math.min(1, total ? 1 - timer / total : 0));
  const point = pointAlongBoatRoute(waterRoute, share * total * SHUTTLE_ROW_SPEED);
  return { boxes, cargoManifest, id: frameId, laden, rowing: job.phase !== "blocked" && !job.yielding,
    x: point.x, y, yaw: point.yaw, z: point.z };
};
