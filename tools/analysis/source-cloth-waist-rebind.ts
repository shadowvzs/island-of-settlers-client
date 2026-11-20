import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import type { PreparedClothPose } from "./source-cloth-weight-contacts";
import { createClothContactEvaluator } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";

export const rebindSourceClothWaist = async (context: {
  baselineShift: ReadonlyMap<number, number>; boundary: ReadonlySet<number>; costumeIndices: number[];
  fieldShift: ReadonlyMap<number, number>; fields: ReadonlyMap<number, number[]>; legIndices: number[];
  original: readonly number[][]; output: string; poses: ReadonlyMap<string, PreparedClothPose>;
  profile: any; reference: ArmourBody; skin: ReturnType<typeof createClothWeightGroups>;
}) => {
  const { baselineShift, boundary, costumeIndices, fields, fieldShift, legIndices,
    original, output, poses, profile, reference, skin } = context;
  const front = process.argv.includes("--front-waist");
  const adjacentOnly = process.argv.includes("--adjacent-only");
  const ids = [...fields.keys()], adjacent = ids.length > 1;
  const active = [...poses.values()].filter(pose => (adjacentOnly && !pose.label.includes("attack/61/72")) || front || pose.label.includes("run/12/32")
    || pose.label.includes("run/13/32") || pose.label.includes("blend-0.875"));
  const evaluate = createClothContactEvaluator(costumeIndices, legIndices, skin.groups, skin.byVertex);
  const controls = ids.map(id => {
    const group = skin.groups[id]!, source = new Map<number, number>();
    reference.surface.joints[group.members[0]!]!.forEach((joint, slot) => source.set(joint,
      (source.get(joint) ?? 0) + reference.surface.weights[group.members[0]!]![slot]!));
    const total = [...source.values()].reduce((sum, weight) => sum + weight, 0);
    const baselineDelta = group.joints.reduce((sum, joint, slot) => sum
      + Math.abs(original[id]![slot]! - (source.get(joint) ?? 0) / total), 0);
    const directionDelta = fields.get(id)!.reduce((sum, weight, slot) => sum
      + Math.abs(weight - original[id]![slot]!), 0);
    const baseline = baselineShift.get(id)!, proposed = fieldShift.get(id)!;
    let maximum = Math.min(1, (.34999 - baselineDelta) / Math.max(1e-12, directionDelta));
    if (proposed > baseline) maximum = Math.min(maximum, (.01989 - baseline) / (proposed - baseline));
    maximum = Math.max(0, maximum);
    return { id, vertices: group.members, sourceJoints: group.joints,
      sourceJointNames: group.joints.map(joint => reference.skeleton.names[reference.surface.jointNodes[joint]!]!),
      before: original[id], field: fields.get(id), baselineDelta, directionDelta,
      fullFieldPoseShift: proposed, maximum };
  });
  const tested: { fractions: number[]; counts: number[] }[] = [];
  const test = (fractions: number[]) => {
    controls.forEach((control, at) => {
      const group = skin.groups[control.id]!;
      group.weights = original[control.id]!.map((weight, slot) => skin.quantizeWeight(weight
        + (fields.get(control.id)![slot]! - weight) * control.maximum * fractions[at]!));
    });
    for (const id of boundary) if (!fields.has(id)) assert.deepEqual(skin.groups[id]!.weights, original[id]);
    const counts = active.map(pose => evaluate(pose).newExposures);
    tested.push({ fractions: [...fractions], counts }); return counts.every(count => count === 0);
  };
  let solution: number[] | undefined;
  const steps = [1, .875, .75, .625, .5, .375, .25, .125, 0];
  if (!adjacent || front) {
    // Front anchors share one coherent body-field trajectory. Guard all solved right/left
    // witnesses; do not enumerate independent arbitrary anchor-weight combinations.
    for (const fraction of steps) if (test(ids.map(() => fraction))) { solution = ids.map(() => fraction); break; }
  } else {
    // The adjacent group is enabled only by the parent's explicit conditional approval,
    // after the one-anchor attempt. This is a bounded2D source-field trajectory, not global fitting.
    for (const first of steps) {
      for (const second of [1, .75, .5, .25, 0]) if (test([first, second])) {
        solution = [first, second]; break;
      }
      if (solution) break;
    }
  }
  if (solution) {
    let low = 0, high = 1;
    for (let step = 0; step < 12; step++) {
      const fraction = (low + high) / 2;
      if (test(solution.map(value => value * fraction))) high = fraction;
      else low = fraction;
    }
    solution = solution.map(value => value * high); assert(test(solution));
  } else ids.forEach(id => { skin.groups[id]!.weights = [...original[id]!]; });
  let name = adjacent ? "o" : "n";
  if (front) name = process.argv.includes("--front-triangle") ? "t" : "s";
  if (adjacentOnly) name = "w";
  if (solution) await writeFile(resolve(output, `source-cloth-waist-${name}-profile.json`), JSON.stringify({ ...profile,
    records: [], scope: "Explicitly authorized bounded canonical waist skin rebind; ORIGINAL rest geometry/rig unchanged; full and NEW independent validation REQUIRED",
    fittedProfile: { solved: false, targetedRightWaistPass: true, targetedFrontWaistPass: front, fullMatrixValidated: false,
      weights: skin.groups.map(group => ({ vertices: group.members, joints: group.joints,
        jointNames: group.joints.map(joint => reference.skeleton.names[reference.surface.jointNodes[joint]!]!),
        weights: group.weights })) } }, null, 2));
  await writeFile(resolve(output, `source-cloth-waist-${name}-analysis.json`), JSON.stringify({ complete: Boolean(solution),
    authorizedBoundaryException: controls.filter(control => boundary.has(control.id)).map(control => control.vertices),
    protectedOtherBoundaryGroups: boundary.size - ids.filter(id => boundary.has(id)).length,
    exactRestGeometryPreserved: true, actualBodyVariables: 0, controls, tested, solution,
    diagnosticAllPoses: [...poses.values()].map(pose => ({ label: pose.label, newExposures: evaluate(pose).newExposures })),
    scope: front ? "Parent explicitly authorized699+3878 front binding exception. Canonical actual-body field projected onto unchanged original four-joint palettes.6656+left solutions frozen; other12 original waist pins unchanged. Original0.35 L1/20mm caps unchanged; no source/model/runtime writes."
      : "Parent explicitly authorized original6656 binding correction;6655/6649 only if needed. Same existing four skin slots and rig, original0.35 L1/20mm caps conservatively retained. Exact no-new-coverage evaluator unchanged. No source/model/runtime writes." }, null, 2));
  console.log(JSON.stringify({ waistRebind: name, complete: Boolean(solution), controls, solution,
    queries: tested.length, best: Math.min(...tested.map(value => value.counts.reduce((sum, value) => sum + value, 0))) }));
  return Boolean(solution);
};
