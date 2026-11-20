import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Vector3 } from "three";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { clothPosePoints, createClothContactEvaluator, type PreparedClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";

/** Identify the actual original cloth occluder lost at each regression ray. The intersecting
 * cloth face can be unchanged source geometry; repairing it would target the wrong ownership. */
export const auditSourceClothCover = async (context: {
  costumeIndices: number[]; legIndices: number[]; output: string; poses: Iterable<PreparedClothPose>;
  reference: ArmourBody; skin: ReturnType<typeof createClothWeightGroups>;
}) => {
  const { costumeIndices, legIndices, output, poses, reference, skin } = context;
  const evaluate = createClothContactEvaluator(costumeIndices, legIndices, skin.groups, skin.byVertex);
  const records = [...poses].map(pose => {
    const points = clothPosePoints(pose, skin.groups), value = evaluate(pose);
    return { label: pose.label, newExposures: value.newExposures, witnesses: value.constraints.map(constraint => {
      const point = new Vector3();
      for (const { share, vertex } of constraint.support) point.addScaledVector(points[vertex]!, share);
      const normal = pose.body.corner(constraint.bodyTriangle, 1).clone().sub(pose.body.corner(constraint.bodyTriangle, 0))
        .cross(pose.body.corner(constraint.bodyTriangle, 2).clone().sub(pose.body.corner(constraint.bodyTriangle, 0))).normalize();
      const hit = pose.source.raycast(point.clone().addScaledVector(normal, .0001), normal, .00002, .25);
      return { contactVertices: constraint.support, bodyTriangle: constraint.bodyTriangle,
        point: point.toArray(), sourceCoverTriangle: hit?.triangle, sourceCoverDistance: hit?.distance,
        sourceCoverVertices: hit && costumeIndices.slice(hit.triangle * 3, hit.triangle * 3 + 3).map(vertex => {
          const group = skin.groups[skin.byVertex.get(vertex)!];
          return { vertex, group: skin.byVertex.get(vertex), aliases: group?.members,
            originalJoints: reference.surface.joints[vertex], originalWeights: reference.surface.weights[vertex],
            candidateJoints: group?.joints, candidateWeights: group?.weights };
        }) };
    }) };
  });
  await writeFile(resolve(output, "source-cloth-r-cover-audit.json"), JSON.stringify({ records,
    scope: "Read-only source normal-ray occluder identity; exact existing coverage tolerances unchanged; no candidate/source mutation." }, null, 2));
  console.log(JSON.stringify(records.map(record => ({ label: record.label, newExposures: record.newExposures,
    sourceCovers: record.witnesses.map(witness => witness.sourceCoverVertices?.map(vertex => vertex.vertex)) }))));
};
