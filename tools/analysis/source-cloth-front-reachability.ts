import { Vector3 } from "three";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { intersect } from "../../../island-of-settlers-worker-generation/src/retarget/cloth-cover";
import { clothPosePoints, type PreparedClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";
import { sourceClothWeightVertices } from "./source-cloth-weight-polytope";

/** Every source-body-edge / cloth-face event is affine in the single movable cloth vertex.
 * Inspect its exact trust-polytope corners and analytic event intervals, not body-plane pushes. */
export const sourceClothFrontReachability = (pose: PreparedClothPose,
  skin: ReturnType<typeof createClothWeightGroups>, reference: ArmourBody,
  pairBounds: ReadonlyMap<string, number>, baselineShift: ReadonlyMap<number, number>) => {
  const id = skin.byVertex.get(3874)!, group = skin.groups[id]!, points = clothPosePoints(pose, skin.groups);
  const a = points[699]!, b = points[3878]!, origin = points[4856]!;
  const ray = points[4855]!.clone().sub(origin), length = ray.length(); ray.divideScalar(length);
  const raw = new Map<number, number>();
  reference.surface.joints[3874]!.forEach((joint, slot) => raw.set(joint,
    (raw.get(joint) ?? 0) + reference.surface.weights[3874]![slot]!));
  const source = group.joints.map(joint => raw.get(joint) ?? 0);
  const position = (weights: readonly number[]) => {
    const point = new Vector3();
    pose.nativeJointPoints[id]!.forEach((joint, slot) => point.addScaledVector(joint, weights[slot]!));
    return point.applyMatrix4(pose.bindMatrixInverse).applyMatrix4(pose.worldMatrix);
  };
  const geometry = (c: Vector3) => {
    const e1 = b.clone().sub(a), e2 = c.clone().sub(a), h = ray.clone().cross(e2);
    const s = origin.clone().sub(a), q = s.clone().cross(e1), det = e1.dot(h);
    const u = s.dot(h), v = ray.dot(q), t = e2.dot(q);
    const hit = intersect(origin, ray, a, b, c);
    return { values: [det, u, v, det - u - v, t - .0002 * det, (length - .0002) * det - t],
      hit: hit && hit.distance >= .0002 && hit.distance <= length - .0002 ? hit : null, det };
  };
  const proof = sourceClothWeightVertices(source, .350001).map(weights => {
    const result = geometry(position(weights));
    return { weights, det: result.det, hit: result.hit };
  });
  const sameOrientation = proof.every(value => value.det > 1e-10) || proof.every(value => value.det < -1e-10);
  const alwaysCrosses = sameOrientation && proof.every(value => value.hit
    && Math.min(...value.hit.bary) > .0001 && value.hit.distance > .0003 && value.hit.distance < length - .0003);
  const candidates = [];
  for (const weights of sourceClothWeightVertices(source, .34999)) {
    const desired = weights.map(weight => skin.quantizeWeight(Math.max(0, weight)));
    const donors = desired.map((weight, slot) => Math.max(0, group.weights[slot]! - weight));
    const recipients = desired.map((weight, slot) => Math.max(0, weight - group.weights[slot]!));
    const transfers = [];
    let bound = baselineShift.get(id)!;
    for (let step = 0; step < 8; step++) {
      const pairs = donors.flatMap((amount, donor) => recipients.map((needed, recipient) => ({
        amount: Math.min(amount, needed), donor, recipient,
        cost: pairBounds.get(`${id}/${donor}/${recipient}`)! })))
        .filter(value => value.amount > 1e-10).sort((a, b) => a.cost - b.cost);
      const pair = pairs[0]; if (!pair) break;
      donors[pair.donor]! -= pair.amount; recipients[pair.recipient]! -= pair.amount;
      bound += pair.amount * pair.cost; transfers.push(pair);
    }
    if (bound > .0198) continue;
    const c = position(desired), start = geometry(points[3874]!), end = geometry(c), roots = [0, 1];
    start.values.forEach((value, row) => {
      const slope = end.values[row]! - value;
      if (Math.abs(slope) < 1e-15) return;
      const root = -value / slope;
      if (root > 0 && root < 1) roots.push(root);
    });
    roots.sort((a, b) => a - b);
    const fractions = [];
    for (let interval = 1; interval < roots.length; interval++) {
      const fraction = (roots[interval - 1]! + roots[interval]!) / 2;
      if (!geometry(points[3874]!.clone().lerp(c, fraction)).hit) fractions.push(fraction);
    }
    if (!end.hit) fractions.push(1);
    if (fractions.length) candidates.push({ weights: desired, transfers, movementBound: bound, fractions });
  }
  return { id, clothVertices: [699, 3878, 3874], immutableBodyEdge: [4856, 4855],
    sameOrientation, physicalCrossingUnavoidableForEntireCurrentPalette: alwaysCrosses,
    proofVertices: proof, candidates,
    scope: "Exact Moller determinant/barycentric event partition for one garment vertex, source0.35 L1 expanded only for proof. Candidate budget0.34999 and conservative19.8mm movement. No geometry or body mutation." };
};
