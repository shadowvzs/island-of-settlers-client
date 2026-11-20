import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { BufferGeometry, Float32BufferAttribute, Matrix4, type SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";

import { jointMatrix, readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { buildSourceKiltApron, sourceKiltApronAngle } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-apron";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { buildSourceKiltSurface } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-surface";
import { neckBoneWeights } from "../../../island-of-settlers-worker-generation/src/national-workers/source-skin-streams";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { combinedClothGrid, countSurfaceCrossings as crossings, distanceToSurfaceBoundary,
  sourceClothContactCoverage, surfaceBoundaryEdges, uniqueMeshEdges as edgesOf } from "./source-cloth-coverage";

const { values } = parseArgs({ options: { out: { type: "string" }, vent: { type: "string" },
  "edge-samples": { type: "string" }, "thigh-only": { type: "boolean" } } });
if (!values.out) throw new Error("Choose an explicit apron construction proof receipt");
const ventAngle = Number(values.vent ?? ".3");
const edgeSamples = Number(values["edge-samples"] ?? "0");
assert(Number.isInteger(edgeSamples) && edgeSamples >= 0 && edgeSamples <= 8);
assert(ventAngle > 0 && ventAngle < .8);
const id = "nubian-man-scarf", folder = "source-kilt-surface-de", ready = resolve("../island-of-settlers-worker-generation/game_ready");
const sourcePaths = ["tools/analysis/source-kilt-apron-proof.ts",
  "tools/analysis/source-cloth-coverage.ts",
  "../island-of-settlers-worker-generation/src/national-workers/source-kilt-apron.ts",
  "../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels.ts",
  "../island-of-settlers-worker-generation/src/national-workers/source-kilt-surface.ts",
  "../island-of-settlers-worker-generation/src/national-workers/source-kilt-seam.ts",
  "../island-of-settlers-worker-generation/src/national-workers/source-kilt-waist.ts",
  resolve(ready, "original-clothes-review", id, "model.glb")];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const sourceHashes = await hashes();
const io = await createRetargetIO(), original = await io.read(resolve(ready, "original-clothes-review", id, "model.glb"));
const reference = readArmourBody(original), support = buildSourceKiltPanels(original, id), skinSource = readArmourBody(original);
const hipInverse = jointMatrix(reference, "Hips").invert();
const frames = await createEquippedCpuFrames({ folder, bodies: [id], ranks: ["recruit"], qualities: ["high", "minimal"] });
const assets = await createHatchAuditAssets({ armourFolder: folder }), records = [];
try {
  for (const record of frames.records) {
    const minimal = record.quality === "minimal", garment = buildSourceKiltSurface(reference, skinSource, support, minimal, ventAngle);
    if (values["thigh-only"]) for (let vertex = 0; vertex < garment.mesh.vertexCount; vertex++) {
      const point = garment.mesh.position(vertex), scale = (reference.joints.get("Neck")!.y - reference.joints.get("Hips")!.y) / .28;
      const blend = Math.max(0, Math.min(1, (support.weightField.waist - .06 * scale - point.y) / (.03 * scale)));
      if (!blend) continue;
      const name = garment.mesh.vertexPart[vertex] === 0 ? "LeftUpLeg" : "RightUpLeg";
      const joint = reference.surface.jointNodes.findIndex(index => reference.skeleton.names[index] === name);
      assert(joint >= 0);
      const controls = new Map<number, number>([[joint, blend]]);
      for (let slot = 0; slot < 4; slot++) {
        const at = vertex * 4 + slot, index = garment.weights.joints[at]!, weight = garment.weights.weights[at]!;
        controls.set(index, (controls.get(index) ?? 0) + weight * (1 - blend));
      }
      const skin = neckBoneWeights(controls);
      garment.weights.joints.set(skin.joints, vertex * 4); garment.weights.weights.set(skin.weights, vertex * 4);
    }
    const aprons = [1, -1].map(sign => buildSourceKiltApron(reference, support, minimal, sign));
    const worker = await assets.soldier("nubian", id, "recruit", minimal);
    const originalWorker = await assets.pack.load("nubian", id,
      pathToFileURL(resolve(ready, "original-clothes-review", id, "model.glb")).href);
    const originalBody = originalWorker.root.getObjectByName("body") as SkinnedMesh;
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
    const body = worker.root.getObjectByName("body") as SkinnedMesh;
    const legVertexLookup = new Map(support.originalLegVertices.map((vertex, index) => [vertex, index]));
    const legIndices: number[] = [];
    const bodyIndices = body.geometry.getIndex()!;
    for (let at = 0; at < bodyIndices.count; at += 3) {
      const triangle = [bodyIndices.getX(at), bodyIndices.getX(at + 1), bodyIndices.getX(at + 2)];
      if (triangle.every(vertex => legVertexLookup.has(vertex)))
        legIndices.push(...triangle.map(vertex => legVertexLookup.get(vertex)!));
    }
    assert(legIndices.length > 0, "Actual original leg triangles are required for the construction proof");
    const legEdges = edgesOf(legIndices);
    const originalCostumeIndices = support.baselineCostumeFaces
      .flatMap(face => reference.surface.triangles.slice(face * 3, face * 3 + 3));
    const originalCostumeEdges = edgesOf(originalCostumeIndices);
    const originalCoverIndices = support.referenceTriangleOffsets
      .flatMap(at => reference.surface.triangles.slice(at, at + 3));
    const originalCoverVertices = [...new Set(originalCoverIndices)];
    const faceKey = (face: number[]) => [...face].sort((a, b) => a - b).join(",");
    const originalCostumeFaces = new Set(support.referenceTriangleOffsets
      .map(at => faceKey(reference.surface.triangles.slice(at, at + 3))));
    const clippedCostumeFaces = new Set(support.originalCostumeFaces);
    const retainedShirtIndices = Array.from({ length: support.retainedBodyIndices.length / 3 }, (_, face) =>
      ({ face, vertices: support.retainedBodyIndices.slice(face * 3, face * 3 + 3) }))
      .filter(({ face, vertices }) => clippedCostumeFaces.has(face) || originalCostumeFaces.has(faceKey(vertices)))
      .flatMap(({ vertices }) => vertices);
    const retainedShirtVertices = [...new Set(retainedShirtIndices)];
    const side = worker.root.getObjectByName(`armour_underclothes_lod${minimal ? 1 : 0}`) as SkinnedMesh;
    const previousGeometry = side.geometry, geometry = new BufferGeometry();
    const positions = Array.from({ length: garment.mesh.vertexCount }, (_, vertex) => garment.mesh.position(vertex)
      .applyMatrix4(reference.surface.restToMesh)).flatMap(point => point.toArray());
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(garment.weights.joints, 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(garment.weights.weights, 4));
    geometry.setIndex(garment.mesh.indices); side.geometry = geometry;
    const hip = body.skeleton.bones.find(bone => bone.name === "Hips")!, phases = [];
    const indicesOf = (part: number) => Array.from({ length: garment.mesh.indices.length / 3 }, (_, face) =>
      garment.mesh.indices.slice(face * 3, face * 3 + 3))
      .filter(face => face.every(vertex => garment.mesh.vertexPart[vertex] === part)).flat();
    const leftIndices = indicesOf(0), rightIndices = indicesOf(1);
    const lowerEdges = edgesOf(leftIndices).filter(edge => edge.every(vertex =>
      garment.mesh.position(vertex).y < support.weightField.waist - .045));
    const sideEdges = edgesOf(garment.mesh.indices);
    const sideBoundaries = surfaceBoundaryEdges(garment.mesh.indices);
    const allLowerEdges = sideEdges.filter(edge => edge.every(vertex =>
      garment.mesh.position(vertex).y < support.weightField.waist - .045));
    const supports = new Set<string>();
    for (const cell of record.cells) {
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      applyArmourPoseSnapshot(originalWorker.root, { ...cell.diagnostics,
        posedMeshes: cell.diagnostics.posedMeshes.filter(mesh => mesh.name === "body") });
      const delta = hip.matrixWorld.clone().multiply(hipInverse), inverseDelta = delta.clone().invert();
      const sideWorld = positions.reduce<Vector3[]>((points, _, at) => {
        if (at % 3 === 0) points.push(side.applyBoneTransform(at / 3,
          new Vector3().fromArray(positions, at)).applyMatrix4(side.matrixWorld));
        return points;
      }, []);
      const bodyWorld = support.originalLegVertices.map(vertex => ({ vertex, point: body.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld) }));
      const envelope = [...sideWorld.map((point, vertex) => ({ key: `side/${vertex}`, point })),
        ...bodyWorld.map(({ point, vertex }) => ({ key: `body/${vertex}`, point }))]
        .map(({ key, point }) => ({ key, point: point.clone().applyMatrix4(inverseDelta) }));
      if (edgeSamples) for (const [a, b] of sideEdges) for (let sample = 1; sample <= edgeSamples; sample++)
        envelope.push({ key: `side-edge/${a}/${b}/${sample}`, point: sideWorld[a]!.clone()
          .lerp(sideWorld[b]!, sample / (edgeSamples + 1)).applyMatrix4(inverseDelta) });
      const legPoints = bodyWorld.map(({ point }) => point);
      if (edgeSamples) for (const [a, b] of legEdges) for (let sample = 1; sample <= edgeSamples; sample++)
        envelope.push({ key: `leg-edge/${a}/${b}/${sample}`, point: legPoints[a]!.clone()
          .lerp(legPoints[b]!, sample / (edgeSamples + 1)).applyMatrix4(inverseDelta) });
      const sideGrid = new TriangleGrid(sideWorld, garment.mesh.indices);
      const legGrid = new TriangleGrid(legPoints, legIndices);
      const originalPoints: Vector3[] = [];
      for (const vertex of originalCoverVertices) originalPoints[vertex] = originalBody.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(originalBody.geometry.getAttribute("position"), vertex))
        .applyMatrix4(originalBody.matrixWorld);
      const originalGrid = new TriangleGrid(originalPoints, originalCostumeIndices);
      const originalCover = new TriangleGrid(originalPoints, originalCoverIndices);
      const originalCostumeLegCrossings = crossings(originalPoints, originalCostumeEdges, legGrid);
      const legOriginalCostumeCrossings = crossings(legPoints, legEdges, originalGrid);
      const sideCrossings = crossings(sideWorld, lowerEdges, new TriangleGrid(sideWorld, rightIndices));
      const sideLegWitnesses: { edge: [number, number]; point: number[]; triangle: number }[] = [];
      const sideLegCrossings = crossings(sideWorld, sideEdges, legGrid, sideLegWitnesses, 128);
      const legSideWitnesses: { edge: [number, number]; point: number[]; triangle: number }[] = [];
      const legSideCrossings = crossings(legPoints, legEdges, sideGrid, legSideWitnesses, 128);
      const apronSurfaces: { points: Vector3[]; indices: number[] }[] = [];
      const apronRecords = aprons.map(apron => {
        const pose = sourceKiltApronAngle(apron, envelope);
        if (pose.witness) supports.add(`${apron.sign}/${pose.witness}`);
        const transform = delta.clone().multiply(new Matrix4().makeTranslation(...apron.pivot.toArray()))
          .multiply(new Matrix4().makeRotationX(-apron.sign * pose.angle))
          .multiply(new Matrix4().makeTranslation(...apron.pivot.clone().negate().toArray()));
        const points = Array.from({ length: apron.mesh.vertexCount }, (_, vertex) => {
          const rest = apron.mesh.position(vertex), anchor = apron.waistAnchors[vertex]!;
          const point = rest.clone().applyMatrix4(transform).multiplyScalar(anchor.hingeWeight);
          for (const { joint, weight } of anchor.influences) {
            const bone = body.skeleton.bones.find(bone => bone.name === joint)!;
            const skin = bone.matrixWorld.clone().multiply(jointMatrix(reference, joint).invert());
            point.addScaledVector(rest.clone().applyMatrix4(skin), weight);
          }
          return point;
        });
        const edges = edgesOf(apron.mesh.indices).filter(edge => edge.every(vertex =>
          apron.mesh.position(vertex).y < support.weightField.waist - .025));
        const apronGrid = new TriangleGrid(points, apron.mesh.indices);
        apronSurfaces.push({ points, indices: apron.mesh.indices });
        const apronSideCrossings = crossings(points, edges, sideGrid);
        const sideApronCrossings = crossings(sideWorld, allLowerEdges, apronGrid);
        const apronLegCrossings = crossings(points, edges, legGrid);
        const legWitnesses: { edge: [number, number]; point: number[]; triangle: number }[] = [];
        const legApronCrossings = crossings(legPoints, legEdges, apronGrid, legWitnesses);
        const inverseTransform = transform.clone().invert();
        const localGrid = new TriangleGrid(points.map(point => point.clone().applyMatrix4(inverseTransform)),
          apron.mesh.indices);
        let waistDeficit = 0, waistWitness: string | undefined;
        for (const candidate of envelope) {
          if (!candidate.key.startsWith("body/") && !candidate.key.startsWith("leg-edge/")) continue;
          const point = candidate.point.clone().applyMatrix4(delta).applyMatrix4(inverseTransform);
          const depth = apron.pivot.y - point.y;
          if (depth < 0 || depth > .03 * apron.scale) continue;
          const origin = point.clone().setZ(apron.pivot.z + apron.sign * .4 * apron.scale);
          const direction = new Vector3(0, 0, -apron.sign);
          const hit = localGrid.raycast(origin, direction, 0, .8 * apron.scale);
          if (!hit) continue;
          const deficit = apron.sign * (point.z - origin.addScaledVector(direction, hit.distance).z);
          if (deficit > waistDeficit) { waistDeficit = deficit; waistWitness = candidate.key; }
        }
        return { sign: apron.sign, ...pose, apronSideCrossings, sideApronCrossings,
          apronLegCrossings, legApronCrossings, waistDeficit, waistWitness,
          legWitnesses: legWitnesses.map(witness => ({ ...witness,
            originalEdge: witness.edge.map(vertex => support.originalLegVertices[vertex]),
            apronLocal: new Vector3().fromArray(witness.point).applyMatrix4(inverseTransform)
              .sub(apron.pivot).toArray() })) };
      });
      const retainedShirtPoints: Vector3[] = [];
      for (const vertex of retainedShirtVertices) retainedShirtPoints[vertex] = body.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld);
      const candidateCover = combinedClothGrid([{ points: sideWorld, indices: garment.mesh.indices },
        { points: retainedShirtPoints, indices: retainedShirtIndices }, ...apronSurfaces]);
      const coverage = sideLegWitnesses.map(witness => ({ ...witness,
        boundaryDistance: distanceToSurfaceBoundary(new Vector3().fromArray(witness.point), sideWorld, sideBoundaries),
        ...sourceClothContactCoverage(new Vector3().fromArray(witness.point), witness.triangle,
          legGrid, originalCover, candidateCover) }));
      for (const witness of legSideWitnesses) {
        const point = new Vector3().fromArray(witness.point), nearest = legGrid.closestPoint(point, .0001);
        assert(nearest, "The reverse contact witness must lie on the actual body");
        coverage.push({ ...witness, boundaryDistance: distanceToSurfaceBoundary(point, sideWorld, sideBoundaries),
          ...sourceClothContactCoverage(point, nearest.triangle,
          legGrid, originalCover, candidateCover) });
      }
      phases.push({ troop: cell.troop, motion: cell.name, sideCrossings,
        originalCostumeLegCrossings, legOriginalCostumeCrossings,
        newExposureWitnesses: coverage.filter(witness => witness.newExposure),
        newInteriorExposureWitnesses: coverage.filter(witness => witness.newExposure && witness.boundaryDistance > .002),
        coveredContactCount: coverage.filter(witness => witness.candidateCovered).length,
        sourceUncoveredContactCount: coverage.filter(witness => !witness.sourceCovered).length,
        sideLegCrossings, legSideCrossings,
        sideLegWitnesses: sideLegWitnesses.map(witness => ({ ...witness,
          restEdge: witness.edge.map(vertex => garment.mesh.position(vertex).toArray()),
          legRestCorners: legIndices.slice(witness.triangle * 3, witness.triangle * 3 + 3)
            .map(vertex => reference.points[support.originalLegVertices[vertex]!]!.toArray()),
          panelSide: garment.mesh.vertexPart[witness.edge[0]] === 0 ? 1 : -1,
          hipLocal: new Vector3().fromArray(witness.point).applyMatrix4(inverseDelta).toArray() })),
        aprons: apronRecords });
    }
    records.push({ quality: record.quality, modelSha256: record.modelSha256,
      ventAngle, edgeSamples, thighOnly: Boolean(values["thigh-only"]), sideTriangles: garment.mesh.triangleCount,
      originalLegTriangles: legIndices.length / 3,
      apronTriangles: aprons.reduce((sum, apron) => sum + apron.mesh.triangleCount, 0), supports: [...supports],
      maximumSideCrossings: Math.max(...phases.map(phase => phase.sideCrossings)),
      maximumNewExposureWitnesses: Math.max(...phases.map(phase => phase.newExposureWitnesses.length)),
      maximumNewInteriorExposureWitnesses: Math.max(...phases.map(phase => phase.newInteriorExposureWitnesses.length)),
      maximumOriginalCostumeLegCrossings: Math.max(...phases.map(phase => phase.originalCostumeLegCrossings)),
      maximumLegOriginalCostumeCrossings: Math.max(...phases.map(phase => phase.legOriginalCostumeCrossings)),
      maximumSideLegCrossings: Math.max(...phases.map(phase => phase.sideLegCrossings)),
      maximumLegSideCrossings: Math.max(...phases.map(phase => phase.legSideCrossings)),
      maximumApronSideCrossings: Math.max(...phases.flatMap(phase => phase.aprons.map(apron => apron.apronSideCrossings))),
      maximumSideApronCrossings: Math.max(...phases.flatMap(phase => phase.aprons.map(apron => apron.sideApronCrossings))),
      maximumApronLegCrossings: Math.max(...phases.flatMap(phase => phase.aprons.map(apron => apron.apronLegCrossings))),
      maximumLegApronCrossings: Math.max(...phases.flatMap(phase => phase.aprons.map(apron => apron.legApronCrossings))),
      maximumWaistDeficit: Math.max(...phases.flatMap(phase => phase.aprons.map(apron => apron.waistDeficit))),
      maximumDroppedSkinWeight: Math.max(...aprons.map(apron => apron.maximumDroppedSkinWeight)),
      maximumAngle: Math.max(...phases.flatMap(phase => phase.aprons.map(apron => apron.angle))), phases });
    previousGeometry.dispose(); worker.dispose();
  }
} finally { assets.restore(); }
const constructionPassed = records.every(record => record.maximumSideCrossings === 0
  && record.maximumSideLegCrossings === 0 && record.maximumLegSideCrossings === 0
  && record.maximumApronSideCrossings === 0 && record.maximumSideApronCrossings === 0
  && record.maximumApronLegCrossings === 0 && record.maximumLegApronCrossings === 0
  && record.maximumWaistDeficit <= 0);
assert.deepEqual(await hashes(), sourceHashes, "Construction source or original donor changed during the proof");
await writeFile(values.out, JSON.stringify({ constructionPassed, runtimeIntegrated: false,
  scope: "CPU-only proper slit side panels plus source-measured waist-hinged front/back aprons. Exact current equipped body/leg matrices; no rig/bone/runtime/model/image write. Full vertex and edge envelopes derive hinge angles. Original leg facets and sewn waist are checked separately. This is construction feasibility, not asset/native acceptance.",
  sourceHashes, assets: Object.fromEntries(assets.assets), records }, null, 2));
console.log(JSON.stringify(records.map(({ phases: _phases, ...record }) => record)));
