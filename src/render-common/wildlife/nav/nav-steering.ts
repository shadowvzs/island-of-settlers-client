import { DMath } from "../../../shared/math/deterministic-math";
import { isSegmentWalkable, type NavWorld } from "./nav-query";

/** Probe angles around the desired heading (radians): straight first, then wider. */
const PROBE_OFFSETS = Float32Array.from([0, 0.35, -0.35, 0.75, -0.75, 1.2, -1.2, 1.7, -1.7]);
/** How much the current heading matters against the desired one (heading inertia). */
const HEADING_INERTIA = 0.45;
const probeScores = new Float32Array(PROBE_OFFSETS.length);

/** Angle wrapped into [-PI, PI) (+PI maps to -PI). */
export const wrapAngle = (angle: number) => {
  const turns = Math.round(angle / (Math.PI * 2));
  return angle - turns * Math.PI * 2;
};

/** Interpolates between two angles the shorter way round. */
export const lerpAngle = (from: number, to: number, t: number) => from + wrapAngle(to - from) * t;

/** Turns `current` towards `target` by at most `maxStep` radians (the shorter way round). */
export const turnTowards = (current: number, target: number, maxStep: number) => {
  const difference = wrapAngle(target - current);
  if (Math.abs(difference) <= maxStep) return target;
  return wrapAngle(current + Math.sign(difference) * maxStep);
};

/** Bounded angular speed with a gentle ease near the destination heading, rather than a hard stop. */
export const turnSmoothly = (current: number, target: number, rate: number, dt: number) => {
  const difference = wrapAngle(target - current);
  const eased = difference * (1 - DMath.exp(-7 * dt));
  const limit = rate * dt;
  return wrapAngle(current + Math.max(-limit, Math.min(limit, eased)));
};

/** The unprobed candidate with the best score (desired direction and inertia), -1 when none. */
const takeBestProbe = () => {
  let best = -1;
  for (let probe = 0; probe < probeScores.length; probe += 1) {
    if (probeScores[probe]! > -Infinity && (best < 0 || probeScores[probe]! > probeScores[best]!)) {
      best = probe;
    }
  }
  if (best >= 0) probeScores[best] = -Infinity;
  return best;
};

/**
 * Local steering with a few forward probes: candidate headings fan out around the desired one,
 * ranked by how close they stay to it and to the current heading (no sudden 180 degree turns),
 * and the first whose probe segment of `lookahead` is walkable wins. NaN when every probe is
 * blocked (the caller stops and re-plans). At most nine segment tests, usually one.
 */
export const steerHeading = (
  nav: NavWorld,
  species: number,
  x: number,
  z: number,
  heading: number,
  desired: number,
  lookahead: number,
  size = 1
) => {
  for (let probe = 0; probe < PROBE_OFFSETS.length; probe += 1) {
    const offset = PROBE_OFFSETS[probe]!;
    const candidate = desired + offset;
    probeScores[probe] = DMath.cos(offset) + HEADING_INERTIA * DMath.cos(candidate - heading);
  }
  for (let probe = takeBestProbe(); probe >= 0; probe = takeBestProbe()) {
    const candidate = desired + PROBE_OFFSETS[probe]!;
    const endX = x + DMath.cos(candidate) * lookahead;
    const endZ = z + DMath.sin(candidate) * lookahead;
    if (isSegmentWalkable(nav, species, x, z, endX, endZ, size)) return wrapAngle(candidate);
  }
  return Number.NaN;
};

/** Scratch result of getSeparation (hot path: no allocation). */
const separation = { x: 0, z: 0 };

/**
 * Soft push away from neighbours closer than `radius` (linear falloff), summed into
 * `separation`. Loose herds keep their preferred distance without rigid flocking.
 */
export const getSeparation = (
  x: number,
  z: number,
  self: number,
  others: { active: Uint8Array; x: Float32Array; z: Float32Array },
  count: number,
  radius: number
) => {
  separation.x = 0;
  separation.z = 0;
  for (let other = 0; other < count; other += 1) {
    if (other === self || !others.active[other]) continue;
    const dx = x - others.x[other]!;
    const dz = z - others.z[other]!;
    const distance = DMath.hypot(dx, dz);
    if (distance >= radius || distance < 1e-5) continue;
    const push = (radius - distance) / radius / distance;
    separation.x += dx * push;
    separation.z += dz * push;
  }
  return separation;
};
