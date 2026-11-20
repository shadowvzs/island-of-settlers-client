import assert from "node:assert/strict";
import { type SkinnedMesh, Vector3 } from "three";

import { type ClothFitCell, type ClothFitConstraint, createClothContactEvaluator,
  prepareClothPose } from "./source-cloth-weight-contacts";
import { createClothWeightGroups } from "./source-cloth-weight-groups";
import { clothSupportTransfer } from "./source-cloth-weight-step";

/** Offline, bounded skin-weight fitting only. Source positions/UVs/normals/indices and real
 * anatomy remain immutable; the game still receives ordinary four-joint skin attributes. */
export const fitSourceClothWeights = (body: SkinnedMesh, original: SkinnedMesh, cells: readonly ClothFitCell[],
  owned: ReadonlySet<number>, reference: readonly Vector3[], hipsX: number,
  costumeIndices: number[], legIndices: number[], progress?: (value: unknown) => void,
  initialWeights?: readonly { vertices: number[]; joints: number[]; weights: number[] }[]) => {
  const skin = createClothWeightGroups(body, owned, reference, hipsX);
  const { byVertex, groups, project, quantizeWeight, write } = skin;
  write();
  const evaluate = createClothContactEvaluator(costumeIndices, legIndices, groups, byVertex);
  // Identical High/Minimal body poses share one CPU cache; labels and final native-attribute
  // validation remain explicit in the driver's full quality/weapon matrix.
  const uniqueCells = new Map<string, ClothFitCell>();
  for (const cell of cells) {
    const mesh = cell.diagnostics.posedMeshes.find(mesh => mesh.name === "body")!;
    const key = JSON.stringify({ mesh, skeleton: cell.diagnostics.skeletons[mesh.skeleton] });
    if (!uniqueCells.has(key)) uniqueCells.set(key, cell);
  }
  const poses = [...uniqueCells.values()].map(cell =>
    prepareClothPose(body, original, cell, groups, costumeIndices, legIndices));
  for (const frozen of initialWeights ?? []) {
    const id = byVertex.get(frozen.vertices[0]!); assert(id !== undefined);
    const group = groups[id]!;
    assert.deepEqual(group.members, frozen.vertices);
    assert.deepEqual(group.joints, frozen.joints);
    // Historical profiles contain double-precision clean seeds. Their written Float32 values
    // are the real candidate; importing the unrounded JSON values reintroduces seam-ray drift.
    group.weights = frozen.weights.map(quantizeWeight);
  }
  const training = new Map<string, typeof poses[number]>();
  const scan = () => {
    let maximumNewExposures = 0, maximumPoseShift = 0;
    const failures = [];
    for (const pose of poses) {
      const result = evaluate(pose);
      maximumNewExposures = Math.max(maximumNewExposures, result.newExposures);
      maximumPoseShift = Math.max(maximumPoseShift, result.maximumShift);
      if (result.newExposures) {
        failures.push({ label: pose.label, newExposures: result.newExposures }); training.set(pose.label, pose);
      }
    }
    return { failures, maximumNewExposures, maximumPoseShift };
  };
  const boundPoseShift = (id: number) => {
    const group = groups[id]!;
    let maximum = 0;
    for (const pose of poses) {
      const shift = new Vector3();
      pose.singleJointPoints[id]!.forEach((point, slot) =>
        shift.addScaledVector(point, group.weights[slot]! - group.seed[slot]!));
      maximum = Math.max(maximum, shift.length());
    }
    // The same provisional 20mm gate used by earlier receipts is an optimization constraint,
    // not merely a failed end-of-run report. Keep a Float32 rounding margin inside that bound.
    if (maximum > .01999) {
      group.weights = group.weights.map((weight, slot) => group.seed[slot]!
        + (weight - group.seed[slot]!) * .01999 / maximum);
      project(group);
    }
    return maximum;
  };
  const diagnostics: unknown[] = [];
  const adjust = (constraint: ClothFitConstraint) => {
    const current = constraint.coefficients.reduce((sum, coefficient) => sum + coefficient.dot
      .reduce((value, dot, slot) => value + dot * groups[coefficient.group]!.weights[slot]!, 0), 0);
    const deficit = constraint.target - current;
    if (deficit <= .00001) return false;
    const groupsAdjusted = [];
    let remaining = deficit;
    const blocked = new Set<number>();
    for (let attempt = 0; attempt < constraint.coefficients.length * 4 && remaining > 1e-5; attempt++) {
      const choices = constraint.coefficients.filter(coefficient => !blocked.has(coefficient.group))
        .map(coefficient => ({ coefficient,
          transfer: clothSupportTransfer(groups[coefficient.group]!.weights, coefficient.dot, remaining) }))
        .filter(choice => choice.transfer).sort((a, b) => b.transfer!.gain - a.transfer!.gain);
      const choice = choices[0];
      if (!choice) break;
      const { coefficient } = choice, group = groups[coefficient.group]!;
      const before = coefficient.dot.reduce((sum, dot, slot) => sum + dot * group.weights[slot]!, 0);
      group.weights = choice.transfer!.weights;
      project(group);
      const projectedShift = boundPoseShift(coefficient.group);
      const after = coefficient.dot.reduce((sum, dot, slot) => sum + dot * group.weights[slot]!, 0);
      const improvement = after - before;
      if (improvement < 1e-10) blocked.add(coefficient.group);
      remaining -= improvement;
      groupsAdjusted.push({ group: coefficient.group, vertices: group.members, projectedShift,
        donor: choice.transfer!.donor, recipient: choice.transfer!.recipient, improvement });
    }
    if (diagnostics.length < 32) {
      const after = constraint.coefficients.reduce((sum, coefficient) => sum + coefficient.dot
        .reduce((value, dot, slot) => value + dot * groups[coefficient.group]!.weights[slot]!, 0), 0);
      const maximumSupport = constraint.coefficients.reduce((sum, coefficient) => sum + Math.max(...coefficient.dot), 0);
      diagnostics.push({ pose: constraint.label, bodyTriangle: constraint.bodyTriangle,
        clothSupport: constraint.support, sourceCoverDistance: constraint.sourceCoverDistance,
        target: constraint.target, current, deficit,
        postProjectionDeficit: constraint.target - after, unconstrainedSimplexSupport: maximumSupport,
        unreachableClearance: maximumSupport < constraint.target, groups: groupsAdjusted });
    }
    return remaining < deficit - 1e-10;
  };
  const initial = scan(), passes = [];
  let complete = initial;
  let best = initial, bestWeights = groups.map(group => [...group.weights]);
  const accumulated = new Map<string, ClothFitConstraint>();
  const witnessCount = (result: typeof initial) => result.failures
    .reduce((sum, failure) => sum + failure.newExposures, 0);
  const regresses = (result: typeof initial, reference: typeof initial) =>
    result.maximumNewExposures > reference.maximumNewExposures
    || (result.maximumNewExposures === reference.maximumNewExposures && witnessCount(result) > witnessCount(reference));
  for (let pass = 0; pass < 12 && complete.maximumNewExposures > 0; pass++) {
    for (const pose of training.values()) for (const constraint of evaluate(pose).constraints) {
      const key = `${constraint.label}/${constraint.bodyTriangle}/${constraint.support
        .map(value => `${value.vertex}:${Math.round(value.share * 1000)}`).join(",")}`;
      accumulated.set(key, constraint);
    }
    // Retain solved separating planes: dropping a witness as soon as it clears lets the next
    // pose undo that correction and drove the old fitter into oscillating exposures.
    const constraints = [...accumulated.values()];
    const beforeWeights = groups.map(group => [...group.weights]);
    let adjustments = 0;
    for (let sweep = 0; sweep < 4; sweep++) for (const constraint of constraints)
      if (adjust(constraint)) adjustments++;
    const trained = [...training.values()].map(pose => ({ label: pose.label, ...evaluate(pose) }));
    const maximumTrainingExposures = Math.max(0, ...trained.map(result => result.newExposures));
    complete = scan();
    if (regresses(complete, best)) {
      const proposed = groups.map(group => [...group.weights]);
      for (const fraction of [.5, .25, .125]) {
        groups.forEach((group, id) => {
          group.weights = beforeWeights[id]!.map((weight, slot) =>
            weight + (proposed[id]![slot]! - weight) * fraction);
          project(group); boundPoseShift(id);
        });
        complete = scan();
        if (!regresses(complete, best)) break;
      }
    }
    if (regresses(best, complete)) {
      best = complete; bestWeights = groups.map(group => [...group.weights]);
    }
    const record = { pass, adjustments, constraints: constraints.length,
      maximumTrainingExposures, maximumValidatedExposures: complete.maximumNewExposures };
    passes.push(record); progress?.(record);
    if (!adjustments || regresses(complete, best)) break;
  }
  complete = scan();
  if (regresses(complete, best)) {
    groups.forEach((group, id) => { group.weights = bestWeights[id]!; });
    complete = scan();
  }
  write();
  for (const group of groups) {
    assert(group.weights.every(weight => weight >= 0 && Number.isFinite(weight)));
    assert(Math.abs(group.weights.reduce((sum, value) => sum + value, 0) - 1) < .00001);
  }
  const changed = groups.filter(group => group.weights.some((value, slot) => Math.abs(value - group.seed[slot]!) > 1e-5));
  const maximumWeightDelta = Math.max(0, ...groups.map(group => group.weights
    .reduce((sum, value, slot) => sum + Math.abs(value - group.seed[slot]!), 0)));
  return { ...complete, initialMaximumExposures: initial.maximumNewExposures,
    inputPoseCount: cells.length, distinctCachedPoses: poses.length,
    solved: complete.maximumNewExposures === 0 && complete.maximumPoseShift <= .02,
    maximumWeightDelta, changedGroups: changed.length,
    scope: "Authoring-only projection of real source cloth weights; no geometry/anatomy edit, native visual gate pending",
    diagnostics, passes, weights: groups.map(group => ({ vertices: group.members, joints: group.joints,
      jointNames: group.joints.map(joint => body.skeleton.bones[joint]!.name), weights: group.weights })) };
};
