import { type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { countSurfaceCrossings, sourceClothContactCoverage, type SurfaceCrossingWitness,
  uniqueMeshEdges } from "./source-cloth-coverage";
import { type ClothFitCell, clothPosePoints, prepareClothPose } from "./source-cloth-weight-contacts";
import { createClothWeightGroups } from "./source-cloth-weight-groups";

/** A zero-optimization control: grouping and writing must preserve the actual donor baseline. */
export const auditClothWeightBaseline = (body: SkinnedMesh, original: SkinnedMesh,
  cells: readonly ClothFitCell[], owned: ReadonlySet<number>, reference: readonly Vector3[], hipsX: number,
  costumeIndices: number[], legIndices: number[]) => {
  const { groups, write } = createClothWeightGroups(body, owned, reference, hipsX);
  const vertices = [...new Set([...costumeIndices, ...legIndices])];
  const costumeEdges = uniqueMeshEdges(costumeIndices), legEdges = uniqueMeshEdges(legIndices);
  const skinIndex = body.geometry.getAttribute("skinIndex"), skinWeight = body.geometry.getAttribute("skinWeight");
  const beforeIndex = Array.from(skinIndex.array), beforeWeight = Array.from(skinWeight.array);
  const posed = () => {
    const points: Vector3[] = [];
    for (const vertex of vertices) points[vertex] = body.applyBoneTransform(vertex,
      new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld);
    return points;
  };
  const count = (points: Vector3[], source: TriangleGrid) => {
    const cloth = new TriangleGrid(points, costumeIndices), legs = new TriangleGrid(points, legIndices);
    const forward: SurfaceCrossingWitness[] = [], reverse: SurfaceCrossingWitness[] = [];
    countSurfaceCrossings(points, costumeEdges, legs, forward, 4096);
    countSurfaceCrossings(points, legEdges, cloth, reverse, 4096);
    let exposures = 0;
    for (const witness of forward) if (sourceClothContactCoverage(new Vector3().fromArray(witness.point),
      witness.triangle, legs, source, cloth).newExposure) exposures++;
    for (const witness of reverse) {
      const point = new Vector3().fromArray(witness.point), closest = legs.closestPoint(point, .0001);
      if (!closest) throw new Error("Original baseline crossing lost its leg facet");
      if (sourceClothContactCoverage(point, closest.triangle, legs, source, cloth).newExposure) exposures++;
    }
    return exposures;
  };
  const poses = cells.map(cell => {
    const pose = prepareClothPose(body, original, cell, groups, costumeIndices, legIndices);
    const actual = posed(), predicted = clothPosePoints(pose, groups);
    const maximumPredictionShift = Math.max(...vertices.map(vertex => actual[vertex]!.distanceTo(predicted[vertex]!)));
    return { label: cell.label, before: count(actual, pose.source), predicted: count(predicted, pose.source),
      maximumPredictionShift, beforePoints: actual, source: pose.source };
  });
  write();
  const phases = cells.map((cell, index) => {
    prepareClothPose(body, original, cell, groups, costumeIndices, legIndices);
    const before = poses[index]!, actual = posed();
    return { label: cell.label, before: before.before, predicted: before.predicted,
      after: count(actual, before.source), maximumPredictionShift: before.maximumPredictionShift,
      maximumWrittenShift: Math.max(...vertices.map(vertex => actual[vertex]!.distanceTo(before.beforePoints[vertex]!))) };
  });
  const changedIndices = beforeIndex.filter((value, index) => value !== skinIndex.array[index]).length;
  const changedWeights = beforeWeight.filter((value, index) => value !== skinWeight.array[index]).length;
  return { groups: groups.length, changedIndices, changedWeights,
    maximumBeforeExposures: Math.max(...phases.map(phase => phase.before)),
    maximumPredictedExposures: Math.max(...phases.map(phase => phase.predicted)),
    maximumAfterExposures: Math.max(...phases.map(phase => phase.after)), phases };
};
