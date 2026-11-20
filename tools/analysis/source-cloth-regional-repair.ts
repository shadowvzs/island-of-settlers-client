import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SkinnedMesh } from "three";

import type { ArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { createSourceKiltWaist } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-waist";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { inspectSourceClothAffineObstruction } from "./source-cloth-affine-obstruction";
import { auditSourceClothCover } from "./source-cloth-cover-audit";
import { sourceClothFrontReachability } from "./source-cloth-front-reachability";
import { bestPairedClothAdvance } from "./source-cloth-pair-directions";
import { inspectPinnedClothObstruction } from "./source-cloth-pinned-proof";
import { measureSourceClothPoseBounds } from "./source-cloth-pose-bounds";
import { solveCoupledSourceWaist } from "./source-cloth-waist-coupled";
import { rebindSourceClothWaist } from "./source-cloth-waist-rebind";
import { createClothContactEvaluator, prepareClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";

type Frames = Awaited<ReturnType<typeof createEquippedCpuFrames>>;
type Skin = ReturnType<typeof createClothWeightGroups>;
interface Direction { id: number; donor: number; recipient: number; maximum: number; gains: number[]; advance: number }
interface Move { direction: Direction; fraction: number }

/** Only source-owned, non-boundary garment groups may change. All anatomy and every current
 * source waist-boundary group remain exact; every proposal uses the unchanged native evaluator. */
export const repairSourceClothRegions = async (context: { body: SkinnedMesh; costumeIndices: number[];
  frames: Frames; legIndices: number[]; legs: ReadonlySet<number>; originalBody: SkinnedMesh;
  output: string; owned: ReadonlySet<number>; profile: any; reference: ArmourBody; skin: Skin }) => {
  const { body, costumeIndices, frames, legIndices, legs, originalBody, output, owned, profile, reference, skin } = context;
  const additional = await createEquippedCpuFrames({ folder: "source-kilt-surface-de", bodies: ["nubian-man-scarf"],
    ranks: ["recruit"], qualities: ["high"], sampling: {
      gaitSamples: 48, attackSamples: 72, phaseOffset: .25, runBlends: [.875] } });
  const cells = [...frames.records[0]!.cells, ...additional.records[0]!.cells];
  const finishRegions = process.argv.includes("--finish-regions");
  let rightPhases = ["shield/run/12/32", "shield/run/13/32",
    ...[22, 23, 24, 25].map(sample => `shield/blend-0.875/${sample}/48`)];
  const coupledWaist = process.argv.includes("--coupled-waist");
  if (coupledWaist) rightPhases = rightPhases.flatMap(label => [label, label.replace("shield/", "heavy/"), label.replace("shield/", "archer/")]);
  const regions = [
    ...finishRegions ? [] : [{ name: "right", vertices: [6522, 1501], phases: rightPhases }],
    { name: "left", vertices: [10775, 10766], phases: ["shield/run/39/48"] },
    { name: "front", vertices: [3874], phases: ["archer/attack/61/72"] },
  ];
  const frontWaist = process.argv.includes("--front-waist");
  const adjacentOnly = process.argv.includes("--adjacent-only");
  const waistMode = process.argv.includes("--waist-rebind") || frontWaist || adjacentOnly || coupledWaist;
  const allowedBoundary = new Set<number>();
  if (waistMode) {
    const allowedVertices = frontWaist ? [699, 3878] : [6656];
    for (const vertex of adjacentOnly ? [6655] : allowedVertices) allowedBoundary.add(skin.byVertex.get(vertex)!);
    if (coupledWaist) allowedBoundary.add(skin.byVertex.get(6655)!);
    if (process.argv.includes("--adjacent-waist")) allowedBoundary.add(skin.byVertex.get(6655)!);
  }
  const initialWeights = skin.groups.map(group => [...group.weights]);
  const boundary = new Set<number>();
  for (let at = 0; at < costumeIndices.length; at += 3) {
    const face = costumeIndices.slice(at, at + 3);
    if (face.some(vertex => !owned.has(vertex))) for (const vertex of face) if (owned.has(vertex)) boundary.add(vertex);
  }
  const boundaryIds = new Set([...boundary].map(vertex => skin.byVertex.get(vertex)!));
  const coupledIds = (process.argv.includes("--seam-flex") ? [6656, 6655, 6522, 1501] : [6656, 6655])
    .map(vertex => skin.byVertex.get(vertex)!);
  const ids = [...new Set([...regions.flatMap(region => region.vertices.map(vertex => skin.byVertex.get(vertex)!)),
    ...allowedBoundary, ...coupledWaist ? coupledIds : []])];
  const signature = (vertex: number) => {
    const weights = new Map<number, number>();
    reference.surface.joints[vertex]!.forEach((joint, slot) => {
      const weight = reference.surface.weights[vertex]![slot]!;
      if (weight > 0) weights.set(joint, (weights.get(joint) ?? 0) + weight);
    });
    return [...weights].sort((a, b) => a[0] - b[0]);
  };
  const ownership = ids.map(id => {
    assert(!boundaryIds.has(id) || allowedBoundary.has(id), "Only explicitly authorized waist groups may be unpinned");
    const group = skin.groups[id]!, first = group.members[0]!;
    for (const vertex of group.members) {
      assert(owned.has(vertex) && !legs.has(vertex), "Actual body anatomy is not a garment variable");
      assert.deepEqual(reference.surface.positions[vertex]!.toArray(), reference.surface.positions[first]!.toArray());
      assert.deepEqual(signature(vertex), signature(first), "Only exact connected source UV-seam duplicates may move together");
    }
    return { id, vertices: group.members, sourceSkin: signature(first), boundary: boundaryIds.has(id) };
  });
  if (process.argv.includes("--spine1-donor")) {
    assert(coupledWaist && process.argv.includes("--seam-flex"));
    const spine = reference.surface.jointNodes.findIndex(node => reference.skeleton.names[node] === "Spine1");
    assert(spine >= 0);
    for (const vertex of [6656, 6522, 1501]) {
      const group = skin.groups[skin.byVertex.get(vertex)!]!;
      const slot = group.joints.findIndex((joint, slot) => group.seed[slot] === 0 && group.weights[slot] === 0
        && reference.skeleton.names[reference.surface.jointNodes[joint]!] === "RightLeg");
      assert(slot >= 0, "Only the explicitly authorized unused RightLeg slot may adopt the real torso Spine1 donor");
      group.joints[slot] = spine;
    }
    skin.write();
  }
  const fieldMode = process.argv.includes("--body-field");
  const fieldWeights = new Map<number, number[]>();
  assert(!(fieldMode && waistMode), "Choose the bounded waist exception or the pinned canonical field diagnostic");
  if (fieldMode || waistMode || finishRegions) {
    const hips = reference.joints.get("Hips")!, field = createSourceKiltWaist(reference, {
      originalLegVertices: [...legs], weightField: { waist: reference.joints.get("Spine")!.y } });
    let fieldIds: Iterable<number> = ids;
    if (waistMode) fieldIds = process.argv.includes("--front-triangle")
      ? new Set([...allowedBoundary, skin.byVertex.get(3874)!]) : allowedBoundary;
    else if (finishRegions && !fieldMode) fieldIds = [skin.byVertex.get(3874)!];
    for (const id of fieldIds) {
      const group = skin.groups[id]!, point = reference.points[group.members[0]!]!;
      const weights = new Map([...field.weightsAt(point, point.x >= hips.x ? 1 : -1)]
        .filter(([, weight]) => weight > 1e-8));
      assert(weights.size <= 4, "Actual original body correspondence must fit the existing four skin slots");
      for (const joint of weights.keys()) if ((!frontWaist || !boundaryIds.has(id)) && !group.joints.includes(joint)) {
        const slot = group.joints.findIndex((existing, slot) => group.seed[slot] === 0 && !weights.has(existing));
        assert(slot >= 0, "A new existing-rig influence may replace only an unused garment slot");
        group.joints[slot] = joint;
      }
      // Keep the complete existing palette for the two nonzero front anchors. Project the
      // measured body field onto those source influences; never silently swap a live joint.
      const total = group.joints.reduce((sum, joint) => sum + (weights.get(joint) ?? 0), 0);
      assert(total > 0, "The original palette must overlap the canonical body field");
      fieldWeights.set(id, group.joints.map(joint => skin.quantizeWeight((weights.get(joint) ?? 0) / total)));
    }
    skin.write();
  }
  const labels = new Set([...rightPhases, ...regions.flatMap(region => region.phases)]);
  if (adjacentOnly) for (const label of ["shield/idle", "shield/defending"]) labels.add(label);
  if (coupledWaist) for (const troop of ["shield", "heavy", "archer"]) {
    for (const name of ["idle", "defending", "run/39/48"]) labels.add(`${troop}/${name}`);
  }
  const allPoses = new Map([...labels].map(label => {
    const cell = cells.find(cell => `${cell.troop}/${cell.name}` === label)!; assert(cell);
    return [label, prepareClothPose(body, originalBody, { diagnostics: cell.diagnostics, label },
      skin.groups, costumeIndices, legIndices)];
  }));
  if (process.argv.includes("--pinned-proof")) {
    await inspectPinnedClothObstruction(output, allPoses.values(), skin, costumeIndices, new Set(ids), boundaryIds);
    return false;
  }
  if (process.argv.includes("--affine-proof")) {
    await inspectSourceClothAffineObstruction(output, allPoses.values(), skin, reference, legIndices);
    return false;
  }
  const { baselineShift, fieldShift, pairBounds, sourceMismatch } = measureSourceClothPoseBounds({
    body, cells, fields: fieldWeights, ids, originalBody, reference, skin,
    sourceControls: coupledWaist ? new Set(coupledIds) : undefined });
  const evaluate = createClothContactEvaluator(costumeIndices, legIndices, skin.groups, skin.byVertex);
  if (coupledWaist) return solveCoupledSourceWaist({ boundary: boundaryIds, costumeIndices,
    legIndices, original: initialWeights, output, pairBounds, poses: allPoses, profile, reference, skin, sourceMismatch });
  if (process.argv.includes("--cover-audit")) {
    await auditSourceClothCover({ costumeIndices, legIndices, output, poses: allPoses.values(), reference, skin });
    return false;
  }
  if (waistMode) return rebindSourceClothWaist({ baselineShift, boundary: boundaryIds, costumeIndices,
    fields: fieldWeights, fieldShift, legIndices, original: initialWeights, output,
    poses: allPoses, profile, reference, skin });
  if (fieldMode) {
    const bindings = ids.map(id => {
      const group = skin.groups[id]!, source = new Map(signature(group.members[0]!));
      const total = [...source.values()].reduce((sum, weight) => sum + weight, 0);
      const desired = fieldWeights.get(id)!;
      const sourceDelta = group.joints.reduce((sum, joint, slot) => sum
        + Math.abs(desired[slot]! - (source.get(joint) ?? 0) / total), 0);
      assert(sourceDelta <= .35 && fieldShift.get(id)! <= .02,
        "Canonical body binding cannot weaken original skin/pose bounds");
      group.weights = [...desired];
      return { vertices: group.members, joints: group.joints,
        jointNames: group.joints.map(joint => body.skeleton.bones[joint]!.name), weights: desired,
        sourceDelta, maximumActualPoseShift: fieldShift.get(id) };
    });
    for (const id of boundaryIds) assert.deepEqual(skin.groups[id]!.weights, initialWeights[id]);
    const phases = [...allPoses.values()].map(pose => ({ label: pose.label, ...evaluate(pose) }));
    const complete = phases.every(phase => phase.newExposures === 0);
    if (complete) await writeFile(resolve(output, "source-cloth-regional-m-profile.json"), JSON.stringify({
      ...profile, records: [], scope: "Canonical actual-source body binding on five original cloth groups; full and NEW independent validation REQUIRED",
      fittedProfile: { solved: false, regionTargetsPassed: true, fullMatrixValidated: false,
        weights: skin.groups.map(group => ({ vertices: group.members, joints: group.joints,
          jointNames: group.joints.map(joint => body.skeleton.bones[joint]!.name), weights: group.weights })) } }, null, 2));
    await writeFile(resolve(output, "source-cloth-regional-m-analysis.json"), JSON.stringify({ complete,
      literalVertices: 11505, literalIndices: 30258, bodyAnatomyVariables: 0, ownership, bindings,
      protectedBoundaryGroups: [...boundaryIds].map(id => ({ vertices: skin.groups[id]!.members,
        weights: initialWeights[id] })), boundPoses: cells.length, phases,
      scope: "Single canonical original-body barycentric binding. Same original rig/four slots; only unused zero slot replaced where required. No geometry fit, source writes or threshold changes." }, null, 2));
    console.log(JSON.stringify({ canonicalBodyField: true, complete,
      phases: phases.map(phase => ({ label: phase.label, newExposures: phase.newExposures })), bindings }));
    return complete;
  }
  const guards: string[] = finishRegions ? [...rightPhases] : [], reports = [];
  for (const label of guards) assert.equal(evaluate(allPoses.get(label)!).newExposures, 0,
    "Frozen right-waist repair must reproduce before any new regional mutation");
  let complete = true;
  for (const region of regions) {
    const regionIds = region.vertices.map(vertex => skin.byVertex.get(vertex)!);
    const before = skin.groups.map(group => [...group.weights]);
    const current = region.phases.map(label => evaluate(allPoses.get(label)!));
    const constraints = current.flatMap(value => value.constraints);
    if (region.name === "right") {
      const prior = JSON.parse(await readFile(resolve(output, "source-cloth-seam-k-profile.json"), "utf8"));
      for (const id of regionIds) {
        const group = skin.groups[id]!, frozen = prior.fittedProfile.weights
          .find((value: { vertices: number[] }) => value.vertices.includes(group.members[0]!));
        const weights = new Map<number, number>(frozen.joints.map((joint: number, slot: number) => [joint, frozen.weights[slot]]));
        group.weights = group.joints.map(joint => skin.quantizeWeight(weights.get(joint) ?? 0));
      }
      for (const label of region.phases) constraints.push(...evaluate(allPoses.get(label)!).constraints);
      regionIds.forEach(id => { skin.groups[id]!.weights = [...before[id]!]; });
    }
    const relevant = constraints.filter(constraint => constraint.coefficients.some(value => regionIds.includes(value.group)));
    const directions: Direction[] = [];
    for (const id of regionIds) {
      const group = skin.groups[id]!, source = new Map(signature(group.members[0]!));
      const total = [...source.values()].reduce((sum, weight) => sum + weight, 0);
      const oldDelta = group.joints.reduce((sum, joint, slot) => sum
        + Math.abs(before[id]![slot]! - (source.get(joint) ?? 0) / total), 0);
      for (let donor = 0; donor < group.joints.length; donor++) for (let recipient = 0; recipient < group.joints.length; recipient++) {
        if (donor === recipient || before[id]![donor]! < 1e-8) continue;
        const maximum = Math.max(0, Math.min(before[id]![donor]!, (.34999 - oldDelta) / 2,
          (.0199 - baselineShift.get(id)!) / Math.max(1e-12, pairBounds.get(`${id}/${donor}/${recipient}`)!)));
        const gains = relevant.map(constraint => {
          const coefficient = constraint.coefficients.find(value => value.group === id);
          return coefficient ? coefficient.dot[recipient]! - coefficient.dot[donor]! : 0;
        });
        directions.push({ id, donor, recipient, maximum, gains, advance: Math.min(...gains) * maximum });
      }
    }
    directions.sort((a, b) => b.advance - a.advance);
    const tested: { moves: Move[]; counts: number[] }[] = [];
    const test = (moves: Move[]) => {
      regionIds.forEach(id => { skin.groups[id]!.weights = [...before[id]!]; });
      for (const { direction, fraction } of moves) {
        const group = skin.groups[direction.id]!, transfer = direction.maximum * fraction;
        group.weights[direction.donor]! -= transfer; group.weights[direction.recipient]! += transfer;
        group.weights = group.weights.map(skin.quantizeWeight);
      }
      for (const id of boundaryIds) assert.deepEqual(skin.groups[id]!.weights, initialWeights[id]);
      const counts = [...guards, ...region.phases].map(label => evaluate(allPoses.get(label)!).newExposures);
      tested.push({ moves, counts }); return counts.every(count => count === 0);
    };
    const proposals: { moves: Move[]; advance: number }[] = directions.filter(value => value.advance > 0).slice(0, 4)
      .map(direction => ({ moves: [{ direction, fraction: 1 }], advance: direction.advance }));
    let geometric: ReturnType<typeof sourceClothFrontReachability> | undefined;
    if (region.name === "front" && process.argv.includes("--geometric-front")) {
      geometric = sourceClothFrontReachability(allPoses.get(region.phases[0]!)!, skin, reference, pairBounds, baselineShift);
      const geometricId = geometric.id;
      proposals.length = 0;
      for (const candidate of geometric.candidates) for (const fraction of candidate.fractions) proposals.push({
        advance: 1 / Math.max(1e-9, candidate.movementBound),
        moves: candidate.transfers.map(transfer => ({ fraction, direction: {
          id: geometricId, donor: transfer.donor, recipient: transfer.recipient, maximum: transfer.amount,
          gains: [], advance: 0 } })) });
    }
    if (regionIds.length === 2) for (const first of directions.filter(value => value.id === regionIds[0]))
      for (const second of directions.filter(value => value.id === regionIds[1])) {
        const optimum = bestPairedClothAdvance(first.gains.map(value => value * first.maximum),
          second.gains.map(value => value * second.maximum));
        if (optimum.advance > 0) proposals.push({ advance: optimum.advance,
          moves: [{ direction: first, fraction: optimum.first }, { direction: second, fraction: optimum.second }] });
      }
    proposals.sort((a, b) => b.advance - a.advance);
    let solution: Move[] | undefined;
    for (const proposal of proposals.slice(0, 8)) {
      const fractions = geometric ? [1] : [1, .75, .5, .25, .125];
      for (const fraction of fractions) {
        const moves = proposal.moves.map(move => ({ ...move, fraction: move.fraction * fraction }));
        if (test(moves)) { solution = moves; break; }
      }
      if (solution) break;
    }
    if (solution) {
      let low = 0, high = 1;
      for (let step = 0; step < 12; step++) {
        const fraction = (low + high) / 2;
        if (test(solution.map(move => ({ ...move, fraction: move.fraction * fraction })))) high = fraction;
        else low = fraction;
      }
      solution = solution.map(move => ({ ...move, fraction: move.fraction * high }));
      assert(test(solution)); guards.push(...region.phases);
    } else { complete = false; regionIds.forEach(id => { skin.groups[id]!.weights = [...before[id]!]; }); }
    reports.push({ region: region.name, vertices: region.vertices, initial: current.map(value => value.newExposures),
      constraints: relevant, directions, geometric, proposals: proposals.slice(0, 8), tested, solution, complete: Boolean(solution) });
    console.log(JSON.stringify({ region: region.name, initial: current.map(value => value.newExposures),
      proposals: tested.length, solution }));
    if (!complete) break;
  }
  let runName = finishRegions ? "p" : "l";
  if (process.argv.includes("--geometric-front")) runName = "q";
  if (complete) await writeFile(resolve(output, `source-cloth-regional-${runName}-profile.json`), JSON.stringify({ ...profile, records: [],
    scope: "Frozen region-local source weights only; full corpus and NEW independent validation REQUIRED; no publication",
    fittedProfile: { solved: false, regionTargetsPassed: true, fullMatrixValidated: false,
      weights: skin.groups.map(group => ({ vertices: group.members, joints: group.joints,
        jointNames: group.joints.map(joint => body.skeleton.bones[joint]!.name), weights: group.weights })) } }, null, 2));
  await writeFile(resolve(output, `source-cloth-regional-${runName}-analysis.json`), JSON.stringify({ complete,
    literalVertices: 11505, literalIndices: 30258, bodyAnatomyVariables: 0,
    ownership, protectedBoundaryGroups: [...boundaryIds].map(id => ({ vertices: skin.groups[id]!.members,
      weights: initialWeights[id] })), boundPoses: cells.length, reports,
    scope: "Actual connected source ownership and duplicate signatures validated; current waist boundary pinned; original0.35 L1 and20mm shift bounds retained conservatively. Exact coverage evaluator unchanged." }, null, 2));
  return complete;
};
