import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, out: { type: "string" } } });
if (!values.folder || !/^[a-z0-9-]+$/.test(values.folder) || !values.out)
  throw new Error("Choose an explicit source-faithful armour stage and diagnostic receipt");
const folder = values.folder, id = "nubian-man-scarf";
const ready = resolve("../island-of-settlers-worker-generation/game_ready");
const provenance = JSON.parse(await readFile(resolve(ready, folder, "nubian", id, "source-shell.json"), "utf8"));
const frames = await createEquippedCpuFrames({ folder, bodies: [id], ranks: ["recruit"], qualities: ["high", "minimal"] });
const assets = await createHatchAuditAssets({ armourFolder: folder }), records = [];
try {
  for (const record of frames.records) {
    assert.equal(record.modelSha256, provenance.outputSha256);
    const minimal = record.quality === "minimal", worker = await assets.soldier("nubian", id, "recruit", minimal);
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
    const source = worker.root.getObjectByName("body") as SkinnedMesh;
    const shell = worker.root.getObjectByName(`armour_torso_lod${minimal ? 1 : 0}`) as SkinnedMesh;
    if (!source?.isSkinnedMesh || !shell?.isSkinnedMesh) throw new Error("Actual source body or padded shell is missing");
    if (shell.geometry.getAttribute("position").count !== provenance.sourceAnchors.length)
      throw new Error("Actual shell lost its source-facet correspondence");
    const point = (mesh: SkinnedMesh, vertex: number) => mesh.applyBoneTransform(vertex,
      new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld);
    const phases = [];
    for (const cell of record.cells) {
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      let minimumClearance = Infinity, maximumDistance = 0, penetrations = 0;
      let witness: unknown;
      const sourcePoints = new Map<number, Vector3>();
      const original = (vertex: number) => {
        if (!sourcePoints.has(vertex)) sourcePoints.set(vertex, point(source, vertex));
        return sourcePoints.get(vertex)!;
      };
      provenance.sourceAnchors.forEach((anchor: { vertices: number[]; bary: number[] }, vertex: number) => {
        const base = anchor.bary.reduce((sum, weight, corner) =>
          sum.addScaledVector(original(anchor.vertices[corner]!), weight), new Vector3());
        const [a, b, c] = anchor.vertices.map(original);
        const normal = b!.clone().sub(a!).cross(c!.clone().sub(a!)).normalize();
        const garment = point(shell, vertex), delta = garment.clone().sub(base), gap = delta.dot(normal);
        maximumDistance = Math.max(maximumDistance, delta.length());
        if (gap < minimumClearance) {
          minimumClearance = gap;
          witness = { vertex, anchor, base: base.toArray(), garment: garment.toArray(), normal: normal.toArray() };
        }
        if (gap < -.0005) penetrations++;
      });
      const sourcePositions = Array.from({ length: source.geometry.getAttribute("position").count }, (_, vertex) => original(vertex));
      const sourceGrid = new TriangleGrid(sourcePositions, Array.from(source.geometry.index!.array));
      const shellPositions = Array.from({ length: shell.geometry.getAttribute("position").count }, (_, vertex) => point(shell, vertex));
      const shellIndices = Array.from(shell.geometry.index!.array), shellGrid = new TriangleGrid(shellPositions, shellIndices);
      const sourceJoints = source.geometry.getAttribute("skinIndex"), sourceWeights = source.geometry.getAttribute("skinWeight");
      let outerMinimumClearance = Infinity, outerPenetrations = 0, outerMissing = 0, bodyOccluded = 0;
      let outerWitness: unknown;
      let sourceBackfacingSamples = 0;
      let twoSidedMinimumClearance = Infinity, twoSidedPenetrations = 0, twoSidedMissing = 0;
      for (let at = 0; at < shellIndices.length; at += 3) {
        const indices = shellIndices.slice(at, at + 3), base = new Vector3(), centre = new Vector3();
        for (const vertex of indices) {
          const anchor = provenance.sourceAnchors[vertex] as { vertices: number[]; bary: number[] };
          anchor.vertices.forEach((sourceVertex, corner) => {
            const amount = anchor.bary[corner]! / 3;
            base.addScaledVector(original(sourceVertex), amount);
            for (let slot = 0; slot < 4; slot++) centre.addScaledVector(new Vector3().setFromMatrixPosition(
              source.skeleton.bones[sourceJoints.getComponent(sourceVertex, slot)]!.matrixWorld),
            sourceWeights.getComponent(sourceVertex, slot) * amount);
          });
        }
        const outward = base.clone().sub(centre), radius = outward.length();
        if (radius < 1e-8) continue;
        outward.divideScalar(radius);
        const reach = .4 * WORKER_SCALE, outside = centre.clone().addScaledVector(outward, reach), inward = outward.clone().negate();
        const bodyHit = sourceGrid.raycast(outside, inward, 0, reach, hit => hit.facing < -1e-5);
        if (bodyHit && reach - bodyHit.distance > radius + .0005) { bodyOccluded++; continue; }
        // This point is a posed source triangle centroid. A front-facing visible triangle
        // intersects this ray at its own radius. A farther/no source hit identifies an inner
        // or back-facing source fold, not an exposed outer-body witness.
        if (!bodyHit || radius - (reach - bodyHit.distance) > .0005) {
          sourceBackfacingSamples++; continue;
        }
        const twoSidedHit = shellGrid.raycast(outside, inward, 0, reach);
        if (!twoSidedHit) twoSidedMissing++;
        else {
          const gap = reach - twoSidedHit.distance - radius;
          twoSidedMinimumClearance = Math.min(twoSidedMinimumClearance, gap);
          if (gap < -.0005) twoSidedPenetrations++;
        }
        const garmentHit = shellGrid.raycast(outside, inward, 0, reach, hit => hit.facing < -1e-5);
        if (!garmentHit) { outerMissing++; continue; }
        const gap = reach - garmentHit.distance - radius;
        if (gap < outerMinimumClearance) {
          outerMinimumClearance = gap;
          outerWitness = { face: at / 3, indices, base: base.toArray(), centre: centre.toArray(),
            garment: outside.clone().addScaledVector(inward, garmentHit.distance).toArray() };
        }
        if (gap < -.0005) outerPenetrations++;
      }
      phases.push({ troop: cell.troop, motion: cell.name, minimumClearance, maximumDistance, penetrations, witness,
        outerMinimumClearance, outerPenetrations, outerMissing, bodyOccluded, sourceBackfacingSamples,
        twoSidedMinimumClearance, twoSidedPenetrations, twoSidedMissing, outerWitness });
    }
    records.push({ quality: record.quality, modelSha256: record.modelSha256, phases,
      minimumClearance: Math.min(...phases.map(phase => phase.minimumClearance)),
      maximumDistance: Math.max(...phases.map(phase => phase.maximumDistance)),
      maximumPenetrations: Math.max(...phases.map(phase => phase.penetrations)),
      outerMinimumClearance: Math.min(...phases.map(phase => phase.outerMinimumClearance)),
      maximumOuterPenetrations: Math.max(...phases.map(phase => phase.outerPenetrations)),
      maximumOuterMissing: Math.max(...phases.map(phase => phase.outerMissing)),
      twoSidedMinimumClearance: Math.min(...phases.map(phase => phase.twoSidedMinimumClearance)),
      maximumTwoSidedPenetrations: Math.max(...phases.map(phase => phase.twoSidedPenetrations)),
      maximumTwoSidedMissing: Math.max(...phases.map(phase => phase.twoSidedMissing)) });
    worker.dispose();
  }
} finally { assets.restore(); }
await writeFile(values.out, JSON.stringify({ scope: "Actual serialized source-faithful padded torso versus its retained original source facets, full90 equipped phases/detail and current rigid helmet. Signed local facet correspondence is diagnostic; global intersections/native appearance remain separate gates. No model write/publication.", records }, null, 2));
console.log(JSON.stringify(records.map(({ phases: _phases, ...record }) => record)));
