import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Triangle, Vector3 } from "three";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { skinningMatrices } from "../../../island-of-settlers-worker-generation/src/retarget/cloth-cover";
import { createRestPose, toWorldPose } from "../../../island-of-settlers-worker-generation/src/retarget/rig-pose";
import { clothPosePoints, type PreparedClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";
import { sourceClothWeightVertices } from "./source-cloth-weight-polytope";

/** Restricted physical-crossing certificate; this explicitly does NOT certify the complete
 * source normal-ray gate infeasible, because another garment sheet could still provide cover. */
export const inspectSourceClothAffineObstruction = async (output: string, poses: Iterable<PreparedClothPose>,
  skin: ReturnType<typeof createClothWeightGroups>, reference: ArmourBody, legIndices: number[]) => {
  const free = 6522, fixed = 6656, id = skin.byVertex.get(free)!, group = skin.groups[id]!;
  const original = new Map<number, number>();
  reference.surface.joints[free]!.forEach((joint, slot) => original.set(joint,
    (original.get(joint) ?? 0) + reference.surface.weights[free]![slot]!));
  // Expanding the trust radius1ppm and requiring micrometre margins makes the certificate
  // conservative with respect to normalized Float32 rounding, never a relaxed acceptance gate.
  const weights = sourceClothWeightVertices(group.joints.map(joint => original.get(joint) ?? 0), .350001);
  const restGrid = new TriangleGrid(reference.points, legIndices);
  const restDirection = reference.points[fixed]!.clone().sub(reference.points[free]!);
  const restLength = restDirection.length(); restDirection.divideScalar(restLength);
  const restHit = restGrid.raycast(reference.points[free]!, restDirection, .0002, restLength - .0002);
  const restMatrices = skinningMatrices(reference.surface,
    toWorldPose(reference.skeleton, createRestPose(reference.skeleton)));
  let restCertificate: Record<string, unknown> = { crossingDetected: false,
    sourceEdge: [reference.points[free]!.toArray(), reference.points[fixed]!.toArray()],
    scope: "No crossing detected in the literal source bind geometry with the unchanged native edge/triangle predicate." };
  if (restHit) {
    const corners = [0, 1, 2].map(corner => restGrid.corner(restHit.triangle, corner));
    const normal = corners[1]!.clone().sub(corners[0]!).cross(corners[2]!.clone().sub(corners[0]!)).normalize();
    const plane = normal.dot(corners[0]!), facet = new Triangle(...corners as [Vector3, Vector3, Vector3]);
    const freeCloud = restMatrices.map(matrix => reference.surface.positions[free]!.clone().applyMatrix4(matrix));
    const fixedCloud = restMatrices.map(matrix => reference.surface.positions[fixed]!.clone().applyMatrix4(matrix));
    const freeSigns = freeCloud.map(point => normal.dot(point) - plane);
    const fixedSigns = fixedCloud.map(point => normal.dot(point) - plane);
    let minimumBarycentric = Infinity;
    for (const a of freeCloud) for (const b of fixedCloud) {
      const direction = a.clone().sub(b), intersection = b.clone()
        .addScaledVector(direction, -(normal.dot(b) - plane) / normal.dot(direction));
      const bary = facet.getBarycoord(intersection, new Vector3())!;
      minimumBarycentric = Math.min(minimumBarycentric, bary.x, bary.y, bary.z);
    }
    const freeRange = [Math.min(...freeSigns), Math.max(...freeSigns)];
    const fixedRange = [Math.min(...fixedSigns), Math.max(...fixedSigns)];
    const opposite = (freeRange[0]! > 1e-6 && fixedRange[1]! < -1e-6)
      || (fixedRange[0]! > 1e-6 && freeRange[1]! < -1e-6);
    restCertificate = { crossingDetected: true, bodyTriangle: restHit.triangle,
      sourceEdge: [reference.points[free]!.toArray(), reference.points[fixed]!.toArray()],
      intersection: reference.points[free]!.clone().addScaledVector(restDirection, restHit.distance).toArray(),
      freeAllRigJointSignedRange: freeRange, fixedAllRigJointSignedRange: fixedRange,
      originalRigJoints: restMatrices.length, minimumBarycentricAcrossAllJointPairs: minimumBarycentric,
      physicalRestCrossingUnavoidableForAnyNormalizedSkinWeights: opposite && minimumBarycentric > .0001,
      scope: "Literal source bind/rest geometry already crosses actual leg. Every normalized skin choice lies in its endpoint joint-transform convex hull. This is an inherited physical crossing, NOT proof that the relative no-new-coverage gate is impossible." };
  }
  const records = [];
  for (const pose of poses) {
    if (!pose.label.includes("blend-0.875") && !pose.label.includes("run/1")) continue;
    const points = clothPosePoints(pose, skin.groups), delta = points[fixed]!.clone().sub(points[free]!);
    const distance = delta.length(), hit = pose.body.raycast(points[free]!, delta.divideScalar(distance), .0002, distance - .0002);
    if (!hit) continue;
    const corners = [0, 1, 2].map(corner => pose.body.corner(hit.triangle, corner));
    const normal = corners[1]!.clone().sub(corners[0]!).cross(corners[2]!.clone().sub(corners[0]!)).normalize();
    const plane = normal.dot(corners[0]!), anchor = points[fixed]!, fixedSigned = normal.dot(anchor) - plane;
    const reach = weights.map(weights => {
      const point = new Vector3();
      pose.nativeJointPoints[id]!.forEach((joint, slot) => point.addScaledVector(joint, weights[slot]!));
      return point.applyMatrix4(pose.bindMatrixInverse).applyMatrix4(pose.worldMatrix);
    });
    const signed = reach.map(point => normal.dot(point) - plane);
    const oppositePlaneSide = (fixedSigned < -1e-6 && Math.min(...signed) > 1e-6)
      || (fixedSigned > 1e-6 && Math.max(...signed) < -1e-6);
    const facet = new Triangle(...corners as [Vector3, Vector3, Vector3]);
    const projections = reach.map(point => {
      const across = point.clone().sub(anchor), fraction = -fixedSigned / normal.dot(across);
      const intersection = anchor.clone().addScaledVector(across, fraction), bary = new Vector3();
      facet.getBarycoord(intersection, bary);
      return { point: intersection.toArray(), bary: bary.toArray(), fraction };
    });
    const minimumBary = Math.min(...projections.flatMap(value => value.bary));
    records.push({ pose: pose.label, edge: [free, fixed], bodyTriangle: hit.triangle,
      fixedSignedPlaneDistance: fixedSigned, currentFreeSignedPlaneDistance: normal.dot(points[free]!) - plane,
      freeSignedReachableRange: [Math.min(...signed), Math.max(...signed)], weightPolytopeVertices: weights.length,
      oppositePlaneSideForEntireTrustRegion: oppositePlaneSide, minimumProjectedBodyBarycentric: minimumBary,
      physicalEdgeFacetCrossingProvedUnavoidable: oppositePlaneSide && minimumBary > .0001,
      currentBodyIntersection: points[free]!.clone().addScaledVector(delta, hit.distance).toArray(), projections });
  }
  await writeFile(resolve(output, "source-cloth-affine-edge-certificate.json"), JSON.stringify({ records, restCertificate,
    freeVertex: free, fixedVertex: fixed, jointNames: group.joints.map(joint =>
      reference.skeleton.names[reference.surface.jointNodes[joint]!]!), weightPolytope: weights,
    proofScope: "All normalized weights in the current four-joint palette within original0.35 L1 trust radius, expanded conservatively. Ignores20mm shift cap, so a proved crossing also holds under that stricter cap. Convex perspective projection keeps the entire reachable edge/body-plane intersection inside the body facet when all projected hull vertices have positive barycentric margins.",
    doesNotProveCompleteCoverageGateImpossible: true, geometryAndSourceUnchanged: true }, null, 2));
  console.log(JSON.stringify(records.map(({ projections: _projections, ...record }) => record)));
  console.log(JSON.stringify({ restCertificate }));
};
