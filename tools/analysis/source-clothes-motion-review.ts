import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, out: { type: "string" } } });
if (!values.folder || !/^[a-z0-9-]+$/.test(values.folder) || !values.out)
  throw new Error("Choose one direct source-clothes stage and a diagnostic receipt");
const folder = values.folder, id = "nubian-man-scarf";
const ready = resolve("../island-of-settlers-worker-generation/game_ready");
const provenance = JSON.parse(await readFile(resolve(ready, folder, id, "provenance.json"), "utf8"));
const changed = new Set<number>(provenance.changedVertices);
if (!changed.size) throw new Error("Source-clothes pilot has no recorded cloth-only skin changes");
const records = [];
for (const sourceFolder of ["original-clothes-review", folder]) {
  const frames = await createEquippedCpuFrames({ folder: "armour", bodies: [id], ranks: ["recruit"],
    qualities: ["high", "minimal"], sourceFolder });
  const assets = await createHatchAuditAssets();
  try {
    const path = resolve(ready, sourceFolder, id, "model.glb");
    const worker = await assets.pack.load("nubian", id, pathToFileURL(path).href);
    worker.root.scale.setScalar(WORKER_SCALE); worker.root.updateMatrixWorld(true);
    const mesh = worker.root.getObjectByName("body") as SkinnedMesh;
    if (!mesh?.isSkinnedMesh) throw new Error("Original clothed skinned body is missing");
    const index = mesh.geometry.index!, position = mesh.geometry.getAttribute("position");
    const pointOf = (vertex: number, normal = false) => {
      const point = new Vector3().fromBufferAttribute(position, vertex);
      if (normal) point.add(new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), vertex));
      return mesh.applyBoneTransform(vertex, point).applyMatrix4(mesh.matrixWorld);
    };
    const restPoints = Array.from({ length: position.count }, (_, vertex) => pointOf(vertex));
    const costumeFaces: number[] = sourceFolder === "original-clothes-review"
      ? provenance.baselineCostumeFaces ?? provenance.originalCostumeFaces : provenance.originalCostumeFaces;
    const clothIndices = costumeFaces.flatMap(face =>
      [0, 1, 2].map(corner => index.getX(face * 3 + corner)));
    const restCloth = new TriangleGrid(restPoints, clothIndices);
    const hipHeight = mesh.skeleton.bones.find(bone => bone.name === "Hips")!.matrixWorld.elements[13]!;
    const hemHeight = provenance.weightField.hem * WORKER_SCALE;
    const pairs = (provenance.originalLegVertices as number[]).flatMap(vertex => {
      const point = restPoints[vertex]!;
      if (point.y > hipHeight - .025 || point.y < hemHeight + .025) return [];
      const direction = pointOf(vertex, true).sub(point).normalize();
      const hit = restCloth.raycast(point, direction, .001, .3, hit => hit.facing > 0);
      const side = point.x > 0 ? "Left" : "Right";
      const start = new Vector3().setFromMatrixPosition(mesh.skeleton.bones.find(bone => bone.name === `${side}UpLeg`)!.matrixWorld);
      const end = new Vector3().setFromMatrixPosition(mesh.skeleton.bones.find(bone => bone.name === `${side}Leg`)!.matrixWorld);
      const axis = end.sub(start), fraction = point.clone().sub(start).dot(axis) / axis.lengthSq();
      return hit ? [{ vertex, hit, side, fraction }] : [];
    });
    if (pairs.length < 20) throw new Error("Original covered-leg witness surface is too sparse");
    const legVertices = new Set<number>(provenance.originalLegVertices);
    const legEdges = new Map<string, [number, number]>(), legIndices: number[] = [];
    for (let at = 0; at < index.count; at += 3) {
      const face = [0, 1, 2].map(corner => index.getX(at + corner));
      if (!face.every(vertex => legVertices.has(vertex))) continue;
      legIndices.push(...face);
      for (let side = 0; side < 3; side++) {
        const a = face[side]!, b = face[(side + 1) % 3]!;
        legEdges.set([a, b].sort((a, b) => a - b).join(","), [a, b]);
      }
    }
    const edges = new Map<string, { a: number; b: number; rest: number }>();
    for (let at = 0; at < index.count; at += 3) {
      const face = [0, 1, 2].map(corner => index.getX(at + corner));
      if (!face.some(vertex => changed.has(vertex))) continue;
      for (let side = 0; side < 3; side++) {
        const a = face[side]!, b = face[(side + 1) % 3]!;
        const rest = new Vector3().fromBufferAttribute(position, a)
          .distanceTo(new Vector3().fromBufferAttribute(position, b)) * WORKER_SCALE;
        if (rest < .0003) continue;
        edges.set([a, b].sort((a, b) => a - b).join(","), { a, b, rest });
      }
    }
    if (edges.size < 100) throw new Error("Affected original skirt topology is too sparse");
    for (const record of frames.records) {
      if (sourceFolder === folder) assert.equal(record.modelSha256, provenance.outputSha256);
      const phases = [];
      for (const cell of record.cells) {
        applyArmourPoseSnapshot(worker.root, cell.diagnostics);
        const points = new Map<number, Vector3>();
        const point = (vertex: number) => {
          if (!points.has(vertex)) points.set(vertex, pointOf(vertex));
          return points.get(vertex)!;
        };
        let maximumStretch = 0, maximumExtension = 0;
        let worstEdge: { a: number; b: number; rest: number } | undefined;
        const stretches: number[] = [];
        for (const edge of edges.values()) {
          const length = point(edge.a).distanceTo(point(edge.b)), stretch = length / edge.rest;
          stretches.push(stretch);
          if (stretch > maximumStretch) { maximumStretch = stretch; worstEdge = edge; }
          maximumExtension = Math.max(maximumExtension, length - edge.rest);
        }
        stretches.sort((a, b) => a - b);
        const witness = worstEdge && [worstEdge.a, worstEdge.b].map(vertex => ({ vertex,
          changed: changed.has(vertex), rest: new Vector3().fromBufferAttribute(position, vertex).toArray(),
          posed: point(vertex).toArray(), influences: [0, 1, 2, 3].map(slot => ({
            bone: mesh.skeleton.bones[mesh.geometry.getAttribute("skinIndex").getComponent(vertex, slot)]!.name,
            weight: mesh.geometry.getAttribute("skinWeight").getComponent(vertex, slot) })) }));
        const gaps = pairs.map(({ hit, vertex }) => {
          const clothPoint = hit.bary.reduce((sum, weight, corner) =>
            sum.addScaledVector(point(clothIndices[hit.triangle * 3 + corner]!), weight), new Vector3());
          return clothPoint.sub(point(vertex)).dot(pointOf(vertex, true).sub(point(vertex)).normalize());
        });
        const worstGapIndex = gaps.indexOf(Math.min(...gaps)), worstPair = pairs[worstGapIndex]!;
        const coverageWitness = { vertex: worstPair.vertex, rest: restPoints[worstPair.vertex]!.toArray(),
          posed: point(worstPair.vertex).toArray(), clothPoint: worstPair.hit.bary.reduce((sum, weight, corner) =>
            sum.addScaledVector(point(clothIndices[worstPair.hit.triangle * 3 + corner]!), weight), new Vector3()).toArray() };
        const clothVertices = new Set(clothIndices);
        const posedPoints = restPoints.map((rest, vertex) =>
          clothVertices.has(vertex) || legVertices.has(vertex) ? point(vertex) : rest);
        const posedCloth = new TriangleGrid(posedPoints, clothIndices), posedLegs = new TriangleGrid(posedPoints, legIndices);
        let clothFaceFoldbacks = 0;
        for (let at = 0; at < clothIndices.length; at += 3) {
          const face = clothIndices.slice(at, at + 3);
          const local = face.map(vertex => new Vector3().fromBufferAttribute(position, vertex));
          const restNormal = local[1]!.clone().sub(local[0]!).cross(local[2]!.clone().sub(local[0]!));
          if (restNormal.lengthSq() < 1e-14) continue;
          restNormal.normalize();
          const expected = face.reduce((sum, vertex, corner) => sum.add(mesh.applyBoneTransform(vertex,
            local[corner]!.clone().add(restNormal)).applyMatrix4(mesh.matrixWorld).sub(point(vertex))), new Vector3()).normalize();
          const actual = point(face[1]!).clone().sub(point(face[0]!))
            .cross(point(face[2]!).clone().sub(point(face[0]!))).normalize();
          if (expected.dot(actual) < -.1) clothFaceFoldbacks++;
        }
        let outerEnvelopeMinimumGap = Infinity, outerEnvelopePenetrations = 0, outerEnvelopeMissed = 0;
        let outerEnvelopeWitness: { vertex: number; fraction: number; side: string; skin: number[];
          rest: number[]; cloth: number[]; face: number[]; controls: { bones: string[]; weights: number[] }[] } | undefined;
        let bodyOccludedSamples = 0;
        const bonePoint = (name: string) => new Vector3().setFromMatrixPosition(
          mesh.skeleton.bones.find(bone => bone.name === name)!.matrixWorld);
        for (const { fraction, side, vertex } of pairs) {
          const centre = bonePoint(`${side}UpLeg`).lerp(bonePoint(`${side}Leg`), fraction);
          const outward = point(vertex).clone().sub(centre), radius = outward.length(); outward.divideScalar(radius);
          const reach = .35 * WORKER_SCALE, outside = centre.clone().addScaledVector(outward, reach);
          const inward = outward.clone().negate(), bodyHit = posedLegs.raycast(outside, inward, 0, reach);
          if (bodyHit && reach - bodyHit.distance > radius + .0005) { bodyOccludedSamples++; continue; }
          const garmentHit = posedCloth.raycast(outside, inward, 0, reach, hit => hit.facing < -1e-5);
          if (!garmentHit) { outerEnvelopeMissed++; continue; }
          const gap = reach - garmentHit.distance - radius;
          if (gap < outerEnvelopeMinimumGap) {
            outerEnvelopeMinimumGap = gap;
            const face = clothIndices.slice(garmentHit.triangle * 3, garmentHit.triangle * 3 + 3);
            outerEnvelopeWitness = { vertex, fraction, side, skin: point(vertex).toArray(), rest: restPoints[vertex]!.toArray(),
              cloth: outside.clone().addScaledVector(inward, garmentHit.distance).toArray(), face,
              controls: face.map(index => ({ bones: [0, 1, 2, 3].map(slot =>
                mesh.skeleton.bones[mesh.geometry.getAttribute("skinIndex").getComponent(index, slot)]!.name),
              weights: [0, 1, 2, 3].map(slot => mesh.geometry.getAttribute("skinWeight").getComponent(index, slot)) })) };
          }
          if (gap < -.001) outerEnvelopePenetrations++;
        }
        let legEdgesCrossingCloth = 0;
        for (const [a, b] of legEdges.values()) {
          const start = point(a), direction = point(b).clone().sub(start), length = direction.length();
          if (length <= .0004) continue;
          if (posedCloth.raycast(start, direction.divideScalar(length), .0002, length - .0002))
            legEdgesCrossingCloth++;
        }
        phases.push({ troop: cell.troop, motion: cell.name, maximumStretch, witness,
          coveredLegMinimumGap: Math.min(...gaps), coveredLegPenetrations: gaps.filter(gap => gap < -.001).length,
          coverageWitness,
          legEdgesCrossingCloth,
          outerEnvelopeMinimumGap, outerEnvelopePenetrations, outerEnvelopeMissed, bodyOccludedSamples,
          outerEnvelopeWitness,
          clothFaceFoldbacks,
          percentile99Stretch: stretches[Math.floor(stretches.length * .99)], maximumExtension });
      }
      records.push({ sourceFolder, quality: record.quality, sourceSha256: record.modelSha256,
        affectedEdges: edges.size, coveredLegWitnesses: pairs.length,
        coveredLegMinimumGap: Math.min(...phases.map(phase => phase.coveredLegMinimumGap)),
        maximumLegEdgesCrossingCloth: Math.max(...phases.map(phase => phase.legEdgesCrossingCloth)),
        outerEnvelopeMinimumGap: Math.min(...phases.map(phase => phase.outerEnvelopeMinimumGap)),
        maximumOuterEnvelopePenetrations: Math.max(...phases.map(phase => phase.outerEnvelopePenetrations)),
        maximumOuterEnvelopeMissed: Math.max(...phases.map(phase => phase.outerEnvelopeMissed)),
        maximumClothFaceFoldbacks: Math.max(...phases.map(phase => phase.clothFaceFoldbacks)),
        maximumStretch: Math.max(...phases.map(phase => phase.maximumStretch)),
        maximumExtension: Math.max(...phases.map(phase => phase.maximumExtension)), phases });
    }
    worker.dispose();
  } finally { assets.restore(); }
}
const report = { scope: "Actual production equipped CPU poses on the literal original and a source-topology-preserving skirt-weight pilot. Ninety walk/run/attack/defence phases per detail, three roles. Edge strain is a diagnostic, not a cloth/skin collision or visual acceptance gate. No GPU, model write or publication.",
  originalSourceSha256: provenance.sourceSha256, records };
await writeFile(values.out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(records.map(({ phases: _phases, ...record }) => record)));
