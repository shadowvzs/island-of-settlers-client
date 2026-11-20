import {
  SAILING_SHIP_HULL_BEAM, SAILING_SHIP_HULL_LENGTH,
  SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SPACING,
  SAILING_SHIP_TURN_RADIUS
} from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import { countNavigation, profileNavigationStage } from "./navigation-profile";
import type { SettlementPoint } from "./settlement-types";

export interface ShipObstacle extends SettlementPoint { yaw: number; id?: number }

const ENVELOPE_HALF_LENGTH = (SAILING_SHIP_OVERALL_LENGTH + SAILING_SHIP_SPACING) / 2;
const ENVELOPE_HALF_BEAM = (SAILING_SHIP_OVERALL_BEAM + SAILING_SHIP_SPACING) / 2;
/** Hull centres further apart than this can never have overlapping envelopes. */
export const ENVELOPE_REACH = DMath.hypot(ENVELOPE_HALF_LENGTH, ENVELOPE_HALF_BEAM) * 2;
// Circumscribed circles reject distant hulls before the exact separating-axis test.
// The small margin keeps borderline floating-point cases on the original path.
const CLEAR_REACH = ENVELOPE_REACH + 1e-8;
const CLEAR_REACH_SQUARED = CLEAR_REACH * CLEAR_REACH;
const envelopesAreDistant = (a: ShipObstacle, b: ShipObstacle) =>
  (b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z) > CLEAR_REACH_SQUARED;
const envelopeExtent = (yaw: number, axis: number) =>
  Math.abs(DMath.cos(yaw - axis)) * ENVELOPE_HALF_LENGTH + Math.abs(DMath.sin(yaw - axis)) * ENVELOPE_HALF_BEAM;

/**
 * How deep two hull/rig envelopes (with their clearance gap) overlap: the smallest overlap over the
 * separating axes; zero or less when they are apart.
 */
export const shipsPenetration = (a: ShipObstacle, b: ShipObstacle) => {
  let depth = Infinity;
  for (const axis of [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]) {
    const distance = Math.abs((b.x - a.x) * DMath.sin(axis) + (b.z - a.z) * DMath.cos(axis));
    depth = Math.min(depth, envelopeExtent(a.yaw, axis) + envelopeExtent(b.yaw, axis) - distance);
  }
  return depth;
};

const hullExtent = (yaw: number, axis: number) => Math.abs(DMath.cos(yaw - axis)) * SAILING_SHIP_HULL_LENGTH / 2 +
  Math.abs(DMath.sin(yaw - axis)) * SAILING_SHIP_HULL_BEAM / 2;

/** How deep two bare hulls (no rig, no gap) overlap; zero or less when they are apart. */
const hullsPenetration = (a: ShipObstacle, b: ShipObstacle) => {
  let depth = Infinity;
  for (const axis of [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]) {
    const distance = Math.abs((b.x - a.x) * DMath.sin(axis) + (b.z - a.z) * DMath.cos(axis));
    depth = Math.min(depth, hullExtent(a.yaw, axis) + hullExtent(b.yaw, axis) - distance);
  }
  return depth;
};

/**
 * An emergency stop: a hull that cannot stop dead may glide on into the rig clearance while braking,
 * as long as the hulls themselves never meet (or it does not press further in).
 */
export const brakeKeepsHullsApart = (current: ShipObstacle, candidate: ShipObstacle, other: ShipObstacle) => {
  const depth = hullsPenetration(candidate, other);
  return depth <= 0 || depth <= hullsPenetration(current, other) + 1e-9;
};

/** Separating-axis test uses the complete hull/rig envelope, including its clearance gap. */
export const shipsOverlap = (a: ShipObstacle, b: ShipObstacle) =>
  !envelopesAreDistant(a, b) && shipsPenetration(a, b) > .00001;

/**
 * A move from `current` to `candidate` keeps the rig envelopes of both ships apart (in a crowded
 * harbour the clearance gap may be used up), or at least does not press further in.
 */
export const moveKeepsClear = (current: ShipObstacle, candidate: ShipObstacle, other: ShipObstacle) => {
  if (envelopesAreDistant(candidate, other)) return true;
  const depth = shipsPenetration(candidate, other);
  return depth <= SAILING_SHIP_SPACING || depth <= shipsPenetration(current, other) + 1e-9;
};

interface ClearanceAxis { sin: number; cos: number; extent: number }
interface OwnHullAxis { axis: number; sin: number; cos: number; selfExtent: number }
const ownHullAxes = (yaw: number): OwnHullAxis[] => [yaw, yaw + Math.PI / 2].map(axis => ({
  axis, sin: DMath.sin(axis), cos: DMath.cos(axis), selfExtent: envelopeExtent(yaw, axis)
}));
const pairHullAxes = (yaw: number, own: OwnHullAxis[], otherYaw: number, other: OwnHullAxis[]): ClearanceAxis[] => {
  const ownForward = own[0]!, ownAcross = own[1]!, otherForward = other[0]!, otherAcross = other[1]!;
  return [
    { sin: ownForward.sin, cos: ownForward.cos,
      extent: ownForward.selfExtent + envelopeExtent(otherYaw, ownForward.axis) },
    { sin: ownAcross.sin, cos: ownAcross.cos,
      extent: ownAcross.selfExtent + envelopeExtent(otherYaw, ownAcross.axis) },
    { sin: otherForward.sin, cos: otherForward.cos,
      extent: envelopeExtent(yaw, otherForward.axis) + otherForward.selfExtent },
    { sin: otherAcross.sin, cos: otherAcross.cos,
      extent: envelopeExtent(yaw, otherAcross.axis) + otherAcross.selfExtent }
  ];
};
const penetrationOnAxes = (a: ShipObstacle, b: ShipObstacle, axes: readonly ClearanceAxis[]) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  let depth = Infinity;
  for (const axis of axes) {
    const distance = Math.abs(dx * axis.sin + dz * axis.cos);
    depth = Math.min(depth, axis.extent - distance);
  }
  return depth;
};
const angleKey = (yaw: number) => Object.is(yaw, -0) ? "-0" : yaw;
type AngleKey = ReturnType<typeof angleKey>;
const sharedPairs = new Map<AngleKey, Map<AngleKey, ClearanceAxis[]>>();
const pairOrder: { yaw: AngleKey; otherYaw: AngleKey }[] = [];
let pairHead = 0;
let pairSin = DMath.sin, pairCos = DMath.cos;
const rememberPair = (yaw: AngleKey, otherYaw: AngleKey, axes: ClearanceAxis[]) => {
  if (pairOrder.length >= 4096) {
    const keys = pairOrder[pairHead]!;
    const row = sharedPairs.get(keys.yaw)!;
    row.delete(keys.otherYaw);
    if (!row.size) sharedPairs.delete(keys.yaw);
    pairOrder[pairHead] = { yaw, otherYaw };
    pairHead = (pairHead + 1) % 4096;
  } else pairOrder.push({ yaw, otherYaw });
  let row = sharedPairs.get(yaw);
  if (!row) { row = new Map(); sharedPairs.set(yaw, row); }
  row.set(otherYaw, axes);
};

/** One anchorage query: exact angular SAT work is shared, while every pose's separation is rechecked. */
export const createShipOverlapTest = () => {
  const bases = new Map<number | string, OwnHullAxis[]>();
  const pairs = new Map<number | string, Map<number | string, ClearanceAxis[]>>();
  let count = 0;
  const basis = (yaw: number, key: number | string) => {
    let axes = bases.get(key);
    if (!axes) {
      if (bases.size >= 256) bases.delete(bases.keys().next().value!);
      axes = ownHullAxes(yaw); bases.set(key, axes);
    }
    return axes;
  };
  return (a: ShipObstacle, b: ShipObstacle) => {
    if (envelopesAreDistant(a, b)) return false;
    const aKey = angleKey(a.yaw), bKey = angleKey(b.yaw);
    let row = pairs.get(aKey), axes = row?.get(bKey);
    if (!axes) {
      if (count >= 1024) { pairs.clear(); count = 0; row = undefined; }
      if (!row) { row = new Map(); pairs.set(aKey, row); }
      axes = pairHullAxes(a.yaw, basis(a.yaw, aKey), b.yaw, basis(b.yaw, bKey));
      row.set(bKey, axes); count++;
    }
    const dx = b.x - a.x, dz = b.z - a.z;
    // min(overlaps) > threshold exactly when every ordered overlap exceeds it. A separating
    // axis (including NaN) already makes the full comparison false; later axes cannot change it.
    for (const axis of axes)
      if (!(axis.extent - Math.abs(dx * axis.sin + dz * axis.cos) > .00001)) return false;
    return true;
  };
};
/** One synchronous search's fixed obstacle snapshot; memoize identical SAT arithmetic, not approximated axes. */
export const createShipMoveClearance = (blocked: readonly ShipObstacle[]) => {
  // The geometry is independent of positions, world, terrain and saved state. Retain only exact
  // angle pairs; every query still evaluates its own ordered shapes and all four separating axes.
  if (pairSin !== DMath.sin || pairCos !== DMath.cos) {
    sharedPairs.clear(); pairOrder.length = 0; pairHead = 0; pairSin = DMath.sin; pairCos = DMath.cos;
  }
  const shapes: (ShipObstacle & { axes?: OwnHullAxis[] })[] = blocked.map(({ x, yaw, z }) => ({ x, yaw, z, axes: undefined }));
  const yaws = new Map<number | string, { axes?: OwnHullAxis[]; pairs: Map<number, ClearanceAxis[]> }>();
  const axesFor = (yaw: number, index: number) => {
    const key = angleKey(yaw);
    let own = yaws.get(key);
    if (!own) {
      if (yaws.size >= 256) yaws.delete(yaws.keys().next().value!);
      own = { pairs: new Map() }; yaws.set(key, own);
    }
    let axes = own.pairs.get(index);
    if (!axes) {
      const other = shapes[index]!;
      const otherKey = angleKey(other.yaw);
      axes = sharedPairs.get(key)?.get(otherKey);
      if (!axes) {
        own.axes ??= ownHullAxes(yaw);
        other.axes ??= ownHullAxes(other.yaw);
        axes = pairHullAxes(yaw, own.axes, other.yaw, other.axes);
        rememberPair(key, otherKey, axes);
      }
      own.pairs.set(index, axes);
    }
    return axes;
  };
  const depth = (pose: ShipObstacle, index: number) => {
    const other = shapes[index]!;
    return penetrationOnAxes(pose, other, axesFor(pose.yaw, index));
  };
  return (current: ShipObstacle, candidate: ShipObstacle) => shapes.every((other, index) => {
    if (envelopesAreDistant(candidate, other)) return true;
    const penetration = depth(candidate, index);
    return penetration <= SAILING_SHIP_SPACING || penetration <= depth(current, index) + 1e-9;
  });
};

/**
 * Hull sample points (keel offset, sideways offset) about half a tile apart, outermost first: a hull
 * touching the shore is usually caught by a corner or an edge after a few lookups.
 */
const HULL_SAMPLES = (() => {
  const halfLength = SAILING_SHIP_HULL_LENGTH / 2, halfBeam = SAILING_SHIP_HULL_BEAM / 2;
  const stepsLength = Math.ceil(SAILING_SHIP_HULL_LENGTH * 2), stepsBeam = Math.ceil(SAILING_SHIP_HULL_BEAM * 2);
  const samples: { forward: number; rim: number; sideways: number }[] = [];
  for (let l = 0; l <= stepsLength; l++) for (let b = 0; b <= stepsBeam; b++) {
    const forward = -halfLength + l / stepsLength * halfLength * 2;
    const sideways = -halfBeam + b / stepsBeam * halfBeam * 2;
    samples.push({ forward, rim: Math.abs(forward) / halfLength + Math.abs(sideways) / halfBeam, sideways });
  }
  return Float64Array.from(samples.sort((a, b) => b.rim - a.rim).flatMap(sample => [sample.forward, sample.sideways]));
})();

export const shipHullFitsSea = (...args: Parameters<typeof shipHullFitsSeaImpl>) =>
  profileNavigationStage("sea.hullFits", () => shipHullFitsSeaImpl(...args));
const shipHullFitsSeaImpl = (world: WorldData, sea: Uint8Array, point: ShipObstacle) => {
  countNavigation("sea.hullFitsCalls");
  const sin = DMath.sin(point.yaw), cos = DMath.cos(point.yaw);
  for (let index = 0; index < HULL_SAMPLES.length; index += 2) {
    const forward = HULL_SAMPLES[index]!, sideways = HULL_SAMPLES[index + 1]!;
    const x = Math.floor(point.x + sin * forward + cos * sideways);
    const z = Math.floor(point.z + cos * forward - sin * sideways);
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ || !sea[z * world.cellsX + x]) return false;
  }
  return true;
};

/** A fully wet conservative bounding rectangle proves every original hull sample is wet. */
const createSummedHullFit = (world: WorldData, sea: Uint8Array, summed: Uint32Array) => {
  const width = world.cellsX, height = world.cellsZ, stride = width + 1;
  const revision = world.terrainRevision ?? 0;
  const halfLength = SAILING_SHIP_HULL_LENGTH / 2, halfBeam = SAILING_SHIP_HULL_BEAM / 2;
  return (currentWorld: WorldData, currentSea: Uint8Array, point: ShipObstacle) => {
    if (currentWorld !== world || currentSea !== sea || world.cellsX !== width || world.cellsZ !== height ||
      (world.terrainRevision ?? 0) !== revision) return shipHullFitsSea(currentWorld, currentSea, point);
    const sin = DMath.sin(point.yaw), cos = DMath.cos(point.yaw);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const forward of [-halfLength, halfLength]) for (const sideways of [-halfBeam, halfBeam]) {
      const x = point.x + sin * forward + cos * sideways;
      const z = point.z + cos * forward - sin * sideways;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, z); bottom = Math.max(bottom, z);
    }
    // Enclose rounding of every original multiply/add and the sample-grid endpoint arithmetic.
    const margin = 1e-8 + Number.EPSILON *
      (Math.abs(point.x) + Math.abs(point.z) + SAILING_SHIP_HULL_LENGTH + SAILING_SHIP_HULL_BEAM) * 8;
    left = Math.floor(left - margin); right = Math.floor(right + margin) + 1;
    top = Math.floor(top - margin); bottom = Math.floor(bottom + margin) + 1;
    if (left >= 0 && top >= 0 && right <= width && bottom <= height &&
      (summed[bottom * stride + right]! - summed[top * stride + right]! -
        summed[bottom * stride + left]! + summed[top * stride + left]!) === 0) return true;
    return shipHullFitsSea(world, sea, point);
  };
};

/** A summed-area table makes complete cardinal hull and turning-clearance masks cheap to build once. */
export const createShipClearanceMasks = (world: WorldData, sea: Uint8Array) => {
  const stride = world.cellsX + 1, summed = new Uint32Array(stride * (world.cellsZ + 1));
  for (let z = 1; z <= world.cellsZ; z++) for (let x = 1; x <= world.cellsX; x++) {
    summed[z * stride + x] = Number(!sea[(z - 1) * world.cellsX + x - 1]) +
      summed[(z - 1) * stride + x]! + summed[z * stride + x - 1]! - summed[(z - 1) * stride + x - 1]!;
  }
  const mask = (radiusX: number, radiusZ: number) => {
    const result = new Uint8Array(sea.length);
    for (let z = radiusZ; z < world.cellsZ - radiusZ; z++)
      for (let x = radiusX; x < world.cellsX - radiusX; x++) {
        const left = x - radiusX, right = x + radiusX + 1, top = z - radiusZ, bottom = z + radiusZ + 1;
        const dry = summed[bottom * stride + right]! - summed[top * stride + right]! -
          summed[bottom * stride + left]! + summed[top * stride + left]!;
        if (!dry) result[z * world.cellsX + x] = 1;
      }
    return result;
  };
  return { parallelZ: mask(Math.ceil(SAILING_SHIP_HULL_BEAM / 2), Math.ceil(SAILING_SHIP_HULL_LENGTH / 2)),
    parallelX: mask(Math.ceil(SAILING_SHIP_HULL_LENGTH / 2), Math.ceil(SAILING_SHIP_HULL_BEAM / 2)),
    turning: mask(Math.ceil(SAILING_SHIP_TURN_RADIUS), Math.ceil(SAILING_SHIP_TURN_RADIUS)),
    hullFitsSea: createSummedHullFit(world, sea, summed) };
};
