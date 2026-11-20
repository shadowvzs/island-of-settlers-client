import { SAILING_SHIP_OVERALL_LENGTH } from "../../render-common/ships/ship-dimensions";
import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { DMath } from "../math/deterministic-math";
import { countNavigation } from "./navigation-profile";
import { moveKeepsClear } from "./settlement-ship-clearance";
import { brakingSpeed, SHIP_MANOEUVRE_SPEED, type ShipMotion, type ShipPose } from "./settlement-ship-kinematics";
import { executeSailOrder, type HelmOrder } from "./settlement-ship-steering";

/**
 * Anticipatory avoidance (a dynamic window over predicted motion). Each tick a ship under way tries
 * a handful of helm orders (hold its course, alter it by a set angle either way, half speed, stop,
 * astern) and sails each forward for several seconds against the predicted motion of the ships
 * around it and against the shore. It keeps its course unless that leads into trouble, prefers
 * altering to starboard, and follows the rules of the road: the give-way ship acts early, the
 * stand-on ship holds on unless contact is imminent.
 */
export interface ShipTraffic extends ShipMotion {
  /** Inside its harbour approach (docking): it gives way to ships leaving or passing. */
  inbound: boolean;
  /** Moored, anchored, waiting or manoeuvring in tight water: others keep clear of it. */
  restricted: boolean;
  /** Seconds the ship has been held up without making way. */
  stuck?: number;
}
export interface AvoidanceScene {
  /** The hull floats at this pose (clear of the shore). */
  afloat(pose: ShipPose): boolean;
  traffic: readonly ShipTraffic[];
}

/** Prediction horizon and step (seconds): long enough for two ships meeting head on to pass. */
const HORIZON = 9;
const STEP = .5;
const STEPS = HORIZON / STEP;
/** Inside this time to contact the stand-on ship acts as well (seconds). */
const IMMINENT = 2;
/**
 * Hull envelopes as capsules (keel segment half length, radius) that contain the rig envelope plus
 * the spacing gap the fleet keeps, so predicted contact is never later than real contact.
 */
const CAPSULE_HALF = 4.1;
const CAPSULE_RADIUS = 3.4;
/** Extra passing distance kept between envelopes when there is room (tiles). */
const CAUTION = 2.5;
/** Hull centres further apart than this on either axis cannot touch or crowd each other. */
const REACH = 2 * (CAPSULE_HALF + CAPSULE_RADIUS) + CAUTION;
/** Ships further apart than this cannot meet within the horizon. */
const NEIGHBOUR_RANGE = SAILING_SHIP_OVERALL_LENGTH + CAUTION + HORIZON * 2 + 2;
/** Courses that cross within this angle (radians) count as head-on: both alter to starboard. */
const HEAD_ON = .35;
/** Bearings further aft than this (radians) are overtaking situations. */
const ABAFT = Math.PI * 5 / 8;
/** Ships slower than this (tiles/s) are passed by their exact hull, as if moored. */
const AT_REST = .05;
/** Weight a stand-on ship gives to a give-way ship before contact is imminent. */
const STAND_ON = .2;
/** Course alterations tried (radians from the helmsman's course; positive is to starboard). */
const ALTERATIONS = [0, .35, -.35, .7, -.7, 1.2, -1.2];
const ASTERN_SPEED = SHIP_MANOEUVRE_SPEED * .5;
/** Seconds a held-up ship waits before it starts to prefer backing off. */
const PATIENCE = 3;
const ALTERATION_COST = 1.5;
const PORT_COST = 1;
/** A give-way ship with a crossing ship on its starboard bow must not cross ahead of it (to port). */
const CROSSING_AHEAD_COST = 4;
const SLOWING_COST = 2;
const ASTERN_COST = 3;
const CROWDING_COST = 4;
const CONTACT_COST = 60;

const segmentDistance = (px: number, pz: number, cx: number, cz: number, dx: number, dz: number) => {
  const t = Math.max(-1, Math.min(1, ((px - cx) * dx + (pz - cz) * dz) / (dx * dx + dz * dz)));
  return DMath.hypot(px - cx - dx * t, pz - cz - dz * t);
};

const segmentsCross = (a: ShipPose, ax: number, az: number, b: ShipPose, bx: number, bz: number) => {
  const denominator = ax * bz - az * bx;
  if (Math.abs(denominator) < 1e-9) return false;
  const s = ((b.x - a.x) * bz - (b.z - a.z) * bx) / denominator;
  const t = ((b.x - a.x) * az - (b.z - a.z) * ax) / denominator;
  return Math.abs(s) <= 1 && Math.abs(t) <= 1;
};

/** Clear water between two hull capsules (negative: the envelopes touch). */
export const capsuleGap = (a: ShipPose, b: ShipPose) => {
  const ax = DMath.sin(a.yaw) * CAPSULE_HALF, az = DMath.cos(a.yaw) * CAPSULE_HALF;
  const bx = DMath.sin(b.yaw) * CAPSULE_HALF, bz = DMath.cos(b.yaw) * CAPSULE_HALF;
  if (segmentsCross(a, ax, az, b, bx, bz)) return -CAPSULE_RADIUS * 2;
  let closest = Infinity;
  for (const side of [-1, 1]) {
    closest = Math.min(closest, segmentDistance(a.x + ax * side, a.z + az * side, b.x, b.z, bx, bz),
      segmentDistance(b.x + bx * side, b.z + bz * side, a.x, a.z, ax, az));
  }
  return closest - CAPSULE_RADIUS * 2;
};

/** The poses a ship passes through holding `order` for the horizon, braking for its stop. */
const rollout = (start: ShipMotion, order: HelmOrder) => {
  countNavigation("ship.rollouts");
  const poses: ShipMotion[] = [];
  let state = start, travelled = 0;
  for (let step = 0; step < STEPS; step++) {
    const speed = order.stop === undefined ? order.speed
      : Math.min(order.speed, brakingSpeed(order.stop - travelled));
    const next = executeSailOrder(state, { heading: order.heading, speed }, STEP);
    travelled += DMath.hypot(next.x - state.x, next.z - state.z);
    state = next; poses.push(state);
  }
  return poses;
};

const bearing = (from: ShipPose, to: ShipPose) => wrapAngle(DMath.atan2(to.x - from.x, to.z - from.z) - from.yaw);

/**
 * How much `ship` must yield to `other` (1 give way, STAND_ON hold on): ships in restricted water
 * and ships leaving harbour stand on; otherwise head-on both alter, the overtaking ship and the ship
 * with the other on its starboard side give way.
 */
export const giveWayWeight = (ship: ShipTraffic, other: ShipTraffic) => {
  if (other.restricted) return 1;
  if (ship.inbound !== other.inbound) return ship.inbound ? 1 : STAND_ON;
  const ahead = bearing(ship, other), behind = bearing(other, ship);
  if (Math.abs(ahead) < HEAD_ON && Math.abs(behind) < HEAD_ON) return 1;
  if (Math.abs(behind) > ABAFT) return 1;
  if (Math.abs(ahead) > ABAFT) return STAND_ON;
  return ahead > 0 ? 1 : STAND_ON;
};

/** `other` crosses from the starboard bow and `ship` gives way to it (not head on, not overtaking). */
const crossesFromStarboard = (ship: ShipTraffic, other: ShipTraffic) => {
  if (other === ship) return false;
  const ahead = bearing(ship, other), across = Math.abs(wrapAngle(other.yaw - ship.yaw));
  return !other.restricted && ahead > HEAD_ON && ahead < ABAFT && across > Math.PI / 4 && across < Math.PI * 3 / 4 &&
    DMath.hypot(other.x - ship.x, other.z - ship.z) < NEIGHBOUR_RANGE;
};

/**
 * A ship nearby: its predicted poses, how much this ship yields to it, the gap at the start, and
 * whether it lies at rest (ships at rest are passed as close as the fleet allows, by their exact hull).
 */
interface Neighbour { moored?: ShipPose; poses: readonly ShipMotion[]; startGap: number; weight: number }

/**
 * Straight-ahead poses of each traffic entry, computed once per tick. The helm's `traffic` array is
 * rebuilt from fresh objects every tick, so the WeakMap cannot carry a stale prediction across ticks.
 */
const straightPoses = new WeakMap<ShipTraffic, readonly ShipMotion[]>();
const predictedStraight = (other: ShipTraffic) => {
  let poses = straightPoses.get(other);
  if (!poses) {
    poses = rollout(other, { heading: other.yaw, speed: other.speed });
    straightPoses.set(other, poses);
  }
  return poses;
};

/** Others' predicted poses: straight on at their current speed (ships at rest stay put). */
const neighbours = (ship: ShipTraffic, traffic: readonly ShipTraffic[]): Neighbour[] => {
  const result: Neighbour[] = [];
  for (const other of traffic) {
    if (other === ship || DMath.hypot(other.x - ship.x, other.z - ship.z) >= NEIGHBOUR_RANGE) continue;
    result.push({ moored: Math.abs(other.speed) < AT_REST ? other : undefined,
      poses: predictedStraight(other), startGap: capsuleGap(ship, other),
      weight: giveWayWeight(ship, other) });
  }
  return result;
};

/** Penalty for a candidate's predicted poses: shore contact, contact with a ship, crowding a ship. */
const hazard = (start: ShipPose, poses: readonly ShipMotion[], others: readonly Neighbour[],
  scene: AvoidanceScene) => {
  let crowding = 0;
  for (let step = 0; step < STEPS; step++) {
    const pose = poses[step]!, time = (step + 1) * STEP, urgency = 1 - time / (HORIZON + STEP);
    if (!scene.afloat(pose)) return CONTACT_COST * (1 + urgency);
    for (const other of others) {
      const near = other.poses[step]!;
      if (Math.abs(near.x - pose.x) > REACH || Math.abs(near.z - pose.z) > REACH) continue;
      if (other.moored) {
        if (!moveKeepsClear(start, pose, other.moored)) return CONTACT_COST * (1 + urgency);
        continue;
      }
      const gap = capsuleGap(pose, near);
      if (gap >= CAUTION) continue;
      // Ships already crowded together may always open the gap; the stand-on ship holds on until
      // contact is imminent.
      const closing = gap < 0 && gap < other.startGap - 1e-6;
      if (closing && (time <= IMMINENT || other.weight >= 1)) return CONTACT_COST * (1 + urgency);
      crowding = Math.max(crowding, other.weight * urgency * Math.min(1, (CAUTION - gap) / CAUTION));
    }
  }
  return crowding * CROWDING_COST;
};

interface Candidate { alteration: number; order: HelmOrder }

/** Course alterations at full, half and no speed, and backing astern on the present heading. */
const candidates = (ship: ShipMotion, nominal: HelmOrder): Candidate[] => {
  const list: Candidate[] = [];
  // Holding its course onto the stop, the ship may only slow down; it does not swing about there.
  const alterations = nominal.heading === undefined ? [0] : ALTERATIONS;
  for (const speed of [nominal.speed, nominal.speed / 2]) for (const alteration of alterations) {
    const heading = nominal.heading === undefined ? undefined : nominal.heading + alteration;
    list.push({ alteration, order: { heading, speed, stop: nominal.stop } });
  }
  // Stopping or backing holds the present heading: a waiting ship does not swing on the spot.
  list.push({ alteration: 0, order: { heading: ship.yaw, speed: 0 } });
  list.push({ alteration: 0, order: { heading: ship.yaw, speed: -ASTERN_SPEED } });
  return list;
};

/** Cost of leaving the helmsman's order: altering course (more to port), slowing, backing. */
const deviation = ({ alteration, order }: Candidate, nominal: HelmOrder, crossing: boolean) =>
  Math.abs(alteration) * ALTERATION_COST + Math.max(0, -alteration) * (crossing ? CROSSING_AHEAD_COST : PORT_COST) +
  Math.max(0, nominal.speed - order.speed) * SLOWING_COST + (order.speed < 0 ? ASTERN_COST : 0);

/**
 * A ship held up for long loses patience: waiting where it is costs more and more, until backing
 * astern to open the way (back and turn) is cheaper than waiting for good.
 */
const impatience = (ship: ShipTraffic, order: HelmOrder) => {
  const urge = Math.min(1, Math.max(0, ((ship.stuck ?? 0) - PATIENCE) / PATIENCE));
  if (order.speed < 0) return -urge * ASTERN_COST;
  return order.speed === 0 ? urge * ASTERN_COST * 2 : 0;
};

/** The helm order to sail this tick: the helmsman's own, unless the prediction shows trouble ahead. */
export const avoidTraffic = (ship: ShipTraffic, nominal: HelmOrder, scene: AvoidanceScene): HelmOrder => {
  const others = neighbours(ship, scene.traffic);
  if (!hazard(ship, rollout(ship, nominal), others, scene)) return nominal;
  const crossing = scene.traffic.some(other => crossesFromStarboard(ship, other));
  let best = nominal, bestCost = Infinity;
  for (const candidate of candidates(ship, nominal)) {
    const cost = deviation(candidate, nominal, crossing) + impatience(ship, candidate.order) +
      hazard(ship, rollout(ship, candidate.order), others, scene);
    if (cost < bestCost - 1e-9) { best = candidate.order; bestCost = cost; }
  }
  return best;
};
