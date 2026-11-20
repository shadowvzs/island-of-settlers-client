import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING } from "../world/world-data";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import { groundPath } from "./settlement-paths";
import type { CoastalWorkSite } from "./settlement-sea-navigation";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export interface ShipWorkpoint { shore: SettlementPoint; point: SettlementPoint; contact: SettlementPoint; shoreY: number; y: number }
export const SHIP_WORKPOINT_HULL_OFFSET = .42;
/** How far from the berth's centre the shore search looks for a pier foot reaching `reach` tiles. */
export const shipWorkpointShoreSearchReach = (reach: number) => reach + 1.1 * SAILING_SHIP_SCALE;
const SHORE_REFINEMENT_OFFSETS = [-.25, 0, .25].flatMap(x => [-.25, 0, .25].map(z => [x, z] as const));

/** Share of the hull length (stern 0 to bow 1) whose sides a workpoint may meet. */
export type HullSpan = readonly [number, number];
const WHOLE_HULL_SPAN: HullSpan = [.12, .88];
/** The heading a workpoint's hull lies on: the site's, else broadside to the shore. */
export const workpointYaw = (site: CoastalWorkSite) =>
  site.yaw ?? DMath.atan2(site.water.x - site.land.x, site.water.z - site.land.z) + Math.PI / 2;

/** Search actual oriented hull sides, then choose the nearest shore with a real land route. */
/** `pierHeight` changes only the destination surface; slope and terrain checks use that surface. */
export const findShipWorkpoint = (
  context: SettlementContext, building: Pick<SettlementBuilding, "access"> & { uid?: number }, site: CoastalWorkSite,
  reach = 12, shoreReach = 36, maximumRampLength = Infinity,
  pierHeight = context.options.world.seaLevel + .18, refineShore = false, hullSpan: HullSpan = WHOLE_HULL_SPAN
): ShipWorkpoint | null => {
  const { world } = context.options, yaw = workpointYaw(site);
  const transform = (x: number, z: number) => ({ x: site.water.x + DMath.cos(yaw) * x + DMath.sin(yaw) * z,
    z: site.water.z - DMath.sin(yaw) * x + DMath.cos(yaw) * z });
  const sides = Array.from({ length: 15 }, (_, index) => {
    const t = hullSpan[0] + index / 14 * (hullSpan[1] - hullSpan[0]), z = (t - .5) * 2.2 * SAILING_SHIP_SCALE;
    const beam = DMath.sin(t * Math.PI) ** .7 * .42 * SAILING_SHIP_SCALE;
    return [-1, 1].map(side => ({ contact: transform(side * beam, z),
      point: transform(side * (beam + SHIP_WORKPOINT_HULL_OFFSET), z) }));
  }).flat();
  const candidates: Array<ShipWorkpoint & { distance: number }> = [];
  const shoreOffsets = refineShore ? SHORE_REFINEMENT_OFFSETS : [[0, 0] as const];
  const shoreSearchReach = shipWorkpointShoreSearchReach(reach);
  for (let z = Math.max(0, Math.floor(site.water.z - shoreSearchReach));
    z < Math.min(world.cellsZ, site.water.z + shoreSearchReach); z++)
    for (let x = Math.max(0, Math.floor(site.water.x - shoreSearchReach));
      x < Math.min(world.cellsX, site.water.x + shoreSearchReach); x++) {
      const cell = z * world.cellsX + x;
      if (!world.walkCost[cell] || world.blocking[cell] || context.occupied[cell]) continue;
      for (const [dx, dz] of shoreOffsets) {
        const shore = { x: x + .5 + dx, z: z + .5 + dz };
        if (DMath.hypot(shore.x - building.access.x, shore.z - building.access.z) > shoreReach) continue;
        const shoreY = sampleSmooth(world, world.heights, shore.x, shore.z);
        if (shoreY < world.seaLevel - .05 || Math.abs(shoreY - pierHeight) > maximumRampLength * .5)
          continue;
        for (const side of sides) {
          const distance = DMath.hypot(side.contact.x - shore.x, side.contact.z - shore.z);
          if (distance > reach) continue;
          // Reject impossible ramps before allocating and sorting the dense shore/hull combinations.
          const length = DMath.hypot(side.point.x - shore.x, side.point.z - shore.z);
          if (length > maximumRampLength || Math.abs(shoreY - pierHeight) > length * .5) continue;
          candidates.push({ ...side, shore, shoreY, y: pierHeight, distance });
        }
      }
    }
  candidates.sort((a, b) => a.distance - b.distance || DMath.hypot(a.shore.x - building.access.x, a.shore.z - building.access.z) -
    DMath.hypot(b.shore.x - building.access.x, b.shore.z - building.access.z));
  const shoreRoutes = new Map<string, boolean>();
  for (const candidate of candidates) {
    const length = DMath.hypot(candidate.point.x - candidate.shore.x, candidate.point.z - candidate.shore.z);
    if (length > maximumRampLength) continue;
    // A walking ramp must stay below a 1:2 grade, including very short shoreline gaps.
    if (Math.abs(candidate.shoreY - candidate.y) > length * .5) continue;
    let clear = true;
    for (let distance = .2; distance <= length; distance += .2) {
      const x = candidate.shore.x + (candidate.point.x - candidate.shore.x) * distance / length,
        z = candidate.shore.z + (candidate.point.z - candidate.shore.z) * distance / length;
      const cell = Math.floor(z) * world.cellsX + Math.floor(x), height = sampleSmooth(world, world.heights, x, z);
      const obstacle = world.blocking[cell] && world.blocking[cell] !== BLOCKING.water;
      if (context.occupied[cell] || height > candidate.shoreY * (1 - distance / length) + candidate.y * distance / length + .015 ||
        (height > world.seaLevel && obstacle)) { clear = false; break; }
    }
    if (!clear) continue;
    const key = `${candidate.shore.x},${candidate.shore.z}`;
    if (!shoreRoutes.has(key)) shoreRoutes.set(key, !!groundPath(context, building.access, candidate.shore, building.uid));
    if (shoreRoutes.get(key)) return candidate;
  }
  return null;
};

/** Walking speed on a ship's deck and its gangway (tiles per second). */
const DECK_WALK_SPEED = .9;

/**
 * Only this reserved visible ramp permits a worker above water; ordinary navigation stays dry.
 * `speed`: tiles per second (a rider riding down is faster than walking).
 */
export const advanceShipPier = (context: SettlementContext, actor: SettlementActor, work: ShipWorkpoint,
  returning: boolean, dt: number, speed = DECK_WALK_SPEED) => {
  const target = returning ? work.shore : work.point, dx = target.x - actor.x, dz = target.z - actor.z,
    distance = DMath.hypot(dx, dz), step = Math.min(distance, dt * speed);
  const x = actor.x + dx / (distance || 1) * step, z = actor.z + dz / (distance || 1) * step;
  if (context.actors.some(other => {
    if (other === actor || !other.visible) return false;
    const separation = DMath.hypot(other.x - x, other.z - z);
    if (separation >= .28) return false;
    // A compressed boarding file must be able to open up: the leader moves away,
    // while the follower still yields. Never relax collisions for opposing traffic.
    const sameFile = actor.navalOrder !== undefined && actor.navalOrder === other.navalOrder &&
      actor.phase === other.phase && ["navalBoarding", "navalDisembark"].includes(actor.phase);
    return !sameFile || separation <= DMath.hypot(other.x - actor.x, other.z - actor.z) + 1e-6;
  })) {
    actor.action = "idle"; recordMovementOutcome(actor, "person-blocked"); return false;
  }
  recordMovementOutcome(actor, step > 0 ? "moving" : "arrived");
  actor.x = x; actor.z = z; actor.visible = true; actor.action = actor.ware ? "carry" : "walk";
  actor.locomotionSpeed = speed; actor.yaw = DMath.atan2(dx, dz);
  const length = DMath.hypot(work.point.x - work.shore.x, work.point.z - work.shore.z);
  const fraction = length ? Math.max(0, Math.min(1, DMath.hypot(x - work.shore.x, z - work.shore.z) / length)) : 1;
  actor.y = work.shoreY * (1 - fraction) + work.y * fraction;
  return distance <= step + .00001;
};

/** One tick along the actor's deck path at deck height `y` and `speed`; true once its end is reached. */
export const walkShipDeck = (actor: SettlementActor, y: number, dt: number, speed = DECK_WALK_SPEED) => {
  const point = actor.path[actor.pathIndex];
  if (!point) return true;
  const dx = point.x - actor.x, dz = point.z - actor.z, distance = DMath.hypot(dx, dz);
  const step = Math.min(distance, dt * speed);
  actor.x += dx / (distance || 1) * step; actor.z += dz / (distance || 1) * step;
  actor.y = y; actor.yaw = DMath.atan2(dx, dz); actor.action = "walk";
  actor.locomotionSpeed = speed;
  if (distance <= step + 1e-6) actor.pathIndex++;
  return actor.pathIndex >= actor.path.length;
};
