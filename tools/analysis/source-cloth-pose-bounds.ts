import assert from "node:assert/strict";
import type { SkinnedMesh } from "three";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { applyArmourPoseSnapshot, type ArmourPoseSnapshot } from "./armour-pose-snapshot";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";

/** Native all-pose bounds, including the tiny normalized-source seed offset. Compute that
 * offset directly instead of charging a preexisting K displacement twice in a new source solve. */
export const measureSourceClothPoseBounds = (context: {
  body: SkinnedMesh; cells: readonly { diagnostics: ArmourPoseSnapshot }[]; fields: ReadonlyMap<number, number[]>;
  ids: readonly number[]; originalBody: SkinnedMesh; reference: ArmourBody;
  skin: ReturnType<typeof createClothWeightGroups>; sourceControls?: ReadonlySet<number>;
}) => {
  const { body, cells, fields, ids, originalBody, reference, skin, sourceControls } = context;
  const pairBounds = new Map<string, number>(), baselineShift = new Map<number, number>();
  const fieldShift = new Map<number, number>(), sourceMismatch = new Map<number, number>();
  const index = body.geometry.getAttribute("skinIndex"), weight = body.geometry.getAttribute("skinWeight");
  const sourceWeights = new Map<number, number[]>();
  for (const id of sourceControls ?? []) {
    const group = skin.groups[id]!, raw = new Map<number, number>();
    reference.surface.joints[group.members[0]!]!.forEach((joint, slot) => raw.set(joint,
      (raw.get(joint) ?? 0) + reference.surface.weights[group.members[0]!]![slot]!));
    assert([...raw].every(([joint, value]) => value === 0 || group.joints.includes(joint)),
      "A source trust solve cannot silently discard an original nonzero influence");
    const total = [...raw.values()].reduce((sum, value) => sum + value, 0);
    sourceWeights.set(id, group.joints.map(joint => (raw.get(joint) ?? 0) / total));
  }
  for (const cell of cells) {
    const snapshot = { ...cell.diagnostics, posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") };
    applyArmourPoseSnapshot(body.parent!, snapshot); applyArmourPoseSnapshot(originalBody.parent!, snapshot);
    for (const id of ids) {
      const group = skin.groups[id]!, vertex = group.members[0]!;
      const beforeIndices = [0, 1, 2, 3].map(slot => index.getComponent(vertex, slot));
      const beforeWeights = [0, 1, 2, 3].map(slot => weight.getComponent(vertex, slot));
      const baseline = body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
      const source = originalBody.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(originalBody.matrixWorld);
      baselineShift.set(id, Math.max(baselineShift.get(id) ?? 0, baseline.distanceTo(source)));
      for (const [values, target] of [[fields.get(id), fieldShift], [sourceWeights.get(id), sourceMismatch]] as const) {
        if (!values) continue;
        weight.setXYZW(vertex, ...values as [number, number, number, number]);
        const proposed = body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
        target.set(id, Math.max(target.get(id) ?? 0, proposed.distanceTo(source)));
        weight.setXYZW(vertex, ...beforeWeights as [number, number, number, number]);
      }
      const points = group.joints.map(joint => {
        index.setXYZW(vertex, joint, 0, 0, 0); weight.setXYZW(vertex, 1, 0, 0, 0);
        return body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
      });
      index.setXYZW(vertex, ...beforeIndices as [number, number, number, number]);
      weight.setXYZW(vertex, ...beforeWeights as [number, number, number, number]);
      for (let a = 0; a < points.length; a++) for (let b = 0; b < points.length; b++) {
        const key = `${id}/${a}/${b}`;
        pairBounds.set(key, Math.max(pairBounds.get(key) ?? 0, points[a]!.distanceTo(points[b]!)));
      }
    }
  }
  return { baselineShift, fieldShift, pairBounds, sourceMismatch };
};
