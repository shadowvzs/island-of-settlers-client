import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createSourceKiltWaist } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-waist";
import { neckBoneWeights, skinWeightMaximum } from "../../../island-of-settlers-worker-generation/src/national-workers/source-skin-streams";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { countSurfaceCrossings, sourceClothContactCoverage,
type SurfaceCrossingWitness,   uniqueMeshEdges } from "./source-cloth-coverage";
import { auditClothWeightBaseline } from "./source-cloth-weight-baseline";
import { fitSourceClothWeights } from "./source-cloth-weight-fit";

const { values } = parseArgs({ options: { out: { type: "string" }, controls: { type: "string" },
  "full-strength": { type: "boolean" }, profile: { type: "string" }, dense: { type: "boolean" },
  "training-dense": { type: "boolean" }, "gait-samples": { type: "string" }, "attack-samples": { type: "string" },
  "phase-offset": { type: "string" }, "run-blends": { type: "string" }, "initial-profile": { type: "string" } } });
assert(values.out, "Choose an explicit original-geometry skin control receipt");
const id = "nubian-man-scarf", path = resolve("../island-of-settlers-worker-generation/game_ready/original-clothes-review", id, "model.glb");
const sha = async () => createHash("sha256").update(await readFile(path)).digest("hex");
const inputSha256 = await sha(), io = await createRetargetIO(), source = await io.read(path);
const literal = skinnedNode(source).getMesh()!.listPrimitives()[0]!;
assert.equal(literal.getAttribute("POSITION")!.getCount(), 11505);
assert.equal(literal.getIndices()!.getCount(), 30258);
const literalIndices = Array.from(literal.getIndices()!.getArray()!);
const reference = readArmourBody(source), support = buildSourceKiltPanels(await io.read(path), id);
assert.deepEqual(Array.from(literal.getIndices()!.getArray()!), literalIndices);
const owned = new Set(support.ownedVertices), legs = new Set(support.originalLegVertices);
assert([...owned].every(vertex => !legs.has(vertex)), "Real original leg anatomy must never enter the cloth mask");
const field = createSourceKiltWaist(reference, support), hips = reference.joints.get("Hips")!;
const scale = (reference.joints.get("Neck")!.y - hips.y) / .28;
const hipJoint = reference.surface.jointNodes.findIndex(joint => reference.skeleton.names[joint] === "Hips");
assert(hipJoint >= 0);
type Mode = "source" | "hips" | "sanitize" | "sanitize-side" | "finger-hips" | "leg-field" | "fit" | "group-control" | "profile";
const controls = (values.controls?.split(",") ?? ["source", "hips", "sanitize", "leg-field"]) as Mode[];
assert(controls.length && controls.every(control =>
  ["source", "hips", "sanitize", "sanitize-side", "finger-hips", "leg-field", "fit", "group-control", "profile"].includes(control)));
assert(!values.dense || !controls.includes("fit"), "Held-out poses must validate a frozen profile, never train it");
assert(!values["training-dense"] || controls.includes("fit"), "Dense training must explicitly select the fitter");
const profileBytes = values.profile ? await readFile(values.profile) : undefined;
const frozenProfileSha256 = profileBytes && createHash("sha256").update(profileBytes).digest("hex");
const profile = profileBytes ? JSON.parse(profileBytes.toString("utf8")) : undefined;
const initialProfile = values["initial-profile"] ? JSON.parse(await readFile(values["initial-profile"], "utf8")) : undefined;
assert(!initialProfile || initialProfile.inputSha256 === inputSha256, "Fitting seed must match the exact donor");
assert(!controls.includes("profile") || profile?.inputSha256 === inputSha256,
  "Frozen cloth weights must match this exact original donor");
let mode: Mode = "source";
const sourceBoneWeights = new Map<string, number>();
for (const vertex of owned) reference.surface.joints[vertex]!.forEach((joint, slot) => {
  const name = reference.skeleton.names[reference.surface.jointNodes[joint]!]!;
  sourceBoneWeights.set(name, (sourceBoneWeights.get(name) ?? 0) + reference.surface.weights[vertex]![slot]!);
});
const frames = await createEquippedCpuFrames({ folder: "source-kilt-surface-de", bodies: [id],
  ranks: ["recruit"], qualities: ["high", "minimal"],
  sampling: values.dense || values["training-dense"] ? {
    gaitSamples: Number(values["gait-samples"] ?? 32), attackSamples: Number(values["attack-samples"] ?? 48),
    phaseOffset: Number(values["phase-offset"] ?? .5),
    runBlends: (values["run-blends"] ?? ".25,.5,.75").split(",").map(Number) } : undefined });
if (values["training-dense"]) {
  const originalGrid = await createEquippedCpuFrames({ folder: "source-kilt-surface-de", bodies: [id],
    ranks: ["recruit"], qualities: ["high", "minimal"] });
  frames.records.push(...originalGrid.records);
}
const assets = await createHatchAuditAssets({ transformModel(document, modelPath) {
  if (modelPath !== path || mode === "source") return;
  const primitive = skinnedNode(document).getMesh()!.listPrimitives()[0]!;
  const joints = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
  const maximum = skinWeightMaximum(weights);
  const originalIndices = Array.from(primitive.getIndices()!.getArray()!);
  const before = primitive.listSemantics().map(semantic => ({ semantic,
    array: Array.from(primitive.getAttribute(semantic)!.getArray()!) }));
  for (const vertex of owned) {
    const point = reference.points[vertex]!, original = new Map<number, number>();
    reference.surface.joints[vertex]!.forEach((joint, slot) =>
      original.set(joint, (original.get(joint) ?? 0) + reference.surface.weights[vertex]![slot]!));
    let controls = new Map<number, number>([[hipJoint, 1]]);
    if (["sanitize", "sanitize-side", "finger-hips", "fit", "group-control", "profile"].includes(mode)) {
      const allowed = [...original].filter(([joint]) => /^(Hips|Spine\d*|(Left|Right)(UpLeg|Leg))$/
        .test(reference.skeleton.names[reference.surface.jointNodes[joint]!]!));
      if (allowed.some(([, weight]) => weight > 1e-8)) controls = new Map(allowed);
      if (mode === "finger-hips") {
        const missing = Math.max(0, 1 - [...controls.values()].reduce((sum, weight) => sum + weight, 0));
        controls.set(hipJoint, (controls.get(hipJoint) ?? 0) + missing);
      }
      if (["sanitize-side", "fit", "group-control", "profile"].includes(mode)) for (const [joint, weight] of controls) {
        const name = reference.skeleton.names[reference.surface.jointNodes[joint]!]!;
        const match = /^(Left|Right)(UpLeg|Leg)$/.exec(name);
        if (!match) continue;
        const own = point.x >= hips.x ? "Left" : "Right";
        if (match[1] === own) continue;
        const share = Math.max(0, Math.min(1, Math.abs(point.x - hips.x) / (.05 * scale)));
        const target = reference.surface.jointNodes.findIndex(index => reference.skeleton.names[index] === own + match[2]);
        assert(target >= 0);
        controls.set(joint, weight * (1 - share));
        controls.set(target, (controls.get(target) ?? 0) + weight * share);
      }
    }
    if (mode === "leg-field") controls = field.weightsAt(point, point.x >= hips.x ? 1 : -1);
    const blend = values["full-strength"] || ["fit", "group-control", "profile"].includes(mode) ? 1
      : Math.max(0, Math.min(1, (support.weightField.waist - point.y) / (.04 * scale)));
    const combined = new Map<number, number>();
    for (const [joint, weight] of original) combined.set(joint, weight * (1 - blend));
    const total = [...controls.values()].reduce((sum, weight) => sum + weight, 0);
    for (const [joint, weight] of controls)
      combined.set(joint, (combined.get(joint) ?? 0) + weight / total * blend);
    const skin = neckBoneWeights(combined, maximum);
    joints.setElement(vertex, skin.joints); weights.setElement(vertex, skin.weights);
  }
  assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), originalIndices);
  for (const { array, semantic } of before) {
    const attribute = primitive.getAttribute(semantic)!, result = attribute.getArray()!, size = attribute.getElementSize();
    for (let vertex = 0; vertex < attribute.getCount(); vertex++) {
      if (owned.has(vertex) && ["JOINTS_0", "WEIGHTS_0"].includes(semantic)) continue;
      assert.deepEqual(Array.from(result.slice(vertex * size, (vertex + 1) * size)),
        array.slice(vertex * size, (vertex + 1) * size));
    }
  }
} });
const costumeIndices = support.referenceTriangleOffsets.flatMap(at => reference.surface.triangles.slice(at, at + 3));
const costumeEdges = uniqueMeshEdges(costumeIndices), legIndices: number[] = [];
for (let at = 0; at < reference.surface.triangles.length; at += 3) {
  const triangle = reference.surface.triangles.slice(at, at + 3);
  if (triangle.every(vertex => legs.has(vertex))) legIndices.push(...triangle);
}
const legEdges = uniqueMeshEdges(legIndices), usedVertices = [...new Set([...costumeIndices, ...legIndices])];
const records = [];
let fittedProfile: ReturnType<typeof fitSourceClothWeights> | undefined;
const groupControls = [];
const worldPoints = (body: SkinnedMesh) => {
  const points: Vector3[] = [];
  for (const vertex of usedVertices) points[vertex] = body.applyBoneTransform(vertex,
    new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld);
  return points;
};
try {
  for (const frame of frames.records) {
    mode = "source";
    const original = await assets.pack.load("nubian", id, pathToFileURL(path).href);
    const sourceBody = original.root.getObjectByName("body") as SkinnedMesh;
    for (const control of controls) {
      mode = control;
      const worker = await assets.pack.load("nubian", id, pathToFileURL(path).href);
      const body = worker.root.getObjectByName("body") as SkinnedMesh, phases = [];
      const cleanIndex = body.geometry.getAttribute("skinIndex").array.slice();
      const cleanWeight = body.geometry.getAttribute("skinWeight").array.slice();
      if (control === "group-control") groupControls.push({ quality: frame.quality,
        ...auditClothWeightBaseline(body, sourceBody, frame.cells.map(cell => ({ diagnostics: cell.diagnostics,
          label: `${frame.quality}/${cell.troop}/${cell.name}` })),
        owned, reference.points, hips.x, costumeIndices, legIndices) });
      if (control === "fit") {
        if (!fittedProfile) fittedProfile = fitSourceClothWeights(body, sourceBody,
          frames.records.flatMap(record => record.cells.map(cell => ({ diagnostics: cell.diagnostics,
            label: `${record.quality}/${cell.troop}/${cell.name}` }))),
          owned, reference.points, hips.x, costumeIndices, legIndices, value => console.log(JSON.stringify(value)),
          initialProfile?.fittedProfile.weights);
        else for (const group of fittedProfile.weights) for (const vertex of group.vertices) {
          body.geometry.getAttribute("skinIndex").setXYZW(vertex,
            ...[0, 1, 2, 3].map(slot => group.joints[slot] ?? 0) as [number, number, number, number]);
          body.geometry.getAttribute("skinWeight").setXYZW(vertex,
            ...[0, 1, 2, 3].map(slot => group.weights[slot] ?? 0) as [number, number, number, number]);
        }
      }
      if (control === "profile") for (const group of profile.fittedProfile.weights) for (const vertex of group.vertices) {
        assert(owned.has(vertex), "Frozen profile must not change non-costume anatomy");
        assert(group.jointNames.every((name: string, slot: number) => body.skeleton.bones[group.joints[slot]]?.name === name),
          "Frozen profile skeleton differs from the original donor");
        body.geometry.getAttribute("skinIndex").setXYZW(vertex,
          ...[0, 1, 2, 3].map(slot => group.joints[slot] ?? 0) as [number, number, number, number]);
        body.geometry.getAttribute("skinWeight").setXYZW(vertex,
          ...[0, 1, 2, 3].map(slot => group.weights[slot] ?? 0) as [number, number, number, number]);
      }
      for (const cell of frame.cells) {
        const snapshot = { ...cell.diagnostics,
          posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") };
        applyArmourPoseSnapshot(worker.root, snapshot); applyArmourPoseSnapshot(original.root, snapshot);
        const points = worldPoints(body), sourcePoints = worldPoints(sourceBody);
        const candidateIndex = body.geometry.getAttribute("skinIndex").array.slice();
        const candidateWeight = body.geometry.getAttribute("skinWeight").array.slice();
        body.geometry.getAttribute("skinIndex").array.set(cleanIndex);
        body.geometry.getAttribute("skinWeight").array.set(cleanWeight);
        const cleanPoints = worldPoints(body);
        body.geometry.getAttribute("skinIndex").array.set(candidateIndex);
        body.geometry.getAttribute("skinWeight").array.set(candidateWeight);
        const maximumPoseShift = Math.max(...[...owned].map(vertex => points[vertex]!.distanceTo(cleanPoints[vertex]!)));
        for (const vertex of legs) assert(points[vertex]!.distanceToSquared(sourcePoints[vertex]!) < 1e-20);
        const sourceGrid = new TriangleGrid(sourcePoints, costumeIndices), grid = new TriangleGrid(points, costumeIndices);
        const bodyGrid = new TriangleGrid(points, legIndices), witnesses: SurfaceCrossingWitness[] = [];
        const clothBodyCrossings = countSurfaceCrossings(points, costumeEdges, bodyGrid, witnesses, 4096);
        const reverse: SurfaceCrossingWitness[] = [];
        const bodyClothCrossings = countSurfaceCrossings(points, legEdges, grid, reverse, 4096);
        const coverage = witnesses.map(witness => ({ ...witness,
          ...sourceClothContactCoverage(new Vector3().fromArray(witness.point), witness.triangle,
            bodyGrid, sourceGrid, grid) }));
        for (const witness of reverse) {
          const point = new Vector3().fromArray(witness.point), nearest = bodyGrid.closestPoint(point, .0001);
          assert(nearest);
          coverage.push({ ...witness, ...sourceClothContactCoverage(point, nearest.triangle, bodyGrid, sourceGrid, grid) });
        }
        phases.push({ troop: cell.troop, motion: cell.name, clothBodyCrossings, bodyClothCrossings, maximumPoseShift,
          newExposureWitnesses: coverage.filter(witness => witness.newExposure) });
      }
      records.push({ quality: frame.quality, control, fullStrength: Boolean(values["full-strength"]), poses: phases.length,
        maximumNewExposures: Math.max(...phases.map(phase => phase.newExposureWitnesses.length)),
        maximumPoseShift: Math.max(...phases.map(phase => phase.maximumPoseShift)),
        maximumClothBodyCrossings: Math.max(...phases.map(phase => phase.clothBodyCrossings)),
        maximumBodyClothCrossings: Math.max(...phases.map(phase => phase.bodyClothCrossings)), phases });
      worker.dispose();
    }
    original.dispose();
  }
} finally { assets.restore(); }
assert.equal(await sha(), inputSha256);
if (values.profile) assert.equal(createHash("sha256").update(await readFile(values.profile)).digest("hex"), frozenProfileSha256);
await writeFile(values.out, JSON.stringify({ inputSha256, originalUnchanged: true,
  allPositionsNormalsUVIndicesExact: true, allNonCostumeSkinExact: true,
  ownedClothVertices: owned.size, sourceBoneWeights: Object.fromEntries(sourceBoneWeights),
  scope: "CPU-only original closed garment weight controls; no mesh/asset/runtime writes, no acceptance/publication",
  fittedProfile, frozenProfilePath: values.profile, frozenProfileSha256, initialProfilePath: values["initial-profile"], heldOutDense: Boolean(values.dense),
  denseTraining: Boolean(values["training-dense"]), sampling: {
    gaitSamples: values["gait-samples"], attackSamples: values["attack-samples"], phaseOffset: values["phase-offset"],
    runBlends: values["run-blends"] }, groupControls, records }, null, 2));
console.log(JSON.stringify(records.map(({ phases: _phases, ...record }) => record)));
