import assert from "node:assert/strict";
import { Matrix3, type Matrix4, type SkinnedMesh, Triangle, Vector3, Vector4 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { applyArmourPoseSnapshot, type ArmourPoseSnapshot } from "./armour-pose-snapshot";
import {
  countSurfaceCrossings,
  sourceClothContactCoverage,
  type SurfaceCrossingWitness,
  uniqueMeshEdges,
} from "./source-cloth-coverage";
import type { ClothWeightGroup } from "./source-cloth-weight-groups";

export interface ClothFitCell { diagnostics: ArmourPoseSnapshot; label: string }
export interface ClothFitConstraint {
  bodyTriangle: number;
  coefficients: { group: number; dot: number[] }[];
  label: string;
  sourceCoverDistance: number | undefined;
  support: { vertex: number; share: number }[];
  target: number;
}
export interface PreparedClothPose {
  body: TriangleGrid;
  bindMatrixInverse: Matrix4;
  label: string;
  nativeJointPoints: Vector3[][];
  points: Vector3[];
  seedPoints: Vector3[];
  singleJointPoints: Vector3[][];
  source: TriangleGrid;
  worldMatrix: Matrix4;
}

/** Exact Three.js single-joint matrices; their weighted sum is the real skinned surface. */
export const prepareClothPose = (body: SkinnedMesh, original: SkinnedMesh, cell: ClothFitCell,
  groups: readonly ClothWeightGroup[], costumeIndices: number[], legIndices: number[]): PreparedClothPose => {
  const snapshot = { ...cell.diagnostics, posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") };
  applyArmourPoseSnapshot(body.parent!, snapshot); applyArmourPoseSnapshot(original.parent!, snapshot);
  const points: Vector3[] = [];
  for (const vertex of new Set([...costumeIndices, ...legIndices])) points[vertex] = original.applyBoneTransform(vertex,
    new Vector3().fromBufferAttribute(original.geometry.getAttribute("position"), vertex)).applyMatrix4(original.matrixWorld);
  const outer = body.matrixWorld.clone().multiply(body.bindMatrixInverse);
  const linear = new Matrix3().setFromMatrix4(outer);
  const matrices = body.skeleton.bones.map((bone, joint) => bone.matrixWorld.clone()
    .multiply(body.skeleton.boneInverses[joint]!));
  // Three applies inverse-bind/world translation once, AFTER accumulating joint XYZ. Moving
  // translation into each joint assumes an exact weight sum of one, which Float32 donors lack.
  // Anchor at the native seed and use only the exact linear weight derivatives thereafter.
  const nativeJointPoints = groups.map(group => group.joints.map(joint => {
    const local = new Vector4(group.raw.x, group.raw.y, group.raw.z, 1)
      .applyMatrix4(body.bindMatrix).applyMatrix4(matrices[joint]!);
    return new Vector3(local.x, local.y, local.z);
  }));
  const singleJointPoints = nativeJointPoints.map(points => points.map(point => point.clone().applyMatrix3(linear)));
  const seedPoints = groups.map(group => {
    assert(group.weights.every((value, slot) => value === group.seed[slot]),
      "Prepare the native cloth cache before changing its seed weights");
    const vertex = group.members[0]!;
    return body.applyBoneTransform(vertex,
      new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld);
  });
  return { body: new TriangleGrid(points, legIndices), bindMatrixInverse: body.bindMatrixInverse.clone(),
    label: cell.label, nativeJointPoints, points, singleJointPoints,
    seedPoints, source: new TriangleGrid(points, costumeIndices), worldMatrix: body.matrixWorld.clone() };
};

export const clothPosePoints = (pose: PreparedClothPose, groups: readonly ClothWeightGroup[], seed = false) => {
  const points = [...pose.points];
  groups.forEach((group, id) => {
    const point = new Vector3(), weights = seed ? group.seed : group.weights;
    // Evaluate with the native operation order, not its algebraically equivalent gradient.
    // Even nanometre cancellation differences can flip exact seam coverage rays.
    pose.nativeJointPoints[id]!.forEach((single, slot) => point.addScaledVector(single, weights[slot]!));
    point.applyMatrix4(pose.bindMatrixInverse).applyMatrix4(pose.worldMatrix);
    group.members.forEach(vertex => { points[vertex] = point; });
  });
  return points;
};

export const createClothContactEvaluator = (costumeIndices: number[], legIndices: number[],
  groups: readonly ClothWeightGroup[], byVertex: ReadonlyMap<number, number>) => {
  const costumeEdges = uniqueMeshEdges(costumeIndices), legEdges = uniqueMeshEdges(legIndices);
  return (pose: PreparedClothPose) => {
    const points = clothPosePoints(pose, groups), grid = new TriangleGrid(points, costumeIndices);
    const edges: SurfaceCrossingWitness[] = [], reverse: SurfaceCrossingWitness[] = [];
    countSurfaceCrossings(points, costumeEdges, pose.body, edges, 4096);
    countSurfaceCrossings(points, legEdges, grid, reverse, 4096);
    const constraints: ClothFitConstraint[] = [];
    let newExposures = 0;
    const add = (point: Vector3, bodyTriangle: number, support: { vertex: number; share: number }[]) => {
      const coverage = sourceClothContactCoverage(point, bodyTriangle, pose.body, pose.source, grid);
      if (!coverage.newExposure) return;
      newExposures++;
      const normal = pose.body.corner(bodyTriangle, 1).clone().sub(pose.body.corner(bodyTriangle, 0))
        .cross(pose.body.corner(bodyTriangle, 2).clone().sub(pose.body.corner(bodyTriangle, 0))).normalize();
      const coefficients = new Map<number, number>();
      let fixed = 0;
      for (const { share, vertex } of support) {
        const id = byVertex.get(vertex);
        if (id === undefined) { fixed += share * points[vertex]!.dot(normal); continue; }
        coefficients.set(id, (coefficients.get(id) ?? 0) + share);
        const offset = pose.seedPoints[id]!.clone();
        pose.singleJointPoints[id]!.forEach((single, slot) => offset.addScaledVector(single, -groups[id]!.seed[slot]!));
        fixed += share * offset.dot(normal);
      }
      constraints.push({ bodyTriangle, label: pose.label, sourceCoverDistance: coverage.sourceCoverDistance,
        support, target: point.dot(normal) + .0015 - fixed,
        coefficients: [...coefficients].map(([group, share]) => ({ group,
          dot: pose.singleJointPoints[group]!.map(point => share * point.dot(normal)) })) });
    };
    for (const witness of edges) {
      const point = new Vector3().fromArray(witness.point), [a, b] = witness.edge;
      const direction = points[b]!.clone().sub(points[a]!);
      const share = point.clone().sub(points[a]!).dot(direction) / direction.lengthSq();
      add(point, witness.triangle, [{ vertex: a, share: 1 - share }, { vertex: b, share }]);
    }
    const triangle = new Triangle(), bary = new Vector3();
    for (const witness of reverse) {
      const point = new Vector3().fromArray(witness.point), closest = pose.body.closestPoint(point, .0001);
      assert(closest);
      const vertices = costumeIndices.slice(witness.triangle * 3, witness.triangle * 3 + 3);
      triangle.set(...vertices.map(vertex => points[vertex]!) as [Vector3, Vector3, Vector3]);
      assert(triangle.getBarycoord(point, bary));
      add(point, closest.triangle, vertices.map((vertex, corner) => ({ vertex, share: bary.getComponent(corner) })));
    }
    const seed = clothPosePoints(pose, groups, true);
    const maximumShift = Math.max(...groups.map(group => points[group.members[0]!]!.distanceTo(seed[group.members[0]!]!)));
    return { constraints, maximumShift, newExposures };
  };
};
