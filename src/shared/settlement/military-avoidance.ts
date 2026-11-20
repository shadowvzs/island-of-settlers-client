import { DMath } from "../math/deterministic-math";
/**
 * Anticipatory local avoidance of soldiers (docs/archive/dated/military-motion-2026-10-13.md): a sampled velocity
 * obstacle. Each walking soldier scores a fixed fan of candidate velocities around the way it wants
 * to go by how far they turn it from that way and by the time to the first collision with each
 * neighbour over a short horizon (both moving along their current velocities). Units therefore start
 * to curve about a second before they would bump, instead of stopping on contact.
 * - Reciprocal: two walking soldiers each take half the avoidance (the RVO velocity 2v - v_now), so
 *   they do not both swerve all the way and then swerve back (the reciprocal dance).
 * - Consistent sides: with someone coming head on, turns to the left cost a little more, so
 *   opposite streams pass each other on the same side (each keeps to its right); crossing columns
 *   give way to the right, so one slows while the other passes instead of both swerving.
 * Pure and allocation free: candidates live in typed arrays owned by the ranker.
 */
export interface AvoidanceAgent {
  x: number; z: number;
  /** Current velocity (tiles per second). */
  vx: number; vz: number;
  /** Preferred velocity: towards the next waypoint at the soldier's pace. */
  preferredX: number; preferredZ: number;
  maxSpeed: number;
  /** Seconds ahead it looks for collisions (riders, fast and slow to turn, look further). */
  horizon: number;
  /** Extra cost of standing still: grows while the soldier waits, so a jam breaks up. */
  waitCost: number;
}
export interface AvoidanceNeighbour {
  x: number; z: number; vx: number; vz: number;
  /** Bodies may not come closer than this (centre to centre). */
  separation: number;
  /** Extra room kept while passing, as long as the pair is not already closer. */
  comfort: number;
  /** A walking soldier that avoids too: each side takes half. */
  reciprocal: boolean;
}

const MINIMUM_TIME = .05;
/**
 * Two bodies already pressed together count as colliding this soon when one moves closer: a firm
 * cost, not an absolute veto (the hard step check still refuses entering deeper), so a soldier in a
 * press can still choose a way out instead of standing for ever.
 */
const PRESSED_TIME = .3;
/** Cost of turning away from the preferred velocity (per maximum speed of difference). */
const DEVIATION_WEIGHT = 1;
/** Cost of an imminent collision: weight x (1 / time - 1 / horizon). */
const COLLISION_WEIGHT = .9;
/** Extra cost of slowing down (per share of pace given up): curving round early beats stop-and-go. */
const SLOWING_WEIGHT = .1;
/** Cost of changing the current velocity: keeps a chosen way round instead of flipping sides. */
const CONTINUITY_WEIGHT = .3;
/** Extra cost per unit of a left turn while someone comes head on. */
const PASS_SIDE_WEIGHT = .35;
/** Extra cost per unit of swerving while giving way to someone crossing from the right (slow down). */
const GIVE_WAY_WEIGHT = .6;
/** Share of the collision cost of a crossing neighbour from the left: it gives way, mostly. */
const RIGHT_OF_WAY_SHARE = .35;
/** Neighbours a ranker can mark (the steering passes at most ten). */
const MAX_MARKED = 64;
/** Cosine below which a neighbour counts as oncoming (more than about 120 degrees apart). */
const ONCOMING_COSINE = -.5;
/** Cosine below which a neighbour crosses the agent's way (more than about 70 degrees apart). */
const CROSSING_COSINE = .3;
const ANGLES = [0, .26, -.26, .52, -.52, .85, -.85, 1.2, -1.2, 1.65, -1.65, 2.2, -2.2];
const SPEEDS = [1, .5];
const CANDIDATES = ANGLES.length * SPEEDS.length + 1;

/**
 * Seconds until two discs touch: `dx, dz` from the agent to the neighbour, `vx, vz` the agent's
 * velocity relative to it. Already closer than `radius`: `PRESSED_TIME` while closing in, never while
 * separating.
 */
export const timeToCollision = (dx: number, dz: number, vx: number, vz: number, radius: number) => {
  const gap = dx * dx + dz * dz - radius * radius;
  const closing = dx * vx + dz * vz;
  if (gap <= 0) return closing > 0 ? PRESSED_TIME : Infinity;
  if (closing <= 0) return Infinity;
  const speed = vx * vx + vz * vz;
  const discriminant = closing * closing - speed * gap;
  if (discriminant <= 0) return Infinity;
  return (closing - Math.sqrt(discriminant)) / speed;
};

/** The disc a pair must keep apart: with comfort while they are still that far apart. */
const passingRadius = (neighbour: AvoidanceNeighbour, distanceSquared: number) => {
  const wide = neighbour.separation + neighbour.comfort;
  return distanceSquared > wide * wide ? wide : neighbour.separation;
};

/** Collision cost of moving at (vx, vz) among `neighbours` (0: no collision within the horizon). */
const collisionCost = (agent: AvoidanceAgent, neighbours: readonly AvoidanceNeighbour[], count: number,
  vx: number, vz: number, rightOfWay?: Uint8Array) => {
  let worst = 0;
  for (let index = 0; index < count; index++) {
    const neighbour = neighbours[index]!;
    const dx = neighbour.x - agent.x, dz = neighbour.z - agent.z;
    const relativeX = (neighbour.reciprocal ? 2 * vx - agent.vx : vx) - neighbour.vx;
    const relativeZ = (neighbour.reciprocal ? 2 * vz - agent.vz : vz) - neighbour.vz;
    const time = timeToCollision(dx, dz, relativeX, relativeZ, passingRadius(neighbour, dx * dx + dz * dz));
    if (time >= agent.horizon) continue;
    const share = rightOfWay?.[index] ? RIGHT_OF_WAY_SHARE : 1;
    worst = Math.max(worst, (1 / Math.max(time, MINIMUM_TIME) - 1 / agent.horizon) * share);
  }
  return worst * COLLISION_WEIGHT;
};

/**
 * Passing rules for the neighbours on a collision course with the preferred velocity, as on a road:
 * with someone head on, keep right; with someone crossing, give way to the one coming from the right
 * (slow down rather than swerve in front of it) and keep going before one coming from the left (it
 * gives way: `rightOfWay` marks it, its collision counts for less). Crossing columns therefore let
 * each other through block by block instead of shearing each other apart.
 */
interface PassingRules { keepRight: boolean; giveWay: boolean; rightOfWay: Uint8Array }

const passingRules = (agent: AvoidanceAgent, neighbours: readonly AvoidanceNeighbour[], count: number,
  rules: PassingRules) => {
  rules.keepRight = false; rules.giveWay = false; rules.rightOfWay.fill(0, 0, count);
  const speed = DMath.hypot(agent.preferredX, agent.preferredZ);
  for (let index = 0; index < Math.min(count, MAX_MARKED); index++) {
    const neighbour = neighbours[index]!, other = DMath.hypot(neighbour.vx, neighbour.vz);
    if (!other || !speed) continue;
    const cosine = (neighbour.vx * agent.preferredX + neighbour.vz * agent.preferredZ) / (other * speed);
    if (cosine > CROSSING_COSINE) continue;
    const dx = neighbour.x - agent.x, dz = neighbour.z - agent.z;
    const time = timeToCollision(dx, dz, agent.preferredX - neighbour.vx, agent.preferredZ - neighbour.vz,
      passingRadius(neighbour, dx * dx + dz * dz));
    if (time >= agent.horizon) continue;
    if (cosine < ONCOMING_COSINE) { rules.keepRight = true; continue; }
    const onTheLeft = agent.preferredX * dz - agent.preferredZ * dx > 0;
    if (onTheLeft) rules.rightOfWay[index] = 1;
    else rules.giveWay = true;
  }
};

/** Extra cost of a candidate under the passing rules. */
const passingCost = (agent: AvoidanceAgent, rules: PassingRules, vx: number, vz: number) => {
  const scale = agent.maxSpeed || 1;
  const left = (agent.preferredX * vz - agent.preferredZ * vx) / (scale * scale);
  let cost = 0;
  if (rules.keepRight) cost += Math.max(0, left) * PASS_SIDE_WEIGHT;
  if (rules.giveWay) cost += Math.abs(left) * GIVE_WAY_WEIGHT;
  return cost;
};

/**
 * Ranks candidate velocities, best first. `rank` returns how many there are (1: the preferred
 * velocity is free of collisions and nothing else was scored; `everything` scores the whole fan
 * anyway, e.g. when the preferred step runs into a wall); `x(i)`, `z(i)` read the i-th best.
 */
export const createVelocityRanker = () => {
  const candidateX = new Float64Array(CANDIDATES), candidateZ = new Float64Array(CANDIDATES);
  const cost = new Float64Array(CANDIDATES), order = new Uint8Array(CANDIDATES);
  const rules: PassingRules = { giveWay: false, keepRight: false, rightOfWay: new Uint8Array(MAX_MARKED) };
  const score = (agent: AvoidanceAgent, neighbours: readonly AvoidanceNeighbour[], count: number, slot: number) => {
    const vx = candidateX[slot]!, vz = candidateZ[slot]!;
    const deviation = DMath.hypot(vx - agent.preferredX, vz - agent.preferredZ) / (agent.maxSpeed || 1);
    const change = DMath.hypot(vx - agent.vx, vz - agent.vz) / (agent.maxSpeed || 1);
    const slowing = Math.max(0, 1 - DMath.hypot(vx, vz) / (DMath.hypot(agent.preferredX, agent.preferredZ) || 1));
    let total = deviation * DEVIATION_WEIGHT + change * CONTINUITY_WEIGHT + slowing * SLOWING_WEIGHT +
      collisionCost(agent, neighbours, count, vx, vz, rules.rightOfWay);
    if (vx === 0 && vz === 0) total += agent.waitCost;
    cost[slot] = total + passingCost(agent, rules, vx, vz);
  };
  /** Insertion sort of the candidate order by cost (stable: ties keep the fan order). */
  const sortByCost = () => {
    for (let index = 0; index < CANDIDATES; index++) order[index] = index;
    for (let index = 1; index < CANDIDATES; index++) {
      const slot = order[index]!;
      let at = index;
      while (at > 0 && cost[order[at - 1]!]! > cost[slot]!) { order[at] = order[at - 1]!; at--; }
      order[at] = slot;
    }
  };
  const rank = (agent: AvoidanceAgent, neighbours: readonly AvoidanceNeighbour[], count: number,
    everything = false) => {
    candidateX[0] = agent.preferredX; candidateZ[0] = agent.preferredZ; order[0] = 0;
    if (!everything && collisionCost(agent, neighbours, count, agent.preferredX, agent.preferredZ) === 0) return 1;
    const heading = DMath.atan2(agent.preferredZ, agent.preferredX);
    const speed = DMath.hypot(agent.preferredX, agent.preferredZ);
    let slot = 1;
    for (const share of SPEEDS) for (const angle of ANGLES) {
      if (share === 1 && angle === 0) continue;
      candidateX[slot] = DMath.cos(heading + angle) * speed * share;
      candidateZ[slot] = DMath.sin(heading + angle) * speed * share;
      slot++;
    }
    candidateX[slot] = 0; candidateZ[slot] = 0;
    passingRules(agent, neighbours, count, rules);
    for (let index = 0; index < CANDIDATES; index++) score(agent, neighbours, count, index);
    sortByCost();
    return CANDIDATES;
  };
  return { rank, x: (index: number) => candidateX[order[index]!]!, z: (index: number) => candidateZ[order[index]!]! };
};
