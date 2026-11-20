import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SkinnedMesh } from "three";

import { readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { repairSourceClothRegions } from "./source-cloth-regional-repair";
import { createClothContactEvaluator, prepareClothPose } from "./source-cloth-weight-contacts";
import { createClothWeightGroups } from "./source-cloth-weight-groups";

interface SeamDirection {
  donor: number;
  gains: number[];
  id: number;
  maximumTransfer: number;
  minimumAdvance: number;
  recipient: number;
}
interface SeamProposal {
  exposures: number;
  moves: (SeamDirection & { fraction: number })[];
  phases: { label: string; maximumShift: number; newExposures: number }[];
}

const output = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02");
const sourcePath = resolve("../island-of-settlers-worker-generation/game_ready/original-clothes-review/nubian-man-scarf/model.glb");
const hash = async () => createHash("sha256").update(await readFile(sourcePath)).digest("hex");
const sourceSha256 = await hash(), io = await createRetargetIO(), document = await io.read(sourcePath);
const literal = document.getRoot().listNodes().find(node => node.getMesh() && node.getSkin())!
  .getMesh()!.listPrimitives()[0]!;
assert.equal(literal.getAttribute("POSITION")!.getCount(), 11505);
assert.equal(literal.getIndices()!.getCount(), 30258);
const literalIndices = Array.from(literal.getIndices()!.getArray()!);
const reference = readArmourBody(document), support = buildSourceKiltPanels(await io.read(sourcePath), "nubian-man-scarf");
assert.deepEqual(Array.from(literal.getIndices()!.getArray()!), literalIndices);
assert.equal(literal.getAttribute("POSITION")!.getCount(), 11505);
let profileName = "source-kilt-original-skin-fit-d.json";
if (process.argv.includes("--waist-rebind")) profileName = "source-cloth-seam-k-profile.json";
if (process.argv.includes("--finish-regions")) profileName = "source-cloth-waist-n-profile.json";
if (process.argv.includes("--front-waist") || process.argv.includes("--cover-audit")) profileName = "source-cloth-regional-r-partial-profile.json";
if (process.argv.includes("--adjacent-only")) profileName = "source-cloth-regional-v-profile.json";
if (process.argv.includes("--coupled-waist")) profileName = "source-cloth-regional-v-profile.json";
const profile = JSON.parse(await readFile(resolve(output, profileName), "utf8"));
assert.equal(profile.inputSha256, sourceSha256);
const owned = new Set(support.ownedVertices), legs = new Set(support.originalLegVertices);
const costumeIndices = support.referenceTriangleOffsets.flatMap(at => reference.surface.triangles.slice(at, at + 3));
const legIndices: number[] = [];
for (let at = 0; at < reference.surface.triangles.length; at += 3) {
  const face = reference.surface.triangles.slice(at, at + 3);
  if (face.every(vertex => legs.has(vertex))) legIndices.push(...face);
}
const frames = await createEquippedCpuFrames({ folder: "source-kilt-surface-de", bodies: ["nubian-man-scarf"],
  ranks: ["recruit"], qualities: ["high"], sampling: {
    gaitSamples: 32, attackSamples: 48, phaseOffset: .5, runBlends: [.25, .5, .75] } });
const assets = await createHatchAuditAssets();
try {
  const original = await assets.pack.load("nubian", "nubian-man-scarf", pathToFileURL(sourcePath).href);
  const candidate = await assets.pack.load("nubian", "nubian-man-scarf", pathToFileURL(sourcePath).href);
  const body = candidate.root.getObjectByName("body") as SkinnedMesh;
  const originalBody = original.root.getObjectByName("body") as SkinnedMesh;
  assert.equal(body.geometry.getAttribute("position").count, 11505);
  assert.equal(body.geometry.getIndex()!.count, 30258);
  const index = body.geometry.getAttribute("skinIndex"), weight = body.geometry.getAttribute("skinWeight");
  for (const frozen of profile.fittedProfile.weights) for (const vertex of frozen.vertices) {
    index.setXYZW(vertex, ...[0, 1, 2, 3].map(slot => frozen.joints[slot] ?? 0) as [number, number, number, number]);
    weight.setXYZW(vertex, ...[0, 1, 2, 3].map(slot => frozen.weights[slot] ?? 0) as [number, number, number, number]);
  }
  const skin = createClothWeightGroups(body, owned, reference.points, reference.joints.get("Hips")!.x);
  skin.write();
  if (process.argv.includes("--regions")) {
    await repairSourceClothRegions({ body, costumeIndices, frames, legIndices, legs, originalBody,
      output, owned, profile, reference, skin });
    assert.equal(await hash(), sourceSha256);
  } else {
  const groupIds = [6522, 1501].map(vertex => skin.byVertex.get(vertex)!);
  const protectedSeamIds = [6656, 6655].map(vertex => skin.byVertex.get(vertex)!);
  const baseline = skin.groups.map(group => [...group.weights]);
  const unitPositions = (id: number) => {
    const group = skin.groups[id]!, vertex = group.members[0]!;
    const indices = [0, 1, 2, 3].map(slot => index.getComponent(vertex, slot));
    const weights = [0, 1, 2, 3].map(slot => weight.getComponent(vertex, slot));
    const points = group.joints.map(joint => {
      index.setXYZW(vertex, joint, 0, 0, 0); weight.setXYZW(vertex, 1, 0, 0, 0);
      return body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
    });
    index.setXYZW(vertex, ...indices as [number, number, number, number]);
    weight.setXYZW(vertex, ...weights as [number, number, number, number]);
    return points;
  };
  const pairBounds = new Map<string, number>();
  for (const cell of frames.records[0]!.cells) {
    applyArmourPoseSnapshot(candidate.root, { ...cell.diagnostics,
      posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") });
    for (const id of groupIds) {
      const points = unitPositions(id);
      for (let donor = 0; donor < points.length; donor++) for (let recipient = 0; recipient < points.length; recipient++) {
        const key = `${id}/${donor}/${recipient}`;
        pairBounds.set(key, Math.max(pairBounds.get(key) ?? 0, points[donor]!.distanceTo(points[recipient]!)));
      }
    }
  }
  const selected = frames.records[0]!.cells.filter(cell => cell.troop === "shield"
    && ["run/12/32", "run/13/32"].includes(cell.name));
  assert.equal(selected.length, 2);
  const poses = selected.map(cell => prepareClothPose(body, originalBody,
    { diagnostics: cell.diagnostics, label: `${cell.troop}/${cell.name}` }, skin.groups, costumeIndices, legIndices));
  const evaluate = createClothContactEvaluator(costumeIndices, legIndices, skin.groups, skin.byVertex);
  const initial = poses.map(pose => ({ label: pose.label, ...evaluate(pose) }));
  const constraints = initial.flatMap(result => result.constraints);
  const directions: SeamDirection[] = [];
  for (const id of groupIds) {
    const group = skin.groups[id]!;
    for (let donor = 0; donor < group.weights.length; donor++) for (let recipient = 0; recipient < group.weights.length; recipient++) {
      if (donor === recipient || group.seed[donor]! <= 1e-8) continue;
      const maximumTransfer = Math.min(group.seed[donor]!, .175,
        .0199 / Math.max(1e-12, pairBounds.get(`${id}/${donor}/${recipient}`)!));
      const gains = constraints.map(constraint => {
        const coefficient = constraint.coefficients.find(coefficient => coefficient.group === id);
        if (!coefficient) return 0;
        return coefficient.dot[recipient]! - coefficient.dot[donor]!;
      });
      directions.push({ id, donor, recipient, maximumTransfer, gains,
        minimumAdvance: Math.min(...gains) * maximumTransfer });
    }
  }
  directions.sort((a, b) => b.minimumAdvance - a.minimumAdvance);
  const results: SeamProposal[] = [];
  const evaluateProposal = (moves: { direction: SeamDirection; fraction: number }[]): SeamProposal => {
    groupIds.forEach(id => { skin.groups[id]!.weights = [...baseline[id]!]; });
    for (const { direction, fraction } of moves) {
      const group = skin.groups[direction.id]!, amount = direction.maximumTransfer * fraction;
      group.weights[direction.donor]! -= amount; group.weights[direction.recipient]! += amount;
      group.weights = group.weights.map(skin.quantizeWeight);
    }
    for (const id of protectedSeamIds) assert.deepEqual(skin.groups[id]!.weights, baseline[id]);
    const phases = poses.map(pose => ({ label: pose.label, ...evaluate(pose) }));
    const exposures = phases.reduce((sum, phase) => sum + phase.newExposures, 0);
    const record = { moves: moves.map(move => ({ ...move.direction, fraction: move.fraction })),
      exposures, phases: phases.map(({ constraints: _constraints, ...phase }) => phase) };
    results.push(record); return record;
  };
  let solution: { direction: SeamDirection; fraction: number }[] | undefined;
  for (const direction of directions.filter(direction => direction.minimumAdvance > 0).slice(0, 4)) {
    const moves = [{ direction, fraction: 1 }];
    if (evaluateProposal(moves).exposures === 0) { solution = moves; break; }
  }
  if (!solution) {
    const best = groupIds.map(id => directions.find(direction => direction.id === id && direction.minimumAdvance > 0));
    if (best.every(Boolean)) for (const first of [1, .5, .25]) {
      for (const second of [1, .5, .25]) {
        const moves = [{ direction: best[0]!, fraction: first }, { direction: best[1]!, fraction: second }];
        if (evaluateProposal(moves).exposures === 0) { solution = moves; break; }
      }
      if (solution) break;
    }
  }
  if (solution) {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 12; iteration++) {
      const fraction = (low + high) / 2;
      const moves = solution.map(move => ({ ...move, fraction: move.fraction * fraction }));
      if (evaluateProposal(moves).exposures === 0) high = fraction;
      else low = fraction;
    }
    solution = solution.map(move => ({ ...move, fraction: move.fraction * high }));
    const final = evaluateProposal(solution); assert.equal(final.exposures, 0);
    const candidate = { ...profile, records: [],
      scope: "Targeted two-group source-skin proposal only; immutable rest geometry/waist seam, full and independent validation REQUIRED",
      sourceProfile: "source-kilt-original-skin-fit-d.json", fittedProfile: { solved: false,
        targetedContactPass: true, fullMatrixValidated: false,
        weights: skin.groups.map(group => ({ vertices: group.members, joints: group.joints,
          jointNames: group.joints.map(joint => body.skeleton.bones[joint]!.name), weights: group.weights })) } };
    await writeFile(resolve(output, "source-cloth-seam-k-profile.json"), JSON.stringify(candidate, null, 2));
  }
  assert.equal(await hash(), sourceSha256);
  await writeFile(resolve(output, "source-cloth-seam-k-analysis.json"), JSON.stringify({ sourceSha256,
    literalVertices: 11505, literalIndices: 30258, immutableSource: true,
    mutableVertices: groupIds.map(id => skin.groups[id]!.members),
    protectedSeamVertices: protectedSeamIds.map(id => skin.groups[id]!.members), boundPoseCells: frames.records[0]!.cells.length,
    initial: initial.map(({ constraints: _constraints, ...phase }) => phase), directions, results, solution,
    scope: "Analytical bounded two-group weight transfer. Native unit-joint basis, fixed source waist seam, unchanged exact exposure thresholds. No model/source/runtime writes." }, null, 2));
  console.log(JSON.stringify({ initial: initial.map(value => value.newExposures), solution,
    proposals: results.length, best: Math.min(...results.map(result => result.exposures)) }));
  }
  original.dispose(); candidate.dispose();
} finally { assets.restore(); }
