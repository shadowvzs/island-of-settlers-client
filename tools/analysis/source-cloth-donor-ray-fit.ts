import { Vector3 } from "three";

import { closestClothRayTriangle, solveConnectedClothRays } from "./source-cloth-ray-triangle";

export interface DonorRayCorner { group: number; base: Vector3; delta: Vector3; basis?: Vector3[] }
export interface DonorRayConstraint {
  alternatives?: DonorRayCorner[][];
  alternativeSourceVertices?: number[][];
  sourceVertices?: number[];
  origin: Vector3;
  direction: Vector3;
  length: number;
  corners: DonorRayCorner[];
  target?: boolean;
}

/** One scalar per source cloth vertex, within its original-to-covered-body donor skin hull.
 * The original triangle's moving contact is solved exactly; no frozen barycentric planes. */
export const fitSourceClothDonorRays = (groups: number, constraints: DonorRayConstraint[], limit = 1200) =>
  solveConnectedClothRays(Array.from({ length: groups }, () => [[0], [1]]), Array.from({ length: groups }, () => 1), factors => {
    const gradient = Array.from({ length: groups }, () => 0);
    let objective = 0, maximum = 0;
    for (const constraint of constraints) {
      const points = constraint.corners.map(corner => corner.base.clone()
        .addScaledVector(corner.delta, corner.group >= 0 ? factors[corner.group]! : 0));
      const result = closestClothRayTriangle(constraint.origin, constraint.direction, constraint.length, points, .00001);
      const priority = constraint.target ? 4 : 1;
      objective += result.distanceSquared * priority; maximum = Math.max(maximum, result.distanceSquared);
      for (const [index, corner] of constraint.corners.entries()) if (corner.group >= 0)
        gradient[corner.group]! += 2 * priority * result.bary[index]! * result.residual.dot(corner.delta);
    }
    return { gradient, maximumDistance: Math.sqrt(maximum), objective };
  }, limit);

/** Full four-source-bone trust hull for cases where one donor interpolation line is insufficient. */
export const fitSourceClothBoneRays = (corners: number[][][], seed: number[], constraints: DonorRayConstraint[], limit = 1600) =>
  solveConnectedClothRays(corners, seed, weights => evaluateSourceClothBoneRays(weights, constraints), limit);

/** Read-only residual audit also distinguishes the eight target contacts from preservation constraints. */
export const evaluateSourceClothBoneRays = (weights: readonly number[], constraints: DonorRayConstraint[]) => {
    const gradient = weights.map(() => 0);
    let objective = 0, maximum = 0;
    const targets: Array<{ distance: number; sourceVertices?: number[]; activeSourceVertices?: number[] }> = [];
    let maximumPreservationDistance = 0;
    for (const constraint of constraints) {
      const contact = (corners: DonorRayCorner[]) => {
        const points = corners.map(corner => corner.group < 0 ? corner.base :
          corner.basis!.reduce((sum, point, slot) => sum.addScaledVector(point,
            weights[corner.group * 4 + slot]!), new Vector3()));
        return closestClothRayTriangle(constraint.origin, constraint.direction, constraint.length, points, .00001);
      };
      let corners = constraint.corners, result = contact(corners), activeSourceVertices = constraint.sourceVertices;
      // A bending surface may transfer a ray from one actual source face to its neighbour.
      // The unchanged final whole-surface ray census remains the acceptance gate.
      for (const [index, alternative] of (constraint.alternatives ?? []).entries()) {
        const candidate = contact(alternative);
        if (candidate.distanceSquared >= result.distanceSquared) continue;
        corners = alternative; result = candidate;
        activeSourceVertices = constraint.alternativeSourceVertices?.[index];
      }
      if (constraint.target) targets.push({ distance: Math.sqrt(result.distanceSquared),
        sourceVertices: constraint.sourceVertices, activeSourceVertices });
      else maximumPreservationDistance = Math.max(maximumPreservationDistance, Math.sqrt(result.distanceSquared));
      const priority = constraint.target ? 4 : 1;
      objective += result.distanceSquared * priority; maximum = Math.max(maximum, result.distanceSquared);
      for (const [index, corner] of corners.entries()) if (corner.group >= 0)
        for (let slot = 0; slot < 4; slot++) gradient[corner.group * 4 + slot]! +=
          2 * priority * result.bary[index]! * result.residual.dot(corner.basis![slot]!);
    }
    return { gradient, maximumDistance: Math.sqrt(maximum), maximumPreservationDistance, objective, targets };
  };
