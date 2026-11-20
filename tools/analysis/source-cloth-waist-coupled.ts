import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { type ClothHalfspace, solveConnectedClothHalfspaces } from "./source-cloth-connected-halfspace";
import { SOURCE_CLOTH_RAY_MINIMUM, SOURCE_CLOTH_RAY_OFFSET } from "./source-cloth-coverage";
import { createSourceClothRayTargets } from "./source-cloth-ray-targets";
import { solveConnectedClothRays } from "./source-cloth-ray-triangle";
import { createClothContactEvaluator, type PreparedClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";
import { sourceClothWeightVertices } from "./source-cloth-weight-polytope";

export const solveCoupledSourceWaist = async (context: {
  boundary: ReadonlySet<number>; costumeIndices: number[];
  legIndices: number[]; original: readonly number[][]; output: string; pairBounds: ReadonlyMap<string, number>;
  poses: ReadonlyMap<string, PreparedClothPose>; profile: any; reference: ArmourBody;
  skin: ReturnType<typeof createClothWeightGroups>; sourceMismatch: ReadonlyMap<number, number>;
}) => {
  const { boundary, costumeIndices, legIndices, original, output, pairBounds,
    poses, profile, reference, skin, sourceMismatch } = context;
  const rayClearance = process.argv.includes("--ray-clearance");
  const seamFlex = process.argv.includes("--seam-flex");
  let name = rayClearance ? "y" : "x";
  if (seamFlex) name = "z";
  const exactRayPlane = process.argv.includes("--exact-ray-plane");
  if (exactRayPlane) name = "aa";
  const exactRays = process.argv.includes("--exact-rays");
  if (exactRays) name = "ab";
  const separatingAxis = process.argv.includes("--separating-axis");
  if (separatingAxis) name = "ac";
  if (process.argv.includes("--spine1-donor")) name = exactRays ? "ad" : "ae";
  // The legacy1.5mm push is a proposal buffer, not an acceptance tolerance. Use the real
  // unchanged0.1mm origin +20um minimum ray distance, with30um extra proposal clearance.
  let supportClearance = rayClearance ? .00015 : .0015;
  if (exactRayPlane) supportClearance = SOURCE_CLOTH_RAY_OFFSET + SOURCE_CLOTH_RAY_MINIMUM;
  const ids = (seamFlex ? [6656, 6655, 6522, 1501] : [6656, 6655]).map(vertex => skin.byVertex.get(vertex)!);
  assert.deepEqual(skin.groups[ids[1]!]!.members, [6649, 6655]);
  const source = ids.map(id => {
    const group = skin.groups[id]!, raw = new Map<number, number>();
    reference.surface.joints[group.members[0]!]!.forEach((joint, slot) => raw.set(joint,
      (raw.get(joint) ?? 0) + reference.surface.weights[group.members[0]!]![slot]!));
    const total = [...raw.values()].reduce((sum, value) => sum + value, 0);
    return group.joints.map(joint => (raw.get(joint) ?? 0) / total);
  });
  if (process.argv.includes("--kinematic-audit")) {
    const records = ids.map(id => {
      const group = skin.groups[id]!, names = group.joints.map(joint => reference.skeleton.names[reference.surface.jointNodes[joint]!]!);
      return { vertices: group.members, names, maximumNativeInfluenceDistances: names.flatMap((first, a) => names
        .flatMap((second, b) => a < b ? [{ first, second, maximumDistance: pairBounds.get(`${id}/${a}/${b}`) }] : [])) };
    });
    await writeFile(resolve(output, "source-cloth-spine1-kinematic-audit.json"), JSON.stringify({ records,
      scope: "Read-only native influence reachability over both original training grids; no fit/model/source writes." }, null, 2));
    console.log(JSON.stringify({ kinematicAudit: records })); return false;
  }
  const movementBound = (id: number, start: readonly number[], weights: readonly number[]) => {
    const donors = weights.map((value, slot) => Math.max(0, start[slot]! - value));
    const recipients = weights.map((value, slot) => Math.max(0, value - start[slot]!));
    let bound = sourceMismatch.get(id)!;
    for (let step = 0; step < 8; step++) {
      const pair = donors.flatMap((available, donor) => recipients.map((needed, recipient) => ({
        amount: Math.min(available, needed), donor, recipient, cost: pairBounds.get(`${id}/${donor}/${recipient}`)! })))
        .filter(value => value.amount > 1e-10).sort((a, b) => a.cost - b.cost)[0];
      if (!pair) break;
      donors[pair.donor]! -= pair.amount; recipients[pair.recipient]! -= pair.amount;
      bound += pair.amount * pair.cost;
    }
    return bound;
  };
  // Scaling each original trust-polytope corner towards its source keeps the exact0.35L1
  // constraint and a conservative all-sampled-pose20mm bound in every convex combination.
  const originalCorners = source.map(weights => sourceClothWeightVertices(weights, .34999));
  const corners = ids.map((id, at) => originalCorners[at]!.map(weights => {
    const bound = movementBound(id, source[at]!, weights);
    const baseline = sourceMismatch.get(id)!;
    const scale = Math.max(0, Math.min(1, (.01979 - baseline) / Math.max(1e-12, bound - baseline)));
    return source[at]!.map((value, slot) => value + (weights[slot]! - value) * scale);
  }));
  ids.forEach((id, at) => {
    corners[at]!.push(source[at]!);
    assert(original[id]!.reduce((sum, value, slot) => sum + Math.abs(value - source[at]![slot]!), 0) < .34999);
    assert(movementBound(id, source[at]!, original[id]!) < .01979);
    corners[at]!.push([...original[id]!]);
  });
  const evaluate = createClothContactEvaluator(costumeIndices, legIndices, skin.groups, skin.byVertex);
  const rayProblem = createSourceClothRayTargets(ids, skin, costumeIndices);
  const allPoses = [...poses.values()], rows: ClothHalfspace[] = [], rowMetadata: unknown[] = [];
  const collect = () => {
    const values = allPoses.map(pose => evaluate(pose));
    values.forEach((value, at) => value.constraints.forEach(constraint => {
      if (!constraint.coefficients.some(coefficient => ids.includes(coefficient.group))) return;
      if (exactRays) rayProblem.collect(allPoses[at]!, constraint);
      const coefficients = ids.flatMap(id => constraint.coefficients.find(value => value.group === id)?.dot ?? [0, 0, 0, 0]);
      const target = constraint.target - .0015 + supportClearance - constraint.coefficients.filter(value => !ids.includes(value.group))
        .reduce((sum, value) => sum + value.dot.reduce((sum, dot, slot) => sum + dot * skin.groups[value.group]!.weights[slot]!, 0), 0);
      rows.push({ coefficients, target }); rowMetadata.push({ phase: allPoses[at]!.label,
        bodyTriangle: constraint.bodyTriangle, support: constraint.support, sourceCoverDistance: constraint.sourceCoverDistance });
    }));
    return values;
  };
  const baseline = collect();
  const rejected = JSON.parse(await readFile(resolve(output, "source-cloth-waist-n-profile.json"), "utf8"));
  const rejectedGroup = rejected.fittedProfile.weights.find((group: { vertices: number[] }) => group.vertices.includes(6656));
  const mapping = new Map<number, number>(rejectedGroup.joints.map((joint: number, slot: number) => [joint, rejectedGroup.weights[slot]]));
  skin.groups[ids[0]!]!.weights = skin.groups[ids[0]!]!.joints.map(joint => mapping.get(joint) ?? 0);
  collect(); ids.forEach(id => { skin.groups[id]!.weights = [...original[id]!]; });
  const rounds = [];
  let targetedPass = false, start = ids.flatMap(id => original[id]!);
  for (let round = 0; round < 3; round++) {
    const geometric = exactRays ? solveConnectedClothRays(corners, start,
      separatingAxis ? rayProblem.separationEvaluate : rayProblem.evaluate, separatingAxis ? 240 : 800) : undefined;
    const result = geometric ? { ...geometric, feasible: geometric.targetRaysCovered, dualWeights: [] }
      : solveConnectedClothHalfspaces(corners, start, rows);
    let supportPlaneCertificate;
    if (!exactRays) {
    const combined = result.weights.map(() => 0);
    rows.forEach((row, at) => row.coefficients.forEach((value, slot) => { combined[slot]! += result.dualWeights[at]! * value; }));
    const target = rows.reduce((sum, row, at) => sum + result.dualWeights[at]! * row.target, 0);
    const proofCorners = source.map(weights => sourceClothWeightVertices(weights, .350001));
    const support = proofCorners.reduce((sum, group, at) => sum + Math.max(...group.map(weights => weights.reduce((sum, weight, slot) =>
      sum + weight * combined[at * 4 + slot]!, 0))), 0);
    supportPlaneCertificate = { nonnegativeMultipliers: result.dualWeights, target, maximumReachableSupport: support,
      sourceRowsIncluded: result.dualWeights.length,
      proofL1Radius: .350001, supportClearance, positiveSeparationGap: target - support,
      provesOnly: "The collected support-plane surrogate, not the complete coverage problem" };
    }
    ids.forEach((id, at) => { skin.groups[id]!.weights = result.weights.slice(at * 4, at * 4 + 4).map(skin.quantizeWeight); });
    for (const id of boundary) if (!ids.includes(id)) assert.deepEqual(skin.groups[id]!.weights, original[id]);
    ids.forEach((id, at) => assert(skin.groups[id]!.weights.reduce((sum, weight, slot) => sum
      + Math.abs(weight - source[at]![slot]!), 0) <= .35));
    const actual = collect();
    // The complete frozen native validator measures the authoritative source displacement.
    // This targeted cache reports displacement from V; a changed K seam can differ from V
    // by more while still remaining in its original-source20mm trust region.
    targetedPass = actual.every((value, at) => allPoses[at]!.label.includes("archer/attack/61/72")
      ? value.newExposures <= baseline[at]!.newExposures : value.newExposures === 0);
    rounds.push({ round, solve: result, supportPlaneCertificate, actual: actual.map((value, at) => ({ label: allPoses[at]!.label,
      newExposures: value.newExposures, maximumShiftFromV: value.maximumShift })) });
    if (targetedPass) break;
    if (!result.feasible) break;
    start = result.weights;
  }
  if (targetedPass) await writeFile(resolve(output, `source-cloth-waist-${name}-profile.json`), JSON.stringify({ ...profile,
    records: [], scope: "Joint original4-weight6656+6655/6649 solve; targeted right/left/idle guards only; front and full independent matrix still REQUIRED. No publication.",
    fittedProfile: { solved: false, targetedRightPass: true, fullMatrixValidated: false,
      weights: skin.groups.map(group => ({ vertices: group.members, joints: group.joints,
        jointNames: group.joints.map(joint => reference.skeleton.names[reference.surface.jointNodes[joint]!]!), weights: group.weights })) } }, null, 2));
  await writeFile(resolve(output, `source-cloth-waist-${name}-analysis.json`), JSON.stringify({ targetedPass, supportClearance,
    coverageAcceptanceTolerancesUnchanged: true,
    authorizedBoundaryExceptions: ids.filter(id => boundary.has(id)).map(id => skin.groups[id]!.members),
    connectedSourceGroups: ids.map(id => skin.groups[id]!.members),
    otherBoundaryGroupsFrozen: boundary.size - ids.filter(id => boundary.has(id)).length,
    normalizedSourceSeedPoseOffset: ids.map(id => sourceMismatch.get(id)),
    authorizedPaletteException: process.argv.includes("--spine1-donor")
      ? "Only original zero RightLeg slot on6656/6522/1501 replaced by existing real adjacent torso Spine1; four slots and rig unchanged" : undefined,
    actualBodyVariables: 0, originalGeometryPreserved: true, originalL1Limit: .35, originalMotionLimit: .02,
    source, corners, rows, rowMetadata, rounds, exactGeometricRayTargets: exactRays ? rayProblem.report() : undefined,
    scope: "Bounded connected source4-slot solve, at most3 exact guarded rounds, original trust corners and conservative pose bound. Optional exact finite-ray/triangle distance with moving barycentrics replaces frozen support planes. Exact coverage evaluator unchanged; failure is not global impossibility." }, null, 2));
  console.log(JSON.stringify({ coupledWaist: name, targetedPass, rounds }));
  return targetedPass;
};
