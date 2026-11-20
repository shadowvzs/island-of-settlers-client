import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type SkinnedMesh, Vector3 } from "three";

import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import type { ArmourPoseSampling } from "./armour-equipped-motions";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { applyLoadedSourceClothProfile } from "./source-cloth-loaded-profile";

const root = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02");
const output = resolve(root, "source-cloth-skin-v-literal-diagnostic");
const ready = resolve("../island-of-settlers-worker-generation/game_ready"), id = "nubian-man-scarf";
const sourcePath = resolve(ready, "original-clothes-review", id, "model.glb");
const compareK = process.argv.includes("--candidate=k"), compareAF = process.argv.includes("--candidate=af");
const badControl = process.argv.includes("--bad-control"), reapplyV = process.argv.includes("--reapply-v");
let appliedProfileName: string | undefined;
if (compareK) appliedProfileName = "source-cloth-seam-k-profile.json";
if (compareAF) appliedProfileName = "source-cloth-left-af-profile.json";
if (reapplyV) appliedProfileName = "source-cloth-regional-v-profile.json";
const candidateFolder = badControl ? "source-cloth-profile-j-literal-diagnostic" : "source-cloth-profile-v-literal-diagnostic";
const candidatePath = resolve(ready, candidateFolder, id, "model.glb");
const kProfileBytes = appliedProfileName ? await readFile(resolve(root, appliedProfileName)) : undefined;
const kProfile = kProfileBytes ? JSON.parse(kProfileBytes.toString("utf8")) : undefined;
const kProfileSha256 = kProfileBytes && createHash("sha256").update(kProfileBytes).digest("hex");
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const sourceSha256 = await hash(sourcePath), candidateSha256 = await hash(candidatePath);
const io = await createRetargetIO(), document = await io.read(sourcePath), primitive = skinnedNode(document).getMesh()!.listPrimitives()[0]!;
assert.equal(primitive.getAttribute("POSITION")!.getCount(), 11505);
assert.equal(primitive.getIndices()!.getCount(), 30258);
const indices = Array.from(primitive.getIndices()!.getArray()!);
const support = buildSourceKiltPanels(await io.read(sourcePath), id);
assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), indices);
const costume = new Set(support.referenceTriangleOffsets.map(at => at / 3)), legs = new Set(support.originalLegVertices);
const legIndices = indices.filter((_, at) => indices.slice(Math.floor(at / 3) * 3, Math.floor(at / 3) * 3 + 3)
  .every(vertex => legs.has(vertex)));
const doubleSided = primitive.getMaterial()!.getDoubleSided();
const native = JSON.parse(await readFile(resolve(output, "review.json"), "utf8"));
const validation = JSON.parse(await readFile(resolve(root, "source-cloth-v-oldheldout-validation.json"), "utf8"));
const phases = validation.records.find((record: { quality: string }) => record.quality === "high").phases;
const positions = (body: SkinnedMesh) => Array.from({ length: 11505 }, (_, vertex) => body.applyBoneTransform(vertex,
  new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld));
const allWitnesses = process.argv.includes("--all-witnesses");
const assets = await createHatchAuditAssets(), records = [];
try {
  const original = await assets.pack.load("nubian", id, pathToFileURL(sourcePath).href);
  const candidate = await assets.pack.load("nubian", id, pathToFileURL(candidatePath).href);
  if (appliedProfileName) {
    const body = candidate.root.getObjectByName("body") as SkinnedMesh;
    const beforeIndex = Array.from(body.geometry.getAttribute("skinIndex").array);
    const beforeWeight = Array.from(body.geometry.getAttribute("skinWeight").array);
    applyLoadedSourceClothProfile(body, kProfile.fittedProfile.weights, new Set(support.ownedVertices), legs);
    if (reapplyV) {
      assert.deepEqual(Array.from(body.geometry.getAttribute("skinIndex").array), beforeIndex);
      assert.deepEqual(Array.from(body.geometry.getAttribute("skinWeight").array), beforeWeight);
    }
  }
  const saved = native.records.find((record: { quality: string; state: string; waist: boolean }) =>
    record.quality === "high" && record.state === "candidate" && record.waist);
  const cases = [];
  if (allWitnesses) for (const corpus of badControl ? ["J-original", "J-dense"] : ["oldheldout", "newheldout"]) {
    let sampling: ArmourPoseSampling | undefined = corpus === "oldheldout"
      ? { gaitSamples: 48, attackSamples: 72, phaseOffset: .25, runBlends: [.125, .375, .625, .875] }
      : { gaitSamples: 47, attackSamples: 71, phaseOffset: .37, runBlends: [.2, .4, .6, .8, .95] };
    if (corpus === "J-original") sampling = undefined;
    if (corpus === "J-dense") sampling = { gaitSamples: 32, attackSamples: 48, phaseOffset: .5, runBlends: [.25, .5, .75] };
    const reportPath = badControl ? "source-kilt-original-skin-fit-j.json" : `source-cloth-${compareAF ? "af" : "v"}-${corpus}-validation.json`;
    const report = JSON.parse(await readFile(resolve(root, reportPath), "utf8"));
    const source = report.records.find((record: { quality: string; poses: number }) => record.quality === "high"
      && (!badControl || record.poses === (corpus === "J-original" ? 90 : 630))).phases;
    const frame = await createEquippedCpuFrames({ folder: "source-kilt-surface-de", bodies: [id],
      ranks: ["recruit"], qualities: ["high"], sampling });
    for (const phase of source.filter((phase: { newExposureWitnesses: unknown[] }) => phase.newExposureWitnesses.length)) {
      const cell = frame.records[0]!.cells.find(cell => cell.troop === phase.troop && cell.name === phase.motion)!;
      assert(cell);
      cases.push({ corpus, troop: phase.troop, motion: phase.motion, witnesses: phase.newExposureWitnesses,
        cell: { ...cell, angle: .18, diagnostics: { ...cell.diagnostics,
          posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") } } });
    }
  }
  else for (const troop of ["shield", "archer"]) for (const name of ["run front", "windup front"]) {
    const cell = saved.cells.find((cell: { troop: string; name: string }) => cell.troop === troop && cell.name === name);
    const motion = name === "run front" ? "blend-0.875/23/48" : "attack/61/72";
    const witnesses = phases.find((phase: { troop: string; motion: string }) => phase.troop === troop && phase.motion === motion).newExposureWitnesses;
    if (witnesses.length) cases.push({ corpus: "native-aligned", troop, motion, cell, witnesses });
  }
  for (const { cell, corpus, motion, troop, witnesses } of cases) {
    applyArmourPoseSnapshot(original.root, cell.diagnostics); applyArmourPoseSnapshot(candidate.root, cell.diagnostics);
    const before = new TriangleGrid(positions(original.root.getObjectByName("body") as SkinnedMesh), indices);
    const after = new TriangleGrid(positions(candidate.root.getObjectByName("body") as SkinnedMesh), indices);
    const body = new TriangleGrid(after.positions, legIndices);
    const trace = (grid: TriangleGrid, origin: Vector3, direction: Vector3, length: number) => {
      const hit = grid.raycast(origin, direction, .00002, length, hit => doubleSided || hit.facing < 0);
      if (!hit) return null;
      const vertices = indices.slice(hit.triangle * 3, hit.triangle * 3 + 3);
      let role = "other-original-body";
      if (vertices.every(vertex => legs.has(vertex))) role = "original-leg";
      if (costume.has(hit.triangle)) role = "original-costume";
      return { role, distance: hit.distance, face: hit.triangle, vertices };
    };
    for (const witness of witnesses) {
      const point = new Vector3().fromArray(witness.point), alignment = body.closestPoint(point, .001);
      if (!alignment || alignment.distance > 1e-6) {
        records.push({ corpus, troop, motion, witness, nativeAligned: false, nearestNativeLegDistance: alignment?.distance }); continue;
      }
      const newVisible = [], newBackground = [], roles = new Map<string, number>();
      for (const elevation of [-.4, 0, .3, .6, 1]) for (let angle = 0; angle < 16; angle++) {
        const yaw = angle * Math.PI / 8, towards = new Vector3(Math.sin(yaw) * Math.cos(elevation),
          Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)).negate();
        const origin = point.clone().addScaledVector(towards, -.85);
        const old = trace(before, origin, towards, 3), current = trace(after, origin, towards, 3);
        const key = `${old?.role ?? "background"}->${current?.role ?? "background"}`;
        roles.set(key, (roles.get(key) ?? 0) + 1);
        if (old?.role === "original-costume" && current?.role === "original-leg") newVisible.push({ elevation, yaw, old, current });
        if (old?.role === "original-costume" && !current) newBackground.push({ elevation, yaw, old });
      }
      const normal = body.corner(alignment.triangle, 1).clone().sub(body.corner(alignment.triangle, 0))
        .cross(body.corner(alignment.triangle, 2).clone().sub(body.corner(alignment.triangle, 0))).normalize();
      const normalOrigin = point.clone().addScaledVector(normal, .0001);
      const camera = new Vector3(Math.sin(cell.angle) * .85, .65, Math.cos(cell.angle) * .85);
      const direction = point.clone().sub(camera), length = direction.length(); direction.divideScalar(length);
      records.push({ corpus, troop, motion, witness, nativeAligned: true, nearestNativeLegDistance: alignment.distance,
        sampledExteriorDirections: 80, newlyVisibleLegDirections: newVisible.length, newlyVisibleBackgroundDirections: newBackground.length, newBackground, rolePairs: Object.fromEntries(roles),
        newVisible, wholeBodyNormalOutside: { before: trace(before, normalOrigin, normal, .25), after: trace(after, normalOrigin, normal, .25) },
        cameraIsSavedNative: !allWitnesses, nativeCamera: { before: trace(before, camera, direction, length + .05),
          after: trace(after, camera, direction, length + .05), witnessDistance: length } });
    }
  }
  original.dispose(); candidate.dispose();
} finally { assets.restore(); }
assert.equal(await hash(sourcePath), sourceSha256); assert.equal(await hash(candidatePath), candidateSha256);
if (appliedProfileName) assert.equal(createHash("sha256").update(await readFile(resolve(root, appliedProfileName))).digest("hex"), kProfileSha256);
let reportName = allWitnesses ? "all-witness-visibility.json" : "native-witness-visibility.json";
if (compareK) reportName = "k-on-v-witness-visibility.json";
if (compareAF) reportName = "af-visible-regression-gate.json";
if (badControl) reportName = "j-positive-control-visibility.json";
if (reapplyV) reportName = "v-reapply-normalization-control.json";
await writeFile(resolve(output, reportName), JSON.stringify({ sourceSha256, candidateSha256, appliedProfileName, appliedProfileSha256: kProfileSha256,
  candidateRepresentation: appliedProfileName ? "Identical literal source mesh with frozen named garment skin applied only in memory" : candidateFolder, records,
  visibleRegressionGatePassed: records.every(record => record.nativeAligned && record.newlyVisibleLegDirections === 0 && record.newlyVisibleBackgroundDirections === 0),
  originalClothOnlyCounterRetained: true, loaderNormalizationRepresented: true,
  exactLoadedVReapplyControl: reapplyV, allAcceptanceTolerancesUnchanged: true,
  scope: "Exact saved native matrices/camera, unchanged complete source-body occlusion and80 exterior directions per aligned V witness. No props included; no gate/tolerance/model changes." }, null, 2));
console.log(JSON.stringify(records.map(record => ({ corpus: record.corpus, troop: record.troop, motion: record.motion,
  nativeAligned: record.nativeAligned, newlyVisibleLegDirections: record.newlyVisibleLegDirections,
  nearestNativeLegDistance: record.nearestNativeLegDistance }))));
