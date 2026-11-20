import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Matrix3, PerspectiveCamera, Raycaster, type SkinnedMesh, Triangle, Vector2, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createWorkerCombatPose } from "../../src/renderers/three/worker-combat-pose";
import { mountedWeaponPose } from "../../src/renderers/three/worker-mounted-equipment";
import { readCpuGltf } from "../assets/read-cpu-gltf";
import { closestClothRayTriangle } from "./source-cloth-ray-triangle";

const sourceFolder = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue");
const stage = resolve(process.argv[2] ?? "../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-hard-integer-a");
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const minimalPair = process.argv.includes("--minimal-pair");
const proofFlag = process.argv.indexOf("--minimal-proof");
const minimalProofName = proofFlag >= 0 ? process.argv[proofFlag + 1]! : "minimal-proof.json";
assert(/^minimal(?:-[a-z0-9]+)*-proof\.json$/.test(minimalProofName));
const minimalProof = minimalPair ? JSON.parse(readFileSync(resolve(stage, minimalProofName), "utf8")) : undefined;
const originalInput = resolve(sourceFolder, "model.glb");
const originalSourceSha256 = hash(originalInput);
assert.equal(originalSourceSha256, "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907");
const sourcePath = minimalPair ? minimalProof.outputs.find((entry: { variant: string }) => entry.variant === "original").file : originalInput;
const candidatePath = minimalPair ? minimalProof.outputs.find((entry: { variant: string }) => entry.variant === "candidate").file : resolve(stage, "model.glb");
const sourceSha256 = hash(sourcePath), candidateSha256 = hash(candidatePath);
const provenance = JSON.parse(readFileSync(resolve(stage, "provenance.json"), "utf8"));
if (minimalPair) {
  assert.equal(minimalProof.sourceSha256, originalSourceSha256);
  assert(minimalProof.sourceAppliedBeforeLod && minimalProof.allLiteralClothTopologyRetained
    && minimalProof.matchingOriginalMinimalAnatomyExact && !minimalProof.old11PointProfileUsed);
  for (const output of minimalProof.outputs) assert.equal(hash(output.file), output.sha256);
} else assert.equal(candidateSha256, provenance.candidateSha256);
const profile = JSON.parse(readFileSync(resolve(stage, "profile.json"), "utf8")) as {
  records: { vertex: number; joints: number[]; values: number[] }[];
};
const owned = new Set(profile.records.map(record => record.vertex));
assert.equal(owned.size, 137);
const samples = [
  { clip: "idle", time: .4, attack: null as number | null, guard: false },
  { clip: "idle", time: .4, attack: null, guard: true },
  ...[0, .4, .7, .9].map(attack => ({ clip: "idle", time: .4, attack, guard: false })),
  ...["walk", "trot", "gallop"].flatMap(clip => [.13, .41, .73].map(time => ({ clip, time, attack: null, guard: false })))
].flatMap(sample => [{ ...sample, engage: 0 }, { ...sample, engage: 1 }])
  .flatMap(sample => [{ ...sample, manualControl: true }, { ...sample, manualControl: false }]);
const frame = { actorId: 1, coat: "bay", commander: true, commanderLoadout: "axe", faction: 0,
  heading: 0, nation: "viking", rider: "viking-woman-blue", turnRate: 0, x: 0, y: 0, z: 0 };
const fixture = async (file: string) => {
  const loaded = await readCpuGltf(file), { animations } = await readCpuGltf(resolve(sourceFolder, "actions.glb"));
  const root = loaded.scene, hips = root.getObjectByName("Hips")!, standing = hips.position.y;
  const meshes: SkinnedMesh[] = [];
  root.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
  const body = meshes.findIndex(mesh => loaded.parser.associations.get(mesh)?.primitives === 0);
  const cloth = meshes.findIndex(mesh => loaded.parser.associations.get(mesh)?.primitives === 1);
  assert(body >= 0 && cloth >= 0);
  const capture = () => {
    root.updateMatrixWorld(true);
    return meshes.map(mesh => Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, vertex) =>
      mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld)));
  };
  const rest = capture(), restNormals = meshes.map(mesh =>
    Array.from({ length: mesh.geometry.getAttribute("normal").count }, (_, vertex) =>
      new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), vertex)
        .applyNormalMatrix(new Matrix3().getNormalMatrix(mesh.matrixWorld))));
  const horse = await readCpuGltf(resolve(sourceFolder, "../../horse/model.glb"));
  const horseMixer = new AnimationMixer(horse.scene);
  horseMixer.clipAction(horse.animations.find(clip => clip.name === "idle")!).play(); horseMixer.setTime(.4);
  horse.scene.getObjectByName("Saddle")!.add(root); horse.scene.scale.setScalar(WORKER_SCALE);
  horse.scene.position.set(0, .005, .36); horse.scene.rotation.y = .8;
  const mixer = new AnimationMixer(root), combat = createWorkerCombatPose(root, animations, true);
  const pose = (sample: typeof samples[number]) => {
    combat.reset(); mixer.stopAllAction(); horseMixer.stopAllAction();
    mixer.clipAction(animations.find(clip => clip.name === sample.clip)!).play(); mixer.setTime(sample.time);
    horseMixer.clipAction(horse.animations.find(clip => clip.name === sample.clip)!).play(); horseMixer.setTime(sample.time);
    combat.apply({ nation: "viking", combat: { type: "heavy", attackProgress: sample.attack, faction: 0 } } as never,
      mountedWeaponPose({ ...frame, engage: sample.engage, attackProgress: sample.attack, manualControl: sample.manualControl,
        manualGuard: sample.guard, guard: Number(sample.guard), clip: sample.clip, clipTime: sample.time } as never,
      standing - hips.position.y));
    horse.scene.updateMatrixWorld(true);
    return capture();
  };
  return { body, capture, cloth, hips, loaded, meshes, pose, rest, restNormals };
};
const original = await fixture(sourcePath), candidate = await fixture(candidatePath);
assert.equal(original.body, candidate.body); assert.equal(original.cloth, candidate.cloth);
const bodyIndex = original.body, clothIndex = original.cloth;
const indices = (mesh: SkinnedMesh) => Array.from(mesh.geometry.index!.array);
const clothIndices = indices(original.meshes[clothIndex]!);
assert.deepEqual(indices(candidate.meshes[clothIndex]!), clothIndices);
const encoded = candidate.meshes[clothIndex]!.geometry.getAttribute("skinWeight");
assert(encoded.normalized && encoded.array instanceof Uint16Array);
for (const record of profile.records) {
  const actual: number[] = Array.from(encoded.array.slice(record.vertex * 4, record.vertex * 4 + 4));
  assert.equal(actual.reduce((sum, value) => sum + value, 0), 65535);
  assert.deepEqual(actual, record.values.map(value => Math.round(value * 65535)), "Actual GLTFLoader normalization must retain exact integer witness");
}
const bodyMesh = original.meshes[bodyIndex]!, bodyIndices = indices(bodyMesh);
const leg = (vertex: number) => {
  const weights = bodyMesh.geometry.getAttribute("skinWeight"), joints = bodyMesh.geometry.getAttribute("skinIndex");
  const influences = [0, 1, 2, 3].map(slot => ({ weight: weights.getComponent(vertex, slot),
    name: bodyMesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name })).filter(item => item.weight > .00001);
  return influences.reduce((sum, item) => sum + (/^(Left|Right)UpLeg$/.test(item.name) ? item.weight : 0), 0) > .5
    && influences.every(item => /^(Hips|Spine\d*|(Left|Right)UpLeg)$/.test(item.name));
};
const faces = Array.from({ length: bodyIndices.length / 3 }, (_, face) => bodyIndices.slice(face * 3, face * 3 + 3))
  .filter(vertices => vertices.every(leg)).filter(vertices => {
    const point = vertices.reduce((sum, vertex) => sum.add(original.rest[bodyIndex]![vertex]!), new Vector3()).divideScalar(3);
    return point.y > .41 && point.y < .57 && Math.abs(point.x) > .05 && point.z > -.02;
  });
const coordinates = [[1 / 3, 1 / 3, 1 / 3], ...Array.from({ length: 5 }, (_, a) =>
  Array.from({ length: 5 - a }, (_, b) => [(a + .2) / 4.6, (b + .2) / 4.6, (4 - a - b + .2) / 4.6])).flat()];
const coverage = (points: Vector3[][], hips: Vector3) => {
  const grid = new TriangleGrid(points[clothIndex]!, clothIndices);
  return faces.flatMap(vertices => {
    const normal = new Triangle(...vertices.map(vertex => points[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3]).getNormal(new Vector3());
    const sourceNormal = new Triangle(...vertices.map(vertex => original.rest[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3]).getNormal(new Vector3());
    const average = vertices.reduce((sum, vertex) => sum.add(original.restNormals[bodyIndex]![vertex]!), new Vector3());
    if (sourceNormal.dot(average) < 0) normal.negate();
    const side = Math.sign(vertices.reduce((sum, vertex) => sum + original.rest[bodyIndex]![vertex]!.x, 0));
    const camera = new Vector3(side * .7, .2, .8).applyAxisAngle(new Vector3(0, 1, 0), .8).add(hips);
    return coordinates.map(bary => {
      const point = vertices.reduce((sum, vertex, corner) => sum.addScaledVector(points[bodyIndex]![vertex]!, bary[corner]!), new Vector3());
      const direction = camera.clone().sub(point), distance = direction.length(); direction.normalize();
      return { normal: !!grid.raycast(point.clone().addScaledVector(normal, .00015), normal, 0, .05),
        camera: direction.dot(normal) > 0 && !!grid.raycast(point.clone().addScaledVector(direction, .00015), direction, 0, distance) };
    });
  });
};
const guards = [];
for (const [caseIndex, sample] of samples.entries()) {
  const before = original.pose(sample), after = candidate.pose(sample);
  const sourceCoverage = coverage(before, original.hips.getWorldPosition(new Vector3()));
  const candidateCoverage = coverage(after, candidate.hips.getWorldPosition(new Vector3()));
  const loss = (key: "normal" | "camera") => sourceCoverage.flatMap((value, index) => value[key] && !candidateCoverage[index]![key] ? [index] : []);
  let bodyDifference = 0, outsideClothDifference = 0, maximumMotion = 0, maximumRestoredMotion = 0;
  for (let mesh = 0; mesh < before.length; mesh++) for (let vertex = 0; vertex < before[mesh]!.length; vertex++) {
    const distance = before[mesh]![vertex]!.distanceTo(after[mesh]![vertex]!);
    if (mesh !== clothIndex) bodyDifference = Math.max(bodyDifference, distance);
    else if (!owned.has(vertex)) outsideClothDifference = Math.max(outsideClothDifference, distance);
    else if ([137, 151].includes(vertex)) maximumRestoredMotion = Math.max(maximumRestoredMotion, distance);
    else maximumMotion = Math.max(maximumMotion, distance);
  }
  const guard = { caseIndex, ...sample, examined: sourceCoverage.length, bodyDifference, outsideClothDifference,
    maximumMotion, maximumRestoredMotion, newCameraExposures: loss("camera"), newNormalExposures: loss("normal"),
    originalCameraCovered: sourceCoverage.filter(value => value.camera).length,
    originalNormalCovered: sourceCoverage.filter(value => value.normal).length };
  guards.push(guard);
  console.log(JSON.stringify({ caseIndex, cameraLoss: guard.newCameraExposures.length,
    normalLoss: guard.newNormalExposures.length, maximumMotion, bodyDifference }));
}
const strike = samples.find(sample => sample.attack === .7 && sample.engage === 1 && sample.manualControl)!;
const probes = (actor: typeof original) => {
  const points = actor.pose(strike), hips = actor.hips.getWorldPosition(new Vector3());
  const grids = actor.meshes.map((mesh, index) => ({ primitive: actor.loaded.parser.associations.get(mesh)?.primitives,
    grid: new TriangleGrid(points[index]!, indices(mesh)) }));
  return [
    { side: 1, name: "left", pixels: [[470, 375], [500, 360], [510, 390], [470, 405], [540, 350], [410, 450]] },
    { side: -1, name: "right", pixels: [[335, 355], [390, 365], [420, 390], [330, 415], [280, 430], [470, 445]] }
  ].flatMap(view => {
    const camera = new PerspectiveCamera(30, 900 / 800, .01, 100);
    camera.position.copy(hips).add(new Vector3(view.side * .7, .2, .8).applyAxisAngle(new Vector3(0, 1, 0), .8));
    camera.lookAt(hips.x, hips.y - .07, hips.z); camera.updateMatrixWorld(true);
    return view.pixels.map((pixel, at) => {
      const ray = new Raycaster(); ray.setFromCamera(new Vector2(pixel[0]! / 450 - 1, 1 - pixel[1]! / 400), camera);
      const hits = grids.map(({ grid, primitive }) => ({ primitive, hit: grid.raycast(ray.ray.origin, ray.ray.direction, 0, 100) }))
        .filter(item => item.hit).sort((a, b) => a.hit!.distance - b.hit!.distance);
      return { view: view.name, pixel, target: at < (view.name === "left" ? 5 : 3), firstPrimitive: hits[0]?.primitive,
        firstFace: hits[0]?.hit!.triangle };
    });
  });
};
const originalProbes = probes(original), candidateProbes = probes(candidate);
const targetFailures = candidateProbes.filter(probe => probe.target && probe.firstPrimitive !== 1);
const hemFailures = candidateProbes.filter(probe => probe.view === "right" && ["330,415", "280,430"].includes(probe.pixel.join())
  && probe.firstPrimitive !== 0);
const report = { sourceSha256, candidateSha256, originalSourceSha256, minimalPair,
  actualWholeSourceGlbReload: true, stableNormalizedUint16Weights: true,
  samples: samples.length, examinedPerPose: faces.length * coordinates.length, guards, originalProbes, candidateProbes,
  originalTargetBodyFirstCount: originalProbes.filter(probe => probe.target && probe.firstPrimitive === 0).length,
  targetFailures, hemFailures, newCameraExposures: guards.reduce((sum, guard) => sum + guard.newCameraExposures.length, 0),
  newNormalExposures: guards.reduce((sum, guard) => sum + guard.newNormalExposures.length, 0),
  bodyDifference: Math.max(...guards.map(guard => guard.bodyDifference)),
  outsideClothDifference: Math.max(...guards.map(guard => guard.outsideClothDifference)),
  maximumMotion: Math.max(...guards.map(guard => guard.maximumMotion)),
  maximumRestoredMotion: Math.max(...guards.map(guard => guard.maximumRestoredMotion)),
  sourceUnchanged: hash(sourcePath) === sourceSha256, candidateUnchanged: hash(candidatePath) === candidateSha256,
  nativeAccepted: false, productionPublished: false };
if (process.argv.includes("--dump-normal-constraints")) {
  const input = JSON.parse(readFileSync("/tmp/viking-hard-contact-input.json", "utf8")) as {
    groupOf: [number, number][];
    motion: { caseIndex: number; vertex: number; basis: { x: number; y: number; z: number }[] }[];
    sourceSha256: string;
  };
  assert.equal(input.sourceSha256, sourceSha256);
  assert.equal(hash("/tmp/viking-hard-contact-input.json"), "1ba0005af737a6cd8fecbb666d53e1b8075c6bf4ed9c0799818617a9b57c4c27");
  const groups = new Map(input.groupOf), motion = new Map(input.motion.map(cell => [`${cell.caseIndex}:${cell.vertex}`, cell]));
  const affectedSamples = [...new Set(guards.flatMap(guard => guard.newNormalExposures))].sort((a, b) => a - b);
  const constraints = [];
  for (const [caseIndex, sample] of samples.entries()) {
    const points = original.pose(sample), grid = new TriangleGrid(points[clothIndex]!, clothIndices);
    const corner = (vertex: number) => ({ group: groups.get(vertex) ?? -1, base: points[clothIndex]![vertex]!,
      delta: new Vector3(), basis: motion.get(`${caseIndex}:${vertex}`)?.basis });
    for (const index of affectedSamples) {
      const vertices = faces[Math.floor(index / coordinates.length)]!, bary = coordinates[index % coordinates.length]!;
      const normal = new Triangle(...vertices.map(vertex => points[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3]).getNormal(new Vector3());
      const restNormal = new Triangle(...vertices.map(vertex => original.rest[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3]).getNormal(new Vector3());
      const average = vertices.reduce((sum, vertex) => sum.add(original.restNormals[bodyIndex]![vertex]!), new Vector3());
      if (restNormal.dot(average) < 0) normal.negate();
      const origin = vertices.reduce((sum, vertex, at) => sum.addScaledVector(points[bodyIndex]![vertex]!, bary[at]!), new Vector3())
        .addScaledVector(normal, .00015);
      const hit = grid.raycast(origin, normal, 0, .05);
      if (!hit) continue; // Preserve only coverage actually present in the original authored source.
      const originalFace = clothIndices.slice(hit.triangle * 3, hit.triangle * 3 + 3);
      const alternatives = [];
      for (let face = 0; face < clothIndices.length / 3; face++) {
        if (face === hit.triangle) continue;
        const own = clothIndices.slice(face * 3, face * 3 + 3);
        const distance = closestClothRayTriangle(origin, normal, .05, own.map(vertex => points[clothIndex]![vertex]!), 0).distanceSquared;
        // All facets capable of reaching this segment under the authorized65mm vertex motion.
        if (distance <= .065 ** 2) alternatives.push(own);
      }
      constraints.push({ caseIndex, sampleIndex: index, sourceBodyVertices: vertices, sourceBodyBarycentric: bary,
        origin, direction: normal, length: .05, target: false, kind: "original-normal-preservation",
        originalSourceFace: hit.triangle, originalSourceDistance: hit.distance,
        corners: originalFace.map(corner), alternatives: alternatives.map(face => face.map(corner)),
        sourceVertices: originalFace, alternativeSourceVertices: alternatives });
    }
  }
  writeFileSync(resolve(stage, "normal-preservation-constraints-a.json"), JSON.stringify({ sourceSha256, candidateSha256,
    originalInputSha256: hash("/tmp/viking-hard-contact-input.json"), actualLoadedGlbVerified: true,
    affectedSamples, originalCoveredSamplePoses: constraints.length, constraints,
    scope: "All original-covered normal contacts for the seven actual loaded-loss sample indices across all60poses; all source facets reachable under65mm motion retained. No optimization or publication." }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ normalPreservationConstraints: constraints.length, affectedSamples }));
} else writeFileSync(resolve(stage, minimalPair ? minimalProofName.replace("-proof.json", "-actual-loaded-60-pose-validation.json") : "actual-loaded-60-pose-validation.json"),
  JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...report, guards: undefined, originalProbes: undefined, candidateProbes: undefined }));
