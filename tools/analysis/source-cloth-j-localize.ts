import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { PerspectiveCamera, type SkinnedMesh, Vector3 } from "three";

import { readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const output = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02");
const { values } = parseArgs({ options: { "full-matrix": { type: "boolean" } } });
const ready = resolve("../island-of-settlers-worker-generation/game_ready"), id = "nubian-man-scarf";
const originalPath = resolve(ready, "original-clothes-review", id, "model.glb");
const candidatePath = resolve(ready, "source-cloth-profile-j-literal-diagnostic", id, "model.glb");
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const originalSha256 = await hash(originalPath), candidateSha256 = await hash(candidatePath);
const io = await createRetargetIO(), document = await io.read(originalPath), reference = readArmourBody(document);
const support = buildSourceKiltPanels(await io.read(originalPath), id);
const primitive = skinnedNode(document).getMesh()!.listPrimitives()[0]!;
const owned = new Set(support.ownedVertices), legs = new Set(support.originalLegVertices);
const indices = Array.from(primitive.getIndices()!.getArray()!);
const costumeFaces = new Set(support.referenceTriangleOffsets.map(at => at / 3));
const costumeIndices = support.referenceTriangleOffsets.flatMap(at => indices.slice(at, at + 3));
const legIndices: number[] = [];
for (let at = 0; at < indices.length; at += 3) {
  const face = indices.slice(at, at + 3);
  if (face.every(vertex => legs.has(vertex))) legIndices.push(...face);
}
const material = primitive.getMaterial()!, doubleSided = material.getDoubleSided();
const baseColor = material.getBaseColorTexture();
if (baseColor?.getImage()) await writeFile(resolve(output, "source-cloth-j-original-albedo.bin"), baseColor.getImage()!);
const profile = JSON.parse(await readFile(resolve(output, "source-kilt-original-skin-fit-j.json"), "utf8"));
const native = JSON.parse(await readFile(resolve(output, "source-cloth-skin-j-diagnostic/review.json"), "utf8"));
const vertex = (id: number) => ({ id, point: reference.points[id]!.toArray(), cloth: owned.has(id), leg: legs.has(id),
  originalJoints: reference.surface.joints[id]!.map((joint, slot) => ({
    name: reference.skeleton.names[reference.surface.jointNodes[joint]!]!, weight: reference.surface.weights[id]![slot] })),
  candidate: profile.fittedProfile.weights.find((group: { vertices: number[] }) => group.vertices.includes(id)) });
const regions = [
  { name: "waist", clothVertices: [6656, 6655], bodyFaces: [46], clothFaces: [] as number[] },
  { name: "body-boundary", clothVertices: [] as number[], bodyFaces: [] as number[], clothFaces: [2944, 2946] },
  { name: "run", clothVertices: [] as number[], bodyFaces: [] as number[], clothFaces: [2945] },
  { name: "heldout-left", clothVertices: [1996, 1560], bodyFaces: [] as number[], clothFaces: [5088] },
  { name: "heldout-attack", clothVertices: [4856, 4855, 4857, 4858], bodyFaces: [] as number[], clothFaces: [1210] },
].map(region => ({ name: region.name, vertices: region.clothVertices.map(vertex),
  clothFaces: region.clothFaces.map(face => ({ local: face, global: support.referenceTriangleOffsets[face]! / 3,
    vertices: costumeIndices.slice(face * 3, face * 3 + 3).map(vertex) })),
  bodyFaces: region.bodyFaces.map(face => ({ local: face,
    vertices: legIndices.slice(face * 3, face * 3 + 3).map(vertex) })) }));
const positions = (body: SkinnedMesh) => Array.from({ length: body.geometry.getAttribute("position").count }, (_, vertex) =>
  body.applyBoneTransform(vertex, new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex))
    .applyMatrix4(body.matrixWorld));
const describe = (grid: TriangleGrid, face: number, bary: readonly number[]) => {
  const vertices = indices.slice(face * 3, face * 3 + 3), uv = primitive.getAttribute("TEXCOORD_0")!;
  const tex = [0, 0];
  vertices.forEach((vertex, corner) => uv.getElement(vertex, []).forEach((value, axis) => {
    tex[axis]! += value * bary[corner]!;
  }));
  const normal = grid.corner(face, 1).clone().sub(grid.corner(face, 0))
    .cross(grid.corner(face, 2).clone().sub(grid.corner(face, 0))).normalize();
  let role = "other-original-body";
  if (costumeFaces.has(face)) role = "lower-costume";
  if (vertices.every(vertex => legs.has(vertex))) role = "real-leg";
  return { globalFace: face, vertices, role, uv: tex, normal: normal.toArray() };
};
const assets = await createHatchAuditAssets(), visibility = [], marks = [];
const exterior: unknown[] = [];
try {
  const original = await assets.pack.load("nubian", id, pathToFileURL(originalPath).href);
  const candidate = await assets.pack.load("nubian", id, pathToFileURL(candidatePath).href);
  const originalBody = original.root.getObjectByName("body") as SkinnedMesh;
  const candidateBody = candidate.root.getObjectByName("body") as SkinnedMesh;
  const record = native.records.find((record: { quality: string; state: string; waist: boolean }) =>
    record.quality === "high" && record.state === "candidate" && record.waist);
  for (const cell of record.cells) {
    applyArmourPoseSnapshot(original.root, cell.diagnostics);
    applyArmourPoseSnapshot(candidate.root, cell.diagnostics);
    const originalGrid = new TriangleGrid(positions(originalBody), indices);
    const candidateGrid = new TriangleGrid(positions(candidateBody), indices);
    const camera = new PerspectiveCamera(32, 1, .01, 20);
    camera.position.set(Math.sin(cell.angle) * .85, .65, Math.cos(cell.angle) * .85);
    camera.lookAt(0, .45, 0); camera.updateMatrixWorld(true);
    const ray = (grid: TriangleGrid, point: Vector3) => {
      const direction = point.clone().sub(camera.position), distance = direction.length();
      const hit = grid.raycast(camera.position, direction.divideScalar(distance), .001, distance + .05,
        hit => doubleSided || hit.facing < 0);
      if (!hit) return null;
      return { ...describe(grid, hit.triangle, hit.bary), distance: hit.distance,
        witnessOcclusion: distance - hit.distance, facing: hit.facing };
    };
    const probes = [
      { troop: "shield", name: "idle front", pixel: [102, 287] },
      { troop: "heavy", name: "idle front", pixel: [91, 289] },
      { troop: "shield", name: "run front", pixel: [128, 248] },
      { troop: "heavy", name: "windup front", pixel: [76, 267] },
      { troop: "archer", name: "idle front", pixel: [98, 290] },
    ];
    for (const probe of probes.filter(probe => probe.troop === cell.troop && probe.name === cell.name)) {
      const point = new Vector3(probe.pixel[0]! / 160 - 1, 1 - probe.pixel[1]! / 160, .5).unproject(camera);
      const direction = point.clone().sub(camera.position).normalize();
      const hit = candidateGrid.raycast(camera.position, direction, .001, 3, hit => doubleSided || hit.facing < 0);
      marks.push({ troop: cell.troop, motion: cell.name, pixel: probe.pixel,
        hit: hit && { ...describe(candidateGrid, hit.triangle, hit.bary), facing: hit.facing } });
    }
    let phase: string | undefined;
    if (cell.name === "run front") phase = "run/13/32";
    if (cell.name === "windup front") phase = "attack/17/48";
    if (!phase) continue;
    const phases = profile.records.find((record: { quality: string; poses: number }) =>
      record.quality === "high" && record.poses === 630).phases;
    const source = phases.find((phaseRecord: { troop: string; motion: string }) =>
      phaseRecord.troop === cell.troop && phaseRecord.motion === phase);
    for (const witness of source.newExposureWitnesses) {
      const point = new Vector3().fromArray(witness.point), projected = point.clone().project(camera);
      visibility.push({ troop: cell.troop, phase, witness, pixel: [(projected.x + 1) * 160, (1 - projected.y) * 160],
        original: ray(originalGrid, point), candidate: ray(candidateGrid, point) });
    }
  }
  if (values["full-matrix"]) for (const dense of [true, false]) {
    const frames = await createEquippedCpuFrames({ folder: "source-kilt-surface-de", bodies: [id],
      ranks: ["recruit"], qualities: ["high"], sampling: dense
        ? { gaitSamples: 32, attackSamples: 48, phaseOffset: .5, runBlends: [.25, .5, .75] } : undefined });
    const saved = profile.records.find((record: { quality: string; poses: number }) =>
      record.quality === "high" && record.poses === (dense ? 630 : 90));
    for (const phase of saved.phases.filter((phase: { newExposureWitnesses: unknown[] }) => phase.newExposureWitnesses.length)) {
      const cell = frames.records[0]!.cells.find(cell => cell.troop === phase.troop && cell.name === phase.motion)!;
      assert(cell, "Stored witness phase is absent from exact canonical CPU pose reproduction");
      const snapshot = { ...cell.diagnostics, posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") };
      applyArmourPoseSnapshot(original.root, snapshot); applyArmourPoseSnapshot(candidate.root, snapshot);
      const originalPoints = positions(originalBody), candidatePoints = positions(candidateBody);
      for (const vertex of legs) assert.equal(candidatePoints[vertex]!.distanceToSquared(originalPoints[vertex]!), 0);
      const originalGrid = new TriangleGrid(originalPoints, indices), candidateGrid = new TriangleGrid(candidatePoints, indices);
      const bodyGrid = new TriangleGrid(candidatePoints, legIndices);
      const trace = (grid: TriangleGrid, origin: Vector3, direction: Vector3, max = .88) => {
        const hit = grid.raycast(origin, direction, .00002, max, hit => doubleSided || hit.facing < 0);
        return hit && { ...describe(grid, hit.triangle, hit.bary), distance: hit.distance, facing: hit.facing };
      };
      for (const witness of phase.newExposureWitnesses) {
        const point = new Vector3().fromArray(witness.point), contact = bodyGrid.closestPoint(point, .0001);
        assert(contact && contact.distance < 1e-7, "Frozen witness no longer matches the actual unchanged leg surface");
        const normal = bodyGrid.corner(contact.triangle, 1).clone().sub(bodyGrid.corner(contact.triangle, 0))
          .cross(bodyGrid.corner(contact.triangle, 2).clone().sub(bodyGrid.corner(contact.triangle, 0))).normalize();
        const outward = point.clone().addScaledVector(normal, .0001), inward = normal.clone().negate();
        const rays = [], newExposed = [], candidateLeg = [];
        for (const elevation of [-.4, 0, .3, .6, 1]) for (let angle = 0; angle < 16; angle++) {
          const yaw = angle * Math.PI / 8;
          const direction = new Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
            Math.cos(yaw) * Math.cos(elevation));
          const origin = point.clone().addScaledVector(direction, .85), towards = direction.clone().negate();
          const before = trace(originalGrid, origin, towards), after = trace(candidateGrid, origin, towards);
          const ray = { elevation, yaw, before, after };
          if (after?.role === "real-leg") {
            candidateLeg.push({ elevation, yaw });
            if (before?.role === "lower-costume") newExposed.push(ray);
          }
          rays.push({ before: before?.role, after: after?.role });
        }
        exterior.push({ dense, troop: phase.troop, motion: phase.motion, witness,
          normal: normal.toArray(), originalNormalOutside: trace(originalGrid, outward, normal, .25),
          candidateNormalOutside: trace(candidateGrid, outward, normal, .25),
          candidateNormalInside: trace(candidateGrid, outward, inward, .25),
          sampledDirections: rays.length, newExposedDirections: newExposed.length,
          candidateLegDirections: candidateLeg.length, newExposed: newExposed.slice(0, 8) });
      }
      console.log(JSON.stringify({ dense, troop: phase.troop, phase: phase.motion,
        witnesses: phase.newExposureWitnesses.length, exteriorSoFar: exterior.length }));
    }
  }
  original.dispose(); candidate.dispose();
} finally { assets.restore(); }
assert.equal(await hash(originalPath), originalSha256);
assert.equal(await hash(candidatePath), candidateSha256);
const reportName = values["full-matrix"] ? "source-cloth-j-localized.json" : "source-cloth-j-localized-native-only.json";
await writeFile(resolve(output, reportName), JSON.stringify({ originalSha256, candidateSha256,
  doubleSided, textureName: baseColor?.getName(), textureMime: baseColor?.getMimeType(),
  originalAndCandidateUnchanged: true, regions, visibility, marks, exterior,
  scope: "Read-only source/native-pose localization. Whole source-body occlusion excludes separate military props. No candidate, geometry, texture, rig or tolerance mutation." }, null, 2));
console.log(JSON.stringify({ doubleSided, marks, visibility }, null, 2));
