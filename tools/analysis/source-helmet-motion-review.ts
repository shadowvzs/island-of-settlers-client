import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Mesh, type SkinnedMesh, Vector3 } from "three";

import { groupShare, indexedBodyVertices, jointMatrix, readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { fitHead } from "../../../island-of-settlers-worker-generation/src/armour/head-fit";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, out: { type: "string" } } });
if (!values.folder || !/^[a-z0-9-]+$/.test(values.folder) || !values.out)
  throw new Error("Choose a preserved-source helmet pack and diagnostic output");
const folder = values.folder, id = "nubian-man-scarf";
const receipt = JSON.parse(await readFile(resolve("../island-of-settlers-worker-generation/game_ready",
  folder, "nubian", id, "source-helmet.json"), "utf8"));
const io = await createRetargetIO(), reference = readArmourBody(await io.read(receipt.bodyFile));
const head = fitHead(reference), indexed = indexedBodyVertices(reference);
const vertices = reference.points.flatMap((point, vertex) => indexed.has(vertex)
  && groupShare(reference, vertex, "head") >= .5 && point.y >= head.brow ? [vertex] : []);
const localCentre = head.centre.clone().applyMatrix4(jointMatrix(reference, "Head").invert());
const headIndices: number[] = [];
for (let at = 0; at < reference.surface.triangles.length; at += 3) {
  const face = reference.surface.triangles.slice(at, at + 3);
  if (face.some(vertex => reference.points[vertex]!.y >= head.chin)) headIndices.push(...face);
}
const headVertices = [...new Set(headIndices)], headRemap = new Map(headVertices.map((vertex, index) => [vertex, index]));
const compactHeadIndices = headIndices.map(vertex => headRemap.get(vertex)!);
const frames = await createEquippedCpuFrames({ folder, bodies: [id], ranks: ["recruit"], qualities: ["high", "minimal"] });
const assets = await createHatchAuditAssets({ armourFolder: folder }), records = [];
try {
  for (const record of frames.records) {
    assert.equal(record.modelSha256, receipt.bodySha256);
    const minimal = record.quality === "minimal", worker = await assets.soldier("nubian", id, "recruit", minimal);
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
    const source = worker.root.getObjectByName("body") as SkinnedMesh;
    const helmet = worker.root.getObjectByName(`armour_head_lod${minimal ? 1 : 0}`) as Mesh;
    if (!source?.isSkinnedMesh || !helmet?.isMesh || !helmet.visible) throw new Error("Actual source head or helmet LOD is missing");
    const position = source.geometry.getAttribute("position"), shellPosition = helmet.geometry.getAttribute("position");
    const indices = Array.from(helmet.geometry.index!.array), phases = [];
    const headBone = source.skeleton.bones.find(bone => bone.name === "Head")!;
    const helmetToHead = headBone.matrixWorld.clone().invert().multiply(helmet.matrixWorld);
    for (const cell of record.cells) {
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      // The snapshot restores skinned meshes/bones only. Rigid helmet descendants follow
      // their exact unchanged local chain from that captured Head matrix, not the stale rest pose.
      helmet.matrixWorld.multiplyMatrices(headBone.matrixWorld, helmetToHead);
      const centre = localCentre.clone().applyMatrix4(headBone.matrixWorld);
      const shellPoints = Array.from({ length: shellPosition.count }, (_, vertex) =>
        new Vector3().fromBufferAttribute(shellPosition, vertex).applyMatrix4(helmet.matrixWorld));
      const grid = new TriangleGrid(shellPoints, indices);
      const sourcePoints = headVertices.map(vertex => source.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(position, vertex)).applyMatrix4(source.matrixWorld));
      const sourceGrid = new TriangleGrid(sourcePoints, compactHeadIndices), outerGaps: number[] = [];
      let minimumGap = Infinity, penetrations = 0, missing = 0, witness: unknown;
      for (const vertex of vertices) {
        const skin = source.applyBoneTransform(vertex, new Vector3().fromBufferAttribute(position, vertex))
          .applyMatrix4(source.matrixWorld);
        const outward = skin.clone().sub(centre), radius = outward.length(); outward.divideScalar(radius);
        const hit = grid.raycast(centre, outward, 0, .4 * WORKER_SCALE);
        if (!hit) { missing++; continue; }
        const gap = hit.distance - radius;
        const reach = .4 * WORKER_SCALE, outside = centre.clone().addScaledVector(outward, reach);
        const outerSource = sourceGrid.raycast(outside, outward.clone().negate(), 0, reach);
        if (outerSource && Math.abs(reach - outerSource.distance - radius) < .001) outerGaps.push(gap);
        if (gap < minimumGap) {
          minimumGap = gap;
          witness = { vertex, skin: skin.toArray(), shell: centre.clone().addScaledVector(outward, hit.distance).toArray(),
            rest: reference.points[vertex]!.toArray() };
        }
        if (gap < -.0005) penetrations++;
      }
      outerGaps.sort((a, b) => a - b);
      phases.push({ troop: cell.troop, motion: cell.name, minimumGap, penetrations, missing, witness,
        maximumOuterGap: Math.max(...outerGaps), percentile95OuterGap: outerGaps[Math.floor(outerGaps.length * .95)] });
    }
    records.push({ quality: record.quality, bodySha256: record.modelSha256, helmetSha256: receipt.outputSha256,
      sourceHeadWitnesses: vertices.length, minimumGap: Math.min(...phases.map(phase => phase.minimumGap)),
      maximumPenetrations: Math.max(...phases.map(phase => phase.penetrations)),
      maximumMissing: Math.max(...phases.map(phase => phase.missing)),
      maximumOuterGap: Math.max(...phases.map(phase => phase.maximumOuterGap)),
      maximumPercentile95OuterGap: Math.max(...phases.map(phase => phase.percentile95OuterGap ?? 0)), phases });
    worker.dispose();
  }
} finally { assets.restore(); }
await writeFile(values.out, JSON.stringify({ rigidHeadClosure: true,
  scope: "Exact serialized preserved source head/hair and refitted rigid helmet in ninety production equipped phases/detail. Original body remains byte-identical. Rigid helmet uses exact local closure from captured Head. Rays above the original brow measure actual shell intersections; misses at face/rim/crown remain explicit and require native inspection. No publication.", records }, null, 2));
console.log(JSON.stringify(records.map(({ phases: _phases, ...record }) => record)));
