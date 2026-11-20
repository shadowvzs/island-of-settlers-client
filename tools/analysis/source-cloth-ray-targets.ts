import assert from "node:assert/strict";
import { Vector3 } from "three";

import { SOURCE_CLOTH_RAY_MINIMUM, SOURCE_CLOTH_RAY_OFFSET } from "./source-cloth-coverage";
import { closestClothRayTriangle } from "./source-cloth-ray-triangle";
import { sourceClothTriangleSeparation } from "./source-cloth-triangle-separation";
import { type ClothFitConstraint, clothPosePoints, type PreparedClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";

interface Target { bodyTriangle: number; direction: Vector3; origin: Vector3; point: Vector3;
  pose: PreparedClothPose; triangles: number[][] }

export const createSourceClothRayTargets = (ids: readonly number[],
  skin: ReturnType<typeof createClothWeightGroups>, costumeIndices: readonly number[]) => {
  const targets: Target[] = [], keys = new Set<string>();
  const fixed = new Map<PreparedClothPose, Vector3[]>();
  const collect = (pose: PreparedClothPose, constraint: ClothFitConstraint) => {
    const actual = clothPosePoints(pose, skin.groups);
    if (!fixed.has(pose)) fixed.set(pose, actual);
    const point = new Vector3();
    for (const { share, vertex } of constraint.support) point.addScaledVector(actual[vertex]!, share);
    const vertices = constraint.support.map(value => value.vertex), triangles = [];
    if (vertices.length === 3) triangles.push(vertices);
    else for (let at = 0; at < costumeIndices.length; at += 3) {
      const face = costumeIndices.slice(at, at + 3);
      if (vertices.every(vertex => face.includes(vertex))) triangles.push(face);
    }
    assert(triangles.length > 0, "Every targeted contact must retain actual original source incident faces");
    const key = `${pose.label}/${constraint.bodyTriangle}/${point.toArray().map(value => Math.round(value * 1e9)).join(",")}`;
    if (keys.has(key)) return; keys.add(key);
    const direction = pose.body.corner(constraint.bodyTriangle, 1).clone().sub(pose.body.corner(constraint.bodyTriangle, 0))
      .cross(pose.body.corner(constraint.bodyTriangle, 2).clone().sub(pose.body.corner(constraint.bodyTriangle, 0))).normalize();
    targets.push({ bodyTriangle: constraint.bodyTriangle, direction,
      origin: point.clone().addScaledVector(direction, SOURCE_CLOTH_RAY_OFFSET + SOURCE_CLOTH_RAY_MINIMUM + 3e-8),
      point, pose, triangles });
  };
  const evaluate = (weights: readonly number[]) => {
    const cached = new Map<PreparedClothPose, Map<number, Vector3>>(), gradient = weights.map(() => 0);
    let objective = 0, maximumDistance = 0;
    for (const target of targets) {
      const { pose } = target;
      if (!cached.has(pose)) cached.set(pose, new Map(ids.map((id, at) => {
        const point = new Vector3();
        pose.nativeJointPoints[id]!.forEach((joint, slot) => point.addScaledVector(joint, weights[at * 4 + slot]!));
        return [id, point.applyMatrix4(pose.bindMatrixInverse).applyMatrix4(pose.worldMatrix)];
      })));
      const position = (vertex: number) => cached.get(pose)!.get(skin.byVertex.get(vertex)!) ?? fixed.get(pose)![vertex]!;
      const candidates = target.triangles.map(vertices => ({ vertices, closest: closestClothRayTriangle(
        target.origin, target.direction, .25 - SOURCE_CLOTH_RAY_MINIMUM - 3e-8, vertices.map(position)) }));
      const selected = candidates.reduce((best, value) => value.closest.distanceSquared < best.closest.distanceSquared ? value : best);
      objective += selected.closest.distanceSquared;
      maximumDistance = Math.max(maximumDistance, Math.sqrt(selected.closest.distanceSquared));
      selected.vertices.forEach((vertex, corner) => {
        const id = skin.byVertex.get(vertex)!, at = ids.indexOf(id);
        if (at < 0) return;
        pose.singleJointPoints[id]!.forEach((derivative, slot) => {
          gradient[at * 4 + slot]! += 2 * selected.closest.bary[corner]! * selected.closest.residual.dot(derivative);
        });
      });
    }
    return { gradient, maximumDistance, objective };
  };
  const separationEvaluate = (weights: readonly number[]) => {
    const pairs = new Map<string, { pose: PreparedClothPose; triangle: number; vertices: number[] }>();
    for (const target of targets) for (const vertices of target.triangles) {
      const key = `${target.pose.label}/${target.bodyTriangle}/${[...vertices].sort((a, b) => a - b).join(",")}`;
      pairs.set(key, { pose: target.pose, triangle: target.bodyTriangle, vertices });
    }
    const score = (weights: readonly number[]) => {
      const cached = new Map<PreparedClothPose, Map<number, Vector3>>();
      let objective = 0, maximumDistance = 0;
      for (const { pose, triangle, vertices } of pairs.values()) {
        if (!cached.has(pose)) cached.set(pose, new Map(ids.map((id, at) => {
          const point = new Vector3();
          pose.nativeJointPoints[id]!.forEach((joint, slot) => point.addScaledVector(joint, weights[at * 4 + slot]!));
          return [id, point.applyMatrix4(pose.bindMatrixInverse).applyMatrix4(pose.worldMatrix)];
        })));
        const cloth = vertices.map(vertex => cached.get(pose)!.get(skin.byVertex.get(vertex)!) ?? fixed.get(pose)![vertex]!);
        const body = [0, 1, 2].map(corner => pose.body.corner(triangle, corner));
        const residual = Math.max(0, .000001 - sourceClothTriangleSeparation(cloth, body).gap);
        objective += residual * residual; maximumDistance = Math.max(maximumDistance, residual);
      }
      return { objective, maximumDistance };
    };
    const value = score(weights), step = 1e-5;
    const gradient = weights.map((_, slot) => {
      const plus = [...weights], minus = [...weights]; plus[slot]! += step; minus[slot]! -= step;
      return (score(plus).objective - score(minus).objective) / (2 * step);
    });
    return { ...value, gradient };
  };
  return { collect, evaluate, separationEvaluate, report: () => targets.map(target => ({ label: target.pose.label,
    bodyTriangle: target.bodyTriangle, bodyPoint: target.point.toArray(), rayOrigin: target.origin.toArray(),
    direction: target.direction.toArray(), originalTriangles: target.triangles })), size: () => targets.length };
};
