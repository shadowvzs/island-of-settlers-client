import { DMath } from "../math/deterministic-math";
import { countNavigation } from "./navigation-profile";
import { withBuildingNavigationSearch } from "./settlement-building-navigation";
import { isOwnStockCourtyard, ownDoorLaneProbe } from "./settlement-entrance";
import { distanceToSegmentXZ } from "./settlement-geometry";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { forEachNearbyTrafficCell, isTrafficCellInRange } from "./settlement-person-index";
import { actorSeparation, isTrafficPassThrough } from "./settlement-traffic";
import { trafficWork } from "./settlement-traffic-counters";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * A10b: the people one segment check must keep clear of, read once. Positions, phases and rider
 * headings stay fixed during a check (and during one shoulder choice), so every value is the one the
 * per-sample loop used to read live.
 */
export interface TrafficBody {
  cellX: number | undefined;
  cellZ: number | undefined;
  separation: number;
  separatingSquared: number;
  separationSquared: number;
  x: number;
  z: number;
}

/**
 * Spacing of the samples a segment check tests. SIM-CADENCE (owner 2026-11-10): 0.02 tile, four
 * times the former 0.005. Between two samples a body's clearance can be underestimated by at most
 * sep − √(sep² − 0.01²), about 0.0003 tile at foot clearance; the per-step contact test still guards
 * every move. The ground test stays 2.5 times finer than the planner's 0.05 tile terrain step.
 */
const TRAFFIC_SAMPLE_STEP = 0.02;
/** Rounding room of the wide people read: far above float error, far below a cell. */
const WIDE_READ_MARGIN = .01;
/** Query radius around the segment's midpoint: half its length plus the largest body clearance. */
const peopleRadius = (actor: SettlementActor, distance: number) => distance / 2 + (actor.mounted ? 2.1 : 1.25);

/** Every person a query around `point` with `radius` returns, as a body `actor` must keep clear of. */
export const collectTrafficBodies = (context: SettlementContext, actor: SettlementActor,
  point: SettlementPoint, radius: number) => {
  const bodies: TrafficBody[] = [];
  forEachNearbyTrafficCell(context, point, radius, (other, cellX, cellZ) => {
    if (other === actor || !other.visible || isTrafficPassThrough(context, actor, other)) return;
    const separation = actorSeparation(actor, other);
    const start = DMath.hypot(actor.x - other.x, actor.z - other.z);
    bodies.push({ cellX, cellZ, separation, separationSquared: separation * separation,
      separatingSquared: start < separation ? (start + 1e-8) * (start + 1e-8) : Infinity, x: other.x, z: other.z });
  });
  return bodies;
};

/**
 * A body farther than this beyond its clearance from the whole segment cannot be within clearance of
 * any sample on it: far above the rounding of a sample point, far below any body clearance.
 */
const SEGMENT_REACH_MARGIN = 1e-6;
/** The bodies the per-sample test must visit: the segment's own query cells, then the reach bound. */
const bodiesNearSegment = (bodies: readonly TrafficBody[], actor: SettlementActor, destination: SettlementPoint,
  distance: number) => {
  const centre = { x: (actor.x + destination.x) / 2, z: (actor.z + destination.z) / 2 };
  const radius = peopleRadius(actor, distance);
  return bodies.filter(body => isTrafficCellInRange(body.cellX, body.cellZ, centre, radius) &&
    distanceToSegmentXZ(body.x, body.z, actor.x, actor.z, destination.x, destination.z) <
      body.separation + SEGMENT_REACH_MARGIN);
};

/** The people half of the sample loop, at the same sample points with the same arithmetic. */
const arePeopleClear = (actor: SettlementActor, destination: SettlementPoint, steps: number,
  bodies: readonly TrafficBody[]) => {
  if (!bodies.length) return true;
  for (let index = 1; index <= steps; index++) {
    const fraction = index / steps;
    const x = actor.x + (destination.x - actor.x) * fraction, z = actor.z + (destination.z - actor.z) * fraction;
    for (const { separatingSquared, separationSquared, x: otherX, z: otherZ } of bodies) {
      const dx = x - otherX, dz = z - otherZ;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < separationSquared && distanceSquared <= separatingSquared) return false;
    }
  }
  return true;
};

/** The ground half of the sample loop (mounted ground, then navigation with the actor's own lanes). */
const isGroundClearAlong = (context: SettlementContext, actor: SettlementActor, destination: SettlementPoint,
  steps: number) => {
  const isOwnLane = ownDoorLaneProbe(context, actor);
  for (let index = 1; index <= steps; index++) {
    const fraction = index / steps;
    trafficWork.segmentSamples++;
    const point = { x: actor.x + (destination.x - actor.x) * fraction,
      z: actor.z + (destination.z - actor.z) * fraction };
    if (actor.mounted && !isMountedNavigationClear(context, point)) return false;
    if (!isNavigationClear(context, point, isOwnLane(point) || isOwnStockCourtyard(context, actor, point)))
      return false;
  }
  return true;
};

/**
 * Whether `actor` may walk straight to `destination`. Every sample must pass both the ground and the
 * people test and every test is pure, so testing all people first (cheap, and where a crowd fails)
 * gives the same answer as the interleaved loop. `bodies`: a superset collected around a wider point
 * (one shoulder choice); each body still passes this segment's own query-cell test.
 * `trafficWork.segmentSamples` now counts ground samples only.
 */
export const isTrafficSegmentClearWith = (context: SettlementContext, actor: SettlementActor,
  destination: SettlementPoint, checkPeople: boolean, bodies?: readonly TrafficBody[]) =>
  withBuildingNavigationSearch(context, () => isSegmentClearInSearch(context, actor, destination, checkPeople, bodies));
/**
 * Inside a building navigation search scope (one snapshot of stock geometry: nothing changes during
 * the check), so the many samples reuse prepared building volumes; same values as live reads.
 */
export const isSegmentClearInSearch = (context: SettlementContext, actor: SettlementActor,
  destination: SettlementPoint, checkPeople: boolean, bodies?: readonly TrafficBody[]) => {
  countNavigation("traffic.segmentQueries");
  const distance = DMath.hypot(destination.x - actor.x, destination.z - actor.z);
  const steps = Math.max(1, Math.ceil(distance / TRAFFIC_SAMPLE_STEP));
  trafficWork.segmentCalls++;
  if (checkPeople) {
    const near = bodies ?? collectTrafficBodies(context, actor,
      { x: (actor.x + destination.x) / 2, z: (actor.z + destination.z) / 2 }, peopleRadius(actor, distance));
    if (!arePeopleClear(actor, destination, steps, bodiesNearSegment(near, actor, destination, distance)))
      return false;
  }
  return isGroundClearAlong(context, actor, destination, steps);
};

/** A radius around `actor` whose query cells contain those of every segment up to `reach` long. */
export const trafficBodyReach = (actor: SettlementActor, reach: number) => reach + peopleRadius(actor, 0) +
  WIDE_READ_MARGIN;
