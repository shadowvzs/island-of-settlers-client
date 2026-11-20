import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PerspectiveCamera, Raycaster, type SkinnedMesh, Vector2, Vector3 } from "three";

import { jointPosition, namedShare, readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { weldedBodyComponents } from "../../../island-of-settlers-worker-generation/src/national-workers/body-components";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { readCpuGltf } from "../assets/read-cpu-gltf";
import { applyArmourPoseSnapshot,type ArmourPoseSnapshot } from "./armour-pose-snapshot";

interface Cell {
  cameraFov: number; cameraPosition: number[]; cameraQuaternion: number[];
  diagnostics: ArmourPoseSnapshot; name: string; troop: string;
}
interface RecordEntry { cells: Cell[]; modelPath: string; modelSha256: string; quality: string; rank: string; state: string; waist: boolean }

const folder = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02/protected-source-af-hhigher");
const review = JSON.parse(readFileSync(resolve(folder, "review.json"), "utf8")) as { records: RecordEntry[] };
const sourceFile = resolve("../island-of-settlers-worker-generation/game_ready/source-cloth-profile-af-literal-diagnostic/nubian-man-scarf/model.glb");
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
assert.equal(hash(sourceFile), "e3b405bf416f38df2c0a969afc685696cdb1b92326aab48fa68e5a9641a79c7c");
const io = await createRetargetIO(), sourceBody = readArmourBody(await io.read(sourceFile));
const components = weldedBodyComponents(sourceBody);
const owner = (first: number) => new Set(components.find(component => component.triangles[0] === first)!.triangles.map(at => at / 3));
const belt = owner(9288), buckle = owner(1035);
const restElbow = jointPosition(sourceBody, "LeftForeArm"), restWrist = jointPosition(sourceBody, "LeftHand");
const restAxis = restWrist.clone().sub(restElbow), restLength = restAxis.length(); restAxis.divideScalar(restLength);
const restDomain = process.argv.includes("--rest-domain");
const source = await readCpuGltf(sourceFile);
const candidateFolder = process.argv.slice(2).find(argument => !argument.startsWith("--"));
assert(!candidateFolder || /^armour-source-af-pilot-[a-z0-9]+$/.test(candidateFolder));
const candidateProof = candidateFolder ? JSON.parse(readFileSync(resolve(
  "../island-of-settlers-worker-generation/game_ready", candidateFolder, "protected-source-proof.json"), "utf8")) : undefined;
if (candidateProof) assert.equal(candidateProof.protectedSourceSha256, hash(sourceFile));
const positions = (mesh: SkinnedMesh) => Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, vertex) =>
  mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld));
const edgeCrossings = (from: TriangleGrid, to: TriangleGrid) => {
  const known = new Set<string>();
  let crossings = 0;
  for (let at = 0; at < from.indices.length; at += 3) for (let edge = 0; edge < 3; edge++) {
    const a = from.indices[at + edge]!, b = from.indices[at + (edge + 1) % 3]!;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (known.has(key)) continue;
    known.add(key);
    const start = from.positions[a]!, delta = from.positions[b]!.clone().sub(start), length = delta.length();
    if (length <= .0000002) continue;
    if (to.raycast(start, delta.divideScalar(length), .0000001, length - .0000001)) crossings++;
  }
  return crossings;
};
const report: unknown[] = [];
for (const quality of ["high", "minimal"]) {
  const record = review.records.find(record => record.quality === quality && record.state === "candidate"
    && record.rank === "soldier" && record.waist)!;
  assert.equal(hash(record.modelPath), record.modelSha256);
  const candidatePath = candidateProof?.file ?? record.modelPath;
  const candidateHash = hash(candidatePath);
  if (candidateProof) assert.equal(candidateHash, candidateProof.candidateSha256);
  const loaded = await readCpuGltf(candidatePath);
  const cells = process.argv.includes("--all-poses") ? record.cells.map((_, at) => at) : [6, 8, 10];
  for (const cellIndex of cells) {
    const cell = record.cells[cellIndex]!;
    const meshes = applyArmourPoseSnapshot(loaded.scene, cell.diagnostics);
    const body = meshes.find(mesh => mesh.name === "body")!;
    const original = applyArmourPoseSnapshot(source.scene, { ...cell.diagnostics,
      posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") })[0]!;
    const originalPoints = positions(original), grids = meshes.map(mesh => ({ name: mesh.name,
      grid: new TriangleGrid(positions(mesh), Array.from(mesh.geometry.index!.array)) }));
    const actualPoints = grids.find(grid => grid.name === "body")!.grid.positions;
    assert.equal(actualPoints.length, originalPoints.length);
    const sourceDifference = Math.max(...actualPoints.map((point, vertex) => point.distanceTo(originalPoints[vertex]!)));
    if (process.argv.includes("--edge-crossings")) {
      const bodyGrid = grids.find(grid => grid.name === "body")!.grid;
      const torsoGrid = grids.find(grid => grid.name.includes("torso"))!.grid;
      const waistIndices = [...belt, ...buckle].flatMap(face => bodyGrid.indices.slice(face * 3, face * 3 + 3));
      const waistGrid = new TriangleGrid(actualPoints, waistIndices);
      const sourceEdgesThroughTorso = edgeCrossings(waistGrid, torsoGrid);
      const torsoEdgesThroughSource = edgeCrossings(torsoGrid, waistGrid);
      report.push({ quality, troop: cell.troop, pose: cell.name, region: "waist-edge-crossings", sourceDifference,
        sourceEdgesThroughTorso, torsoEdgesThroughSource });
      console.log(JSON.stringify({ quality, pose: cell.name, region: "waist-edge-crossings",
        sourceEdgesThroughTorso, torsoEdgesThroughSource }));
    }
    const camera = new PerspectiveCamera(cell.cameraFov, 1, .01, 20);
    camera.position.fromArray(cell.cameraPosition);
    camera.quaternion.fromArray(cell.cameraQuaternion);
    camera.updateMatrixWorld(true);
    const pixel = (point: Vector3) => {
      const ndc = point.clone().project(camera);
      return [(ndc.x + 1) * 160, (1 - ndc.y) * 160];
    };
    const skeleton = cell.diagnostics.skeletons[0]!;
    const joint = (name: string) => new Vector3().setFromMatrixPosition(
      body.skeleton.bones[skeleton.bones.findIndex(bone => bone.name === name)]!.matrixWorld);
    const elbow = joint("LeftForeArm"), wrist = joint("LeftHand");
    const axis = wrist.clone().sub(elbow), length = axis.length(); axis.divideScalar(length);
    const cuffCentre = elbow.clone().lerp(wrist, .72), cuffPixel = pixel(cuffCentre);
    const beltVertices = components.find(component => component.triangles[0] === 9288)!.vertices;
    const waistPixels = [...beltVertices].map(vertex => pixel(actualPoints[vertex]!));
    const bounds = {
      cuff: [cuffPixel[0]! - 32, cuffPixel[1]! - 32, cuffPixel[0]! + 32, cuffPixel[1]! + 32],
      waist: [Math.min(...waistPixels.map(point => point[0]!)) - 3, Math.min(...waistPixels.map(point => point[1]!)) - 3,
        Math.max(...waistPixels.map(point => point[0]!)) + 3, Math.max(...waistPixels.map(point => point[1]!)) + 3],
    };
    for (const region of ["cuff", "waist"] as const) {
      const area = bounds[region], failures = [], counts = { rays: 0, bodyFirst: 0, addedFirst: 0 };
      const raycaster = new Raycaster();
      for (let y = Math.max(0, Math.floor(area[1]!)); y <= Math.min(319, Math.ceil(area[3]!)); y += 2)
        for (let x = Math.max(0, Math.floor(area[0]!)); x <= Math.min(319, Math.ceil(area[2]!)); x += 2) {
          counts.rays++;
          raycaster.setFromCamera(new Vector2(x / 160 - 1, 1 - y / 160), camera);
          const hits = grids.flatMap(({ grid, name }) => {
            const hit = grid.raycast(raycaster.ray.origin, raycaster.ray.direction, .01, 2);
            return hit ? [{ ...hit, name, grid }] : [];
          }).sort((a, b) => a.distance - b.distance);
          const first = hits[0];
          if (!first) continue;
          if (first.name !== "body") { counts.addedFirst++; continue; }
          counts.bodyFirst++;
          const point = raycaster.ray.at(first.distance, new Vector3());
          const along = point.clone().sub(elbow).dot(axis) / length;
          const ids = [0, 1, 2].map(corner => first.grid.indices[first.triangle * 3 + corner]!);
          const restPoint = ids.reduce((sum, vertex, at) =>
            sum.addScaledVector(sourceBody.points[vertex]!, first.bary[at]!), new Vector3());
          const restAlong = restPoint.sub(restElbow).dot(restAxis) / restLength;
          const forearm = ids.every(vertex => namedShare(sourceBody, vertex, ["LeftForeArm", "LeftHand"]) > .5);
          const ownedWaist = belt.has(first.triangle) || buckle.has(first.triangle);
          const ownedAlong = restDomain ? restAlong : along;
          if (region === "cuff" && (!forearm || ownedAlong < .60 || ownedAlong > .84)) continue;
          if (region === "waist" && !ownedWaist) continue;
          const added = hits.find(hit => region === "cuff" ? hit.name.includes("forearm") : hit.name.includes("torso"));
          if (!added || added.distance - first.distance <= .0002) continue;
          const waistOwner = buckle.has(first.triangle) ? "original-buckle" : "original-belt";
          failures.push({ pixel: [x, y], bodyFace: first.triangle, bodyVertices: ids,
            owner: region === "cuff" ? "original-forearm" : waistOwner,
            along, restAlong, addedMesh: added.name, addedFace: added.triangle, depth: added.distance - first.distance });
        }
      report.push({ quality, troop: cell.troop, pose: cell.name, region, sourceDifference, cuffPixel, bounds: area,
        counts, bodyThroughAddedInteriorSamples: failures.length, maximumReversal: Math.max(0, ...failures.map(value => value.depth)),
        failures: failures.slice(0, 12) });
      console.log(JSON.stringify({ quality, pose: cell.name, region, sourceDifference, failures: failures.length,
        maximumReversal: Math.max(0, ...failures.map(value => value.depth)) }));
    }
  }
  assert.equal(hash(record.modelPath), record.modelSha256);
  assert.equal(hash(candidatePath), candidateHash);
}
assert.equal(hash(sourceFile), "e3b405bf416f38df2c0a969afc685696cdb1b92326aab48fa68e5a9641a79c7c");
const suffix = `${process.argv.includes("--edge-crossings") ? "-edge-crossings" : ""}${restDomain ? "-rest-domain" : ""}`;
const outputFile = candidateProof ? resolve(candidateProof.file, `../../../native-pose-geometry-audit${suffix}.json`)
  : resolve(folder, `geometry-audit${suffix}.json`);
writeFileSync(outputFile, JSON.stringify({ sourceUnchanged: true, candidateUnchanged: true,
  candidateFolder: candidateFolder ?? "armour-source-af-pilot-allg", candidateSha256: candidateProof?.candidateSha256,
  actualNewNativeCapture: false, sourceNativeReview: folder,
  forearmDomain: restDomain ? "Original source rest-space axial band .60–.84; posed axial position is diagnostic only"
    : "PRELIMINARY posed axial band; may include a flexed hand and is not reliable cuff ownership",
  scope: "Exact captured native body/torso/forearm matrices; excludes held weapons and rigid helmet/greaves. Conservative2px grid, waist owners explicit original topology.",
  report }, null, 2));
