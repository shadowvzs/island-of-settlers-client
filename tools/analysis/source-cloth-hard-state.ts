import assert from "node:assert/strict";
import { Vector3 } from "three";

import type { DonorRayCorner } from "./source-cloth-donor-ray-fit";
import { integerClothSimplex } from "./source-cloth-integer-simplex";

export interface ClothMotionCell {
  basis: Vector3[];
  caseIndex: number;
  group: number;
  maximumMotion: number;
  original: Vector3;
  vertex: number;
}

/** Euclidean projection onto a nonnegative four-weight simplex, before exact integer encoding. */
const simplex = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => b - a);
  let sum = 0, threshold = 0;
  for (let at = 0; at < sorted.length; at++) {
    sum += sorted[at]!;
    if (sorted[at]! > (sum - 1) / (at + 1)) threshold = (sum - 1) / (at + 1);
  }
  const result = values.map(value => Math.max(0, value - threshold));
  const total = result.reduce((sum, value) => sum + value, 0);
  return result.map(value => value / total);
};

const pointAt = (basis: readonly Vector3[], weights: readonly number[]) =>
  basis.reduce((sum, point, slot) => sum.addScaledVector(point, weights[slot]!), new Vector3());

/** Every accepted update is already the exact source Uint16 representation and satisfies all
 * original per-vertex/per-pose motion balls. This uses their direct convex intersection, not
 * the older inner polytope approximation. Radial clamping is not a global feasibility proof.
 */
export const createHardClothState = (base: readonly number[], start: readonly number[], motion: readonly ClothMotionCell[]) => {
  assert.equal(base.length % 4, 0);
  assert.equal(start.length, base.length);
  const groups = base.length / 4;
  const baseWeights = Array.from({ length: groups }, (_, group) =>
    integerClothSimplex(base.slice(group * 4, group * 4 + 4)).weights);
  const byGroup = Array.from({ length: groups }, (_, group) => motion.filter(cell => cell.group === group)
    .map(cell => ({ ...cell, basePoint: pointAt(cell.basis, baseWeights[group]!) })));
  for (const cells of byGroup) for (const cell of cells)
    assert(cell.basePoint.distanceTo(cell.original) < cell.maximumMotion - .0001,
      "The exact integer source-support seed must be strictly inside every authorized motion ball");
  const weights = baseWeights.flat(), versions = new Uint32Array(groups);
  const preview = (group: number, proposed: readonly number[]) => {
    const candidate = simplex(proposed), source = baseWeights[group]!;
    let fraction = 1;
    for (const cell of byGroup[group]!) {
      const delta = pointAt(cell.basis, candidate).sub(cell.basePoint);
      const offset = cell.basePoint.clone().sub(cell.original);
      const cap = cell.maximumMotion - .0001;
      if (offset.clone().add(delta).lengthSq() <= cap * cap) continue;
      const a = delta.lengthSq(), b = 2 * offset.dot(delta), c = offset.lengthSq() - cap * cap;
      assert(a > 0 && c < 0);
      const boundary = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      fraction = Math.min(fraction, Math.max(0, boundary));
    }
    const fitted = integerClothSimplex(source.map((value, slot) =>
      value + fraction * (candidate[slot]! - value))).weights;
    for (const cell of byGroup[group]!)
      assert(pointAt(cell.basis, fitted).distanceTo(cell.original) <= cell.maximumMotion,
        "Quantized contact projection exceeded an original per-pose motion bound");
    return fitted;
  };
  const commit = (group: number, fitted: readonly number[]) => {
    assert.deepEqual(integerClothSimplex(fitted).weights, fitted, "Accepted contact weights must already be exact integer-simplex values");
    for (const cell of byGroup[group]!)
      assert(pointAt(cell.basis, fitted).distanceTo(cell.original) <= cell.maximumMotion,
        "An accepted integer step must satisfy every authorized original motion ball");
    const changed = fitted.some((value, slot) => value !== weights[group * 4 + slot]);
    if (changed) {
      fitted.forEach((value, slot) => { weights[group * 4 + slot] = value; });
      versions[group]!++;
    }
    return changed;
  };
  const update = (group: number, proposed: readonly number[]) => commit(group, preview(group, proposed));
  for (let group = 0; group < groups; group++) update(group, start.slice(group * 4, group * 4 + 4));
  const cache = new Map<DonorRayCorner, { version: number; position: Vector3 }>();
  const point = (corner: DonorRayCorner) => {
    if (corner.group < 0) return corner.base;
    const known = cache.get(corner), version = versions[corner.group]!;
    if (known?.version === version) return known.position;
    const position = pointAt(corner.basis!, weights.slice(corner.group * 4, corner.group * 4 + 4));
    cache.set(corner, { position, version });
    return position;
  };
  const motionReport = () => ({
    maximumMotion: Math.max(0, ...motion.map(cell =>
      pointAt(cell.basis, weights.slice(cell.group * 4, cell.group * 4 + 4)).distanceTo(cell.original))),
    maximumRestoredMotion: Math.max(0, ...motion.filter(cell => [137, 151].includes(cell.vertex)).map(cell =>
      pointAt(cell.basis, weights.slice(cell.group * 4, cell.group * 4 + 4)).distanceTo(cell.original))),
    allMotionBoundsSatisfied: motion.every(cell => pointAt(cell.basis,
      weights.slice(cell.group * 4, cell.group * 4 + 4)).distanceTo(cell.original) <= cell.maximumMotion),
  });
  return { commit, motionReport, point, preview, update, weights };
};

export type HardClothState = ReturnType<typeof createHardClothState>;
