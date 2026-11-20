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
  throw new Error("Choose an explicit clean kilt stage and output report");
const folder = values.folder, id = "nubian-man-scarf";
const ready = resolve("../island-of-settlers-worker-generation/game_ready");
const provenance = JSON.parse(await readFile(resolve(ready, folder, "nubian", id, "source-kilt.json"), "utf8"));
const frames = await createEquippedCpuFrames({ folder, bodies: [id], ranks: ["recruit"], qualities: ["high", "minimal"] });
const assets = await createHatchAuditAssets({ armourFolder: folder }), records = [];
try {
  for (const record of frames.records) {
    assert.equal(record.modelSha256, provenance.outputSha256);
    const minimal = record.quality === "minimal", worker = await assets.soldier("nubian", id, "recruit", minimal);
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
    const body = worker.root.getObjectByName("body") as SkinnedMesh;
    const cloth = worker.root.getObjectByName(`armour_underclothes_lod${minimal ? 1 : 0}`) as SkinnedMesh;
    if (!body?.isSkinnedMesh || !cloth?.isSkinnedMesh || !cloth.visible) throw new Error("Actual body or active kilt is missing");
    const point = (mesh: SkinnedMesh, vertex: number) => mesh.applyBoneTransform(vertex,
      new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld);
    const bone = (name: string) => new Vector3().setFromMatrixPosition(
      body.skeleton.bones.find(bone => bone.name === name)!.matrixWorld);
    const clothIndices = Array.from(cloth.geometry.index!.array);
    const clothCount = cloth.geometry.getAttribute("position").count;
    const restCloth = Array.from({ length: clothCount }, (_, vertex) => point(cloth, vertex));
    const restGrid = new TriangleGrid(restCloth, clothIndices), hipHeight = bone("Hips").y;
    const hemHeight = provenance.weightField.hem * WORKER_SCALE;
    const witnesses = (provenance.originalLegVertices as number[]).flatMap(vertex => {
      const rest = point(body, vertex);
      if (rest.y > hipHeight - .025 || rest.y < hemHeight + .025) return [];
      const side = rest.x > 0 ? "Left" : "Right", start = bone(`${side}UpLeg`), axis = bone(`${side}Leg`).sub(start);
      const fraction = rest.clone().sub(start).dot(axis) / axis.lengthSq(), centre = start.addScaledVector(axis, fraction);
      const outward = rest.clone().sub(centre).normalize();
      if (!restGrid.raycast(rest, outward, 0, .3, hit => hit.facing > 1e-5)) return [];
      return [{ vertex, side, fraction, rest: rest.toArray() }];
    });
    assert(witnesses.length > 100, "Real covered leg witnesses are missing");
    const legs = new Set<number>(provenance.originalLegVertices), legIndices: number[] = [];
    const bodyIndices = Array.from(body.geometry.index!.array);
    for (let at = 0; at < bodyIndices.length; at += 3) {
      const face = bodyIndices.slice(at, at + 3);
      if (face.every(vertex => legs.has(vertex))) legIndices.push(...face);
    }
    const edges = new Map<string, { a: number; b: number; rest: number }>();
    for (let at = 0; at < clothIndices.length; at += 3) for (let side = 0; side < 3; side++) {
      const a = clothIndices[at + side]!, b = clothIndices[at + (side + 1) % 3]!;
      edges.set([a, b].sort((a, b) => a - b).join(","), { a, b, rest: restCloth[a]!.distanceTo(restCloth[b]!) });
    }
    const phases = [];
    for (const cell of record.cells) {
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      const bodyPoints = Array.from({ length: body.geometry.getAttribute("position").count }, (_, vertex) => point(body, vertex));
      const clothPoints = Array.from({ length: clothCount }, (_, vertex) => point(cloth, vertex));
      const clothGrid = new TriangleGrid(clothPoints, clothIndices), legGrid = new TriangleGrid(bodyPoints, legIndices);
      const partIndexCount = clothIndices.length / 2;
      const rightGrid = new TriangleGrid(clothPoints, clothIndices.slice(partIndexCount));
      const partVertexCount = clothCount / 2, restPosition = cloth.geometry.getAttribute("position");
      let lowerLeafCrossings = 0, visibleLowerLeafCrossings = 0;
      const leafCrossingWitnesses = [];
      for (const edge of edges.values()) {
        if (edge.a >= partVertexCount || edge.b >= partVertexCount) continue;
        const upper = Math.max(restPosition.getY(edge.a), restPosition.getY(edge.b));
        if (upper > provenance.weightField.waist - .045) continue;
        const start = clothPoints[edge.a]!, direction = clothPoints[edge.b]!.clone().sub(start), length = direction.length();
        if (length <= .0004) continue;
        direction.divideScalar(length);
        const hit = rightGrid.raycast(start, direction, .0002, length - .0002);
        if (!hit) continue;
        lowerLeafCrossings++;
        const intersection = start.clone().addScaledVector(direction, hit.distance);
        const centre = bone("Hips"); centre.y = intersection.y;
        const outward = intersection.clone().sub(centre), radius = outward.length();
        let visible = false;
        if (radius > .0001) {
          outward.divideScalar(radius);
          const reach = .4 * WORKER_SCALE, outside = centre.addScaledVector(outward, reach);
          const outer = clothGrid.raycast(outside, outward.clone().negate(), 0, reach);
          visible = !!outer && reach - outer.distance <= radius + .001;
          if (visible) visibleLowerLeafCrossings++;
        }
        if (leafCrossingWitnesses.length < 8) leafCrossingWitnesses.push({ edge: [edge.a, edge.b],
          point: intersection.toArray(), rightFace: hit.triangle, visible });
      }
      let minimumGap = Infinity, penetrations = 0, missing = 0, occluded = 0, worst: unknown;
      for (const witness of witnesses) {
        const centre = bone(`${witness.side}UpLeg`).lerp(bone(`${witness.side}Leg`), witness.fraction);
        const skin = bodyPoints[witness.vertex]!, outward = skin.clone().sub(centre), radius = outward.length();
        outward.divideScalar(radius);
        const reach = .35 * WORKER_SCALE, outside = centre.addScaledVector(outward, reach), inward = outward.clone().negate();
        const otherLeg = legGrid.raycast(outside, inward, 0, reach);
        if (otherLeg && reach - otherLeg.distance > radius + .0005) { occluded++; continue; }
        const hit = clothGrid.raycast(outside, inward, 0, reach, hit => hit.facing < -1e-5);
        if (!hit) { missing++; continue; }
        const gap = reach - hit.distance - radius;
        if (gap < minimumGap) {
          minimumGap = gap;
          worst = { ...witness, skin: skin.toArray(), cloth: outside.addScaledVector(inward, hit.distance).toArray(),
            clothFace: clothIndices.slice(hit.triangle * 3, hit.triangle * 3 + 3) };
        }
        if (gap < -.001) penetrations++;
      }
      let foldbacks = 0;
      const foldbackWitnesses = [];
      const position = cloth.geometry.getAttribute("position");
      for (let at = 0; at < clothIndices.length; at += 3) {
        const face = clothIndices.slice(at, at + 3), local = face.map(vertex => new Vector3().fromBufferAttribute(position, vertex));
        const normal = local[1]!.clone().sub(local[0]!).cross(local[2]!.clone().sub(local[0]!)).normalize();
        const expected = face.reduce((sum, vertex, corner) => sum.add(cloth.applyBoneTransform(vertex,
          local[corner]!.clone().add(normal)).applyMatrix4(cloth.matrixWorld).sub(clothPoints[vertex]!)), new Vector3()).normalize();
        const actual = clothPoints[face[1]!]!.clone().sub(clothPoints[face[0]!]!)
          .cross(clothPoints[face[2]!]!.clone().sub(clothPoints[face[0]!]!)).normalize();
        if (expected.dot(actual) < -.1) {
          foldbacks++;
          foldbackWitnesses.push({ face: at / 3, vertices: face, rest: local.map(point => point.toArray()),
            posed: face.map(vertex => clothPoints[vertex]!.toArray()), alignment: expected.dot(actual) });
        }
      }
      const stretch = [...edges.values()].map(edge => clothPoints[edge.a]!.distanceTo(clothPoints[edge.b]!) / edge.rest);
      phases.push({ troop: cell.troop, motion: cell.name, minimumGap, penetrations, missing, occluded,
        foldbacks, foldbackWitnesses, lowerLeafCrossings, visibleLowerLeafCrossings, leafCrossingWitnesses,
        maximumStretch: Math.max(...stretch), worst });
    }
    records.push({ quality: record.quality, modelSha256: record.modelSha256, witnesses: witnesses.length,
      minimumGap: Math.min(...phases.map(phase => phase.minimumGap)),
      maximumPenetrations: Math.max(...phases.map(phase => phase.penetrations)),
      maximumMissing: Math.max(...phases.map(phase => phase.missing)),
      maximumFoldbacks: Math.max(...phases.map(phase => phase.foldbacks)),
      maximumLowerLeafCrossings: Math.max(...phases.map(phase => phase.lowerLeafCrossings)),
      maximumVisibleLowerLeafCrossings: Math.max(...phases.map(phase => phase.visibleLowerLeafCrossings)),
      maximumStretch: Math.max(...phases.map(phase => phase.maximumStretch)), phases });
    worker.dispose();
  }
} finally { assets.restore(); }
await writeFile(values.out, JSON.stringify({ scope: "Actual serialized clean wrap, ninety equipped phases per detail; real original leg envelope, LOD selection, facet foldbacks and edge strain. Missing rays at wrap vents require native inspection. No publication or visual acceptance.", records }, null, 2));
console.log(JSON.stringify(records.map(({ phases: _phases, ...record }) => record)));
