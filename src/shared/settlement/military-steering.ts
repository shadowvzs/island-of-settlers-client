import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { entersClosedDeck } from "./bridge-deck-navigation";
import { type AvoidanceAgent, type AvoidanceNeighbour,createVelocityRanker } from "./military-avoidance";
import { createMilitaryDetours, type MilitaryDetourSave } from "./military-detour";
import type { SavedEntries } from "./military-field-save";
import type { MilitarySpatialGrid } from "./military-spatial-grid";
import { isOwnDoorLane } from "./settlement-entrance";
import { turnYawToward } from "./settlement-geometry";
import { isMountedNavigationClear, isNavigationClear, isNavigationEscapeClear } from "./settlement-navigation";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import { forEachNearbyTrafficActor, updatePersonTraffic } from "./settlement-person-index";
import { actorSeparation, isSeparatingTrafficStep,isTrafficPassThrough } from "./settlement-traffic";
import { clearTrafficBlocker } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Steering of soldiers in the open field (docs/archive/dated/military-motion-2026-10-13.md). Replaces the worker
 * walk (`moveActor`: stop on contact, wait, then sidestep) for field soldiers: each tick a soldier
 * follows its path with a preferred velocity, lets `military-avoidance.ts` bend it round neighbours
 * predicted over the next 1.2 s, and keeps the hard rules of the worker walk: never step into a body
 * (except to get out of one) and never onto blocked ground. Riders are heavy: they
 * turn slowly at speed. Door lanes, sieges at the door and soldiers leaving buildings keep `moveActor`.
 * Velocities (with their age in ticks) and the detour holds are saved: a loaded battle walks on unchanged.
 */
interface Motion { x: number; z: number; tick: number }
/** `age`: ticks since the velocity was set (the tick counter itself is not saved). */
interface SavedMotion { age: number; x: number; z: number }
export interface MilitarySteeringSave { detours: MilitaryDetourSave; motions: SavedEntries<SavedMotion> }

/** Neighbours considered per soldier (the nearest). */
const MAX_NEIGHBOURS = 10;
/** Seconds ahead a soldier predicts collisions (foot, rider: fast and slow to turn, it looks further). */
const FOOT_HORIZON = 1.2;
const RIDER_HORIZON = 1.8;
/** Neighbours are looked for within the closing distance of the horizon, within these bounds (tiles). */
const QUERY_MINIMUM = 2.5;
const QUERY_MAXIMUM = 8;
/** Extra room kept while passing (foot, rider). */
const FOOT_COMFORT = .14;
const RIDER_COMFORT = .3;
/** Rider turning (rad/s at full speed; tighter turns when slower): a horse at a gallop sweeps round. */
const RIDER_TURN = 3;
const SLOW_TURN_SHARE = .3;
/** Body turning towards the walking direction (rad/s). */
const FOOT_FACING = 8;
const RIDER_FACING = 4;
/** An intermediate waypoint counts as reached this close (foot, rider). */
const FOOT_WAYPOINT = .4;
const RIDER_WAYPOINT = .9;
/** A passed waypoint (the soldier already stands beyond it on the next leg) is skipped this close. */
const PASSED_WAYPOINT = 2;
/** A waypoint a standing body covers is passed over while the next one is this close (tiles). */
const OCCUPIED_SKIP = 3;
/** A final place a standing body covers is reached this close (tiles). */
const OCCUPIED_ARRIVAL = 1;
/** Seconds to slow down into the final place. */
const ARRIVAL_SECONDS = .3;
/** Ground ahead checked for a candidate velocity (seconds of walking). */
const STATIC_LOOKAHEAD = .45;
/** A soldier a little faster than this is walking (its velocity is used for predictions). */
const MOVING = .05;

/** Held this long (seconds), a soldier asks idle comrades standing right in its way to step aside. */
const MAKE_WAY_AFTER = .6;
/** Comrades this close ahead (beyond the bodies' separation, tiles) are asked; they step this far aside. */
const MAKE_WAY_REACH = .35;
const MAKE_WAY_STEP = .7;
/** Standing still costs this much more per second already waited (a jam breaks up), up to the cap. */
const IMPATIENCE = 1.5;
const MAXIMUM_WAIT_COST = 12;
const WAIT = "wait" as const;
interface Step { point: SettlementPoint; vx: number; vz: number }

const blankNeighbour = (): AvoidanceNeighbour =>
  ({ comfort: 0, reciprocal: false, separation: 0, vx: 0, vz: 0, x: 0, z: 0 });

export interface MilitarySteeringOptions {
  /** Field soldiers and door duellists of every side, sorted this tick. */
  grid: MilitarySpatialGrid<SettlementActor>;
  /** A soldier's walking pace (tiles per second). */
  paceOf: (actor: SettlementActor) => number;
  /** The foe a soldier closes in on: it is not avoided (its place beside the foe is the goal). */
  foeOf: (actor: SettlementActor) => number | undefined;
  /** Whether `other` (standing in the way) may be asked to step aside for `actor` (an idle comrade). */
  canMakeWay: (other: SettlementActor, actor: SettlementActor) => boolean;
}

export const createMilitarySteering = (context: SettlementContext,
  { canMakeWay, foeOf, grid, paceOf }: MilitarySteeringOptions) => {
  const motions = new Map<number, Motion>();
  const ranker = createVelocityRanker();
  const neighbours = Array.from({ length: MAX_NEIGHBOURS }, blankNeighbour);
  const distances = new Float64Array(MAX_NEIGHBOURS);
  const agent: AvoidanceAgent = {
    horizon: FOOT_HORIZON, maxSpeed: 0, preferredX: 0, preferredZ: 0, vx: 0, vz: 0, waitCost: 0, x: 0, z: 0
  };
  let tick = 0, count = 0, self: SettlementActor | undefined, foe: number | undefined, refusedByBody = false;

  /** Last velocity of a soldier that walked this tick or the previous one (else at rest). */
  const velocityOf = (uid: number) => {
    const motion = motions.get(uid);
    return motion && motion.tick >= tick - 1 ? motion : undefined;
  };
  const isStanding = (body: SettlementActor) => {
    const motion = velocityOf(body.uid);
    return !motion || DMath.hypot(motion.x, motion.z) <= MOVING;
  };
  const detours = createMilitaryDetours(context, grid, isStanding);
  const setVelocity = (uid: number, x: number, z: number) => {
    const motion = motions.get(uid);
    if (motion) { motion.x = x; motion.z = z; motion.tick = tick; return; }
    motions.set(uid, { tick, x, z });
  };
  /** Keeps the nearest `MAX_NEIGHBOURS` (insertion into a short sorted list). */
  const collect = (other: SettlementActor) => {
    // The foe it closes in on is not avoided: it charges home (the step check still keeps the bodies apart).
    if (!self || other === self || other.uid === foe || isTrafficPassThrough(context, self, other)) return;
    const distance = DMath.hypot(other.x - self.x, other.z - self.z);
    if (count === MAX_NEIGHBOURS && distance >= distances[count - 1]!) return;
    let at = Math.min(count, MAX_NEIGHBOURS - 1);
    while (at > 0 && distances[at - 1]! > distance) {
      distances[at] = distances[at - 1]!;
      Object.assign(neighbours[at]!, neighbours[at - 1]!);
      at--;
    }
    distances[at] = distance;
    describe(neighbours[at]!, other);
    count = Math.min(MAX_NEIGHBOURS, count + 1);
  };
  const describe = (neighbour: AvoidanceNeighbour, other: SettlementActor) => {
    const motion = velocityOf(other.uid);
    const moving = motion !== undefined && DMath.hypot(motion.x, motion.z) > MOVING;
    neighbour.x = other.x; neighbour.z = other.z;
    neighbour.vx = moving ? motion.x : 0; neighbour.vz = moving ? motion.z : 0;
    neighbour.reciprocal = moving;
    neighbour.separation = actorSeparation(self!, other);
    neighbour.comfort = self!.mounted || other.mounted ? RIDER_COMFORT : FOOT_COMFORT;
  };
  const isBody = (other: SettlementActor) => other.visible;
  const gatherNeighbours = (actor: SettlementActor, speed: number) => {
    self = actor; count = 0; foe = foeOf(actor);
    const radius = Math.min(QUERY_MAXIMUM, Math.max(QUERY_MINIMUM, speed * 2 * agent.horizon));
    grid.forEachWithin(actor.x, actor.z, radius, isBody, collect);
    self = undefined;
  };

  /** Ground the soldier may stand on (its own door lane included; riders need a horse's room). */
  const isGroundClear = (actor: SettlementActor, point: SettlementPoint) => {
    if (actor.mounted) return isMountedNavigationClear(context, point);
    const lane = isOwnDoorLane(context, actor, point);
    return isNavigationClear(context, point, lane) || isNavigationEscapeClear(context, actor, point, lane);
  };
  /** A body (any visible unit that is not passed through) the step would enter. */
  const isBodyInTheWay = (actor: SettlementActor, point: SettlementPoint) =>
    forEachNearbyTrafficActor(context, point, actor.mounted ? 2.1 : 1.25, other => other !== actor &&
      other.visible && !isTrafficPassThrough(context, actor, other) &&
      DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(actor, other) &&
      !isSeparatingTrafficStep(actor, other, point));

  /** Skips waypoints already reached or passed; returns the one to walk to (undefined: path done). */
  const currentWaypoint = (actor: SettlementActor) => {
    const reach = actor.mounted ? RIDER_WAYPOINT : FOOT_WAYPOINT;
    while (actor.pathIndex < actor.path.length - 1) {
      const point = actor.path[actor.pathIndex]!, next = actor.path[actor.pathIndex + 1]!;
      const distance = DMath.hypot(point.x - actor.x, point.z - actor.z);
      const beyond = (actor.x - point.x) * (next.x - point.x) + (actor.z - point.z) * (next.z - point.z) > 0;
      const skip = distance <= reach || (beyond && distance < PASSED_WAYPOINT) ||
        (isStoodOn(point) && DMath.hypot(next.x - actor.x, next.z - actor.z) < OCCUPIED_SKIP);
      if (!skip) break;
      actor.pathIndex++;
    }
    const final = actor.path[actor.pathIndex];
    // A place someone else stands on counts as reached once the soldier is beside it.
    if (final && actor.pathIndex === actor.path.length - 1 && isStoodOn(final) &&
      DMath.hypot(final.x - actor.x, final.z - actor.z) < OCCUPIED_ARRIVAL) actor.pathIndex++;
    return actor.path[actor.pathIndex];
  };
  /** A standing body covers the point: walking to it would only circle that body. */
  const isStoodOn = (point: SettlementPoint) => {
    for (let index = 0; index < count; index++) {
      const neighbour = neighbours[index]!;
      if (neighbour.vx === 0 && neighbour.vz === 0 &&
        DMath.hypot(neighbour.x - point.x, neighbour.z - point.z) < neighbour.separation) return true;
    }
    return false;
  };
  /** Velocity towards the waypoint at the soldier's pace, slowing into its final place. */
  const preferVelocity = (actor: SettlementActor, waypoint: SettlementPoint, pace: number) => {
    const dx = waypoint.x - actor.x, dz = waypoint.z - actor.z, distance = DMath.hypot(dx, dz);
    // A soldier chasing its foe runs on; one walking to a place slows into it.
    const final = actor.pathIndex === actor.path.length - 1 && foe === undefined;
    const speed = final ? Math.min(pace, distance / ARRIVAL_SECONDS + pace * .25) : pace;
    agent.preferredX = distance ? dx / distance * speed : 0;
    agent.preferredZ = distance ? dz / distance * speed : 0;
  };
  /** Rider inertia: turning is slower the faster the horse runs (speed itself changes at once). */
  const applyInertia = (actor: SettlementActor, wantedX: number, wantedZ: number, dt: number) => {
    let x = wantedX, z = wantedZ;
    const current = DMath.hypot(agent.vx, agent.vz), wanted = DMath.hypot(x, z);
    if (actor.mounted && current > MOVING && wanted > MOVING) {
      const turn = DMath.atan2(agent.vx * z - agent.vz * x, agent.vx * x + agent.vz * z);
      const limit = RIDER_TURN * dt / Math.max(SLOW_TURN_SHARE, current / (agent.maxSpeed || 1));
      const angle = DMath.atan2(agent.vz, agent.vx) + Math.max(-limit, Math.min(limit, turn));
      x = DMath.cos(angle) * wanted; z = DMath.sin(angle) * wanted;
    }
    return { x, z };
  };
  /** Ground ahead of a candidate is clear for a short look (never past the waypoint). */
  const isAheadClear = (actor: SettlementActor, vx: number, vz: number, waypoint: SettlementPoint) => {
    const speed = DMath.hypot(vx, vz);
    if (speed < MOVING) return true;
    const reach = Math.min(speed * STATIC_LOOKAHEAD, DMath.hypot(waypoint.x - actor.x, waypoint.z - actor.z));
    return isGroundClear(actor, { x: actor.x + vx / speed * reach, z: actor.z + vz / speed * reach });
  };
  /** The step for velocity (vx, vz) if it is allowed (no body, no blocked ground), else null. */
  const tryStep = (actor: SettlementActor, vx: number, vz: number, dt: number, waypoint: SettlementPoint) => {
    let x = actor.x + vx * dt, z = actor.z + vz * dt;
    // The final place is stepped on exactly rather than circled.
    if (actor.pathIndex === actor.path.length - 1 &&
      DMath.hypot(waypoint.x - actor.x, waypoint.z - actor.z) <= DMath.hypot(vx, vz) * dt + 1e-6) {
      x = waypoint.x; z = waypoint.z;
    }
    const { world } = context.options;
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return null;
    const point = { x, z };
    // A soldier left standing on blocked ground (pushed out of a door fight) may walk off it.
    if (!isGroundClear(actor, point) && isGroundClear(actor, actor)) {
      recordMovementOutcome(actor, "static-blocked"); return null;
    }
    if (entersClosedDeck(context, actor, point)) {
      recordMovementOutcome(actor, "static-blocked"); return null;
    }
    if (isBodyInTheWay(actor, point)) {
      recordMovementOutcome(actor, "person-blocked"); refusedByBody = true; return null;
    }
    return point;
  };
  /**
   * The best allowed step among the first `ranked` candidates; "wait" when standing still ranks
   * best (unless only blocked ground refused the better ones: no one will move that out of the
   * way), null when every candidate tried runs into a body or blocked ground.
   */
  const pickStep = (actor: SettlementActor, waypoint: SettlementPoint, dt: number, ranked: number)
    : Step | typeof WAIT | null => {
    let fallback: Step | null = null;
    refusedByBody = false;
    for (let index = 0; index < ranked; index++) {
      const velocity = applyInertia(actor, ranker.x(index), ranker.z(index), dt);
      const standing = DMath.hypot(velocity.x, velocity.z) < MOVING;
      if (standing && (index === 0 || refusedByBody)) return fallback ?? WAIT;
      if (standing) continue;
      const point = tryStep(actor, velocity.x, velocity.z, dt, waypoint);
      if (!point) continue;
      const step = { point, vx: velocity.x, vz: velocity.z };
      if (index === 0 || isAheadClear(actor, velocity.x, velocity.z, waypoint)) return step;
      fallback ??= step;
    }
    return fallback;
  };
  /** The step to take this tick (null: wait); the whole fan is scored when the preferred step is refused. */
  const chooseStep = (actor: SettlementActor, waypoint: SettlementPoint, dt: number) => {
    agent.waitCost = Math.min(MAXIMUM_WAIT_COST, detours.heldSeconds(actor.uid) * IMPATIENCE);
    const ranked = ranker.rank(agent, neighbours, count);
    let step = pickStep(actor, waypoint, dt, ranked);
    if (step === null && ranked === 1) step = pickStep(actor, waypoint, dt, ranker.rank(agent, neighbours, count, true));
    return step === WAIT ? null : step;
  };
  const faceTowards = (actor: SettlementActor, vx: number, vz: number, dt: number) => {
    const heading = DMath.atan2(vx, vz);
    actor.yaw = turnYawToward(actor.yaw, heading, (actor.mounted ? RIDER_FACING : FOOT_FACING) * dt);
  };
  const wait = (actor: SettlementActor) => {
    setVelocity(actor.uid, 0, 0);
    actor.action = "idle";
  };
  const arrive = (actor: SettlementActor) => {
    wait(actor); recordMovementOutcome(actor, "arrived");
    return true;
  };

  /** Idle comrades standing right in the way of a held soldier step aside (to the freer side). */
  const askToMakeWay = (actor: SettlementActor) => {
    const length = DMath.hypot(agent.preferredX, agent.preferredZ);
    if (!length) return;
    const ahead = { x: agent.preferredX / length, z: agent.preferredZ / length };
    grid.forEachWithin(actor.x, actor.z, (actor.mounted ? 2.1 : 1.25) + MAKE_WAY_REACH, other => {
      if (other === actor || !other.visible || other.queueTarget || !canMakeWay(other, actor)) return false;
      const dx = other.x - actor.x, dz = other.z - actor.z;
      return dx * ahead.x + dz * ahead.z > 0 && DMath.hypot(dx, dz) < actorSeparation(actor, other) + MAKE_WAY_REACH;
    }, other => {
      const side = Math.sign((other.x - actor.x) * -ahead.z + (other.z - actor.z) * ahead.x) || 1;
      for (const turn of [side, -side]) {
        const shoulder = { x: other.x - ahead.z * turn * MAKE_WAY_STEP, z: other.z + ahead.x * turn * MAKE_WAY_STEP };
        if (isGroundClear(other, shoulder)) { other.queueTarget = shoulder; other.queueWait = 0; return; }
      }
    });
  };
  /** Moves the soldier to `point` this tick with velocity (vx, vz). */
  const takeStep = (actor: SettlementActor, point: SettlementPoint, vx: number, vz: number, dt: number) => {
    clearTrafficBlocker(actor);
    recordMovementOutcome(actor, "moving");
    const moved = DMath.hypot(point.x - actor.x, point.z - actor.z);
    actor.x = point.x; actor.z = point.z; actor.timer = 0;
    actor.y = sampleSmooth(context.options.world, context.options.world.heights, actor.x, actor.z);
    updatePersonTraffic(context, actor);
    setVelocity(actor.uid, vx, vz);
    if (moved > 1e-6) faceTowards(actor, vx, vz, dt);
    actor.action = "walk"; actor.locomotionSpeed = moved / dt;
  };
  const clearShoulder = (actor: SettlementActor) => {
    actor.queueTarget = undefined; actor.queueKind = undefined; actor.queueWait = 0;
  };
  /**
   * Steps onto the shoulder another unit asked this soldier to clear (a comrade heading for the
   * door fight through the waiting queue); a shoulder it cannot reach is given up.
   */
  const stepAside = (actor: SettlementActor, shoulder: SettlementPoint, dt: number) => {
    const dx = shoulder.x - actor.x, dz = shoulder.z - actor.z, distance = DMath.hypot(dx, dz);
    const pace = paceOf(actor), length = Math.min(distance, pace * dt);
    const point = distance > length ? { x: actor.x + dx / distance * length, z: actor.z + dz / distance * length }
      : { x: shoulder.x, z: shoulder.z };
    if (distance < 1e-6 || !isGroundClear(actor, point) || isBodyInTheWay(actor, point)) {
      clearShoulder(actor); wait(actor); return;
    }
    takeStep(actor, point, dx / distance * pace, dz / distance * pace, dt);
    if (length >= distance) clearShoulder(actor);
  };

  /** Walks a field soldier one tick along its path; true once the path is done (like `moveActor`). */
  const steer = (actor: SettlementActor, dt: number) => {
    if (actor.queueTarget) { stepAside(actor, actor.queueTarget, dt); return false; }
    actor.queueWait = 0;
    if (actor.pathIndex >= actor.path.length) return arrive(actor);
    const pace = paceOf(actor), motion = velocityOf(actor.uid);
    agent.horizon = actor.mounted ? RIDER_HORIZON : FOOT_HORIZON;
    gatherNeighbours(actor, pace);
    const waypoint = currentWaypoint(actor);
    if (!waypoint) return arrive(actor);
    agent.x = actor.x; agent.z = actor.z; agent.maxSpeed = pace;
    agent.vx = motion?.x ?? 0; agent.vz = motion?.z ?? 0;
    preferVelocity(actor, waypoint, pace);
    const step = chooseStep(actor, waypoint, dt);
    if (!step) {
      wait(actor); actor.timer += dt; detours.watch(actor, dt);
      if (detours.heldSeconds(actor.uid) >= MAKE_WAY_AFTER) askToMakeWay(actor);
      return false;
    }
    takeStep(actor, step.point, step.vx, step.vz, dt);
    if (actor.x === waypoint.x && actor.z === waypoint.z) actor.pathIndex++;
    detours.watch(actor, dt);
    return actor.pathIndex >= actor.path.length;
  };
  return {
    /** Called once per simulation tick, before any soldier moves. */
    beginTick: () => { tick++; detours.beginTick(); },
    steer,
    /** A soldier that stops on purpose (a blow, a wait) is at rest for its neighbours' predictions. */
    halt: (uid: number) => setVelocity(uid, 0, 0),
    /** Seconds the soldier has been held on one spot (no way past the bodies round it). */
    heldSeconds: (uid: number) => detours.heldSeconds(uid),
    forget: (uid: number) => { motions.delete(uid); detours.forget(uid); },
    clear: () => { motions.clear(); detours.clear(); },
    save: (): MilitarySteeringSave => ({ detours: detours.save(),
      motions: [...motions].map(([uid, motion]) => [uid, { age: tick - motion.tick, x: motion.x, z: motion.z }]) }),
    restore: (saved: Partial<MilitarySteeringSave> | undefined) => {
      motions.clear();
      for (const [uid, { age, x, z }] of saved?.motions ?? []) motions.set(uid, { tick: tick - age, x, z });
      detours.restore(saved?.detours);
    }
  };
};
