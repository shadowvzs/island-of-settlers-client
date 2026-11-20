import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Matrix3, Matrix4, PerspectiveCamera, Ray, Raycaster, type SkinnedMesh, Triangle, Vector2, Vector3 } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createWorkerCombatPose } from "../../src/renderers/three/worker-combat-pose";
import { mountedWeaponPose } from "../../src/renderers/three/worker-mounted-equipment";
import { readCpuGltf } from "../assets/read-cpu-gltf";
import { type DonorRayConstraint, evaluateSourceClothBoneRays, fitSourceClothBoneRays, fitSourceClothDonorRays } from "./source-cloth-donor-ray-fit";
import { applyLoadedSourceClothProfile } from "./source-cloth-loaded-profile";
import { sourceClothWeightVertices } from "./source-cloth-weight-polytope";

// CPU-only attribution of the frozen native-a engaged cameras. Original assets are read-only.
const folder = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue");
const source = await readCpuGltf(resolve(folder, "model.glb"));
const { animations } = await readCpuGltf(resolve(folder, "actions.glb"));
const root = source.scene, hips = root.getObjectByName("Hips")!, standing = hips.position.y;
const meshes: SkinnedMesh[] = [];
root.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
const capture = () => {
  root.updateMatrixWorld(true);
  return meshes.map(mesh => Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, vertex) =>
    mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld)));
};
const rest = capture();
const restNormals = meshes.map(mesh => Array.from({ length: mesh.geometry.getAttribute("normal").count }, (_, vertex) =>
  new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), vertex)
    .applyNormalMatrix(new Matrix3().getNormalMatrix(mesh.matrixWorld))));
const weights = (mesh: SkinnedMesh, vertex: number) => [0, 1, 2, 3].flatMap(slot => {
  const weight = mesh.geometry.getAttribute("skinWeight").getComponent(vertex, slot);
  return weight > .00001 ? [{ bone: mesh.skeleton.bones[mesh.geometry.getAttribute("skinIndex").getComponent(vertex, slot)]!.name,
    weight }] : [];
});
const horse = await readCpuGltf(resolve(folder, "../../horse/model.glb"));
const horseMixer = new AnimationMixer(horse.scene);
horseMixer.clipAction(horse.animations.find(clip => clip.name === "idle")!).play(); horseMixer.setTime(.4);
horse.scene.getObjectByName("Saddle")!.add(root); horse.scene.scale.setScalar(WORKER_SCALE);
horse.scene.position.set(0, .005, .36); horse.scene.rotation.y = .8;
const mixer = new AnimationMixer(root), combat = createWorkerCombatPose(root, animations, true);
mixer.clipAction(animations.find(clip => clip.name === "idle")!).play(); mixer.setTime(.4);
const frame = { actorId: 1, attackProgress: .7, clip: "idle", clipTime: .4, coat: "bay", commander: true,
  commanderLoadout: "axe", engage: 1, faction: 0, guard: 0, manualGuard: false, manualControl: true,
  heading: 0, nation: "viking", rider: "viking-woman-blue", turnRate: 0, x: 0, y: 0, z: 0 };
combat.apply({ nation: "viking", combat: { type: "heavy", attackProgress: .7, faction: 0 } } as never,
  mountedWeaponPose(frame as never, standing - hips.position.y));
horse.scene.updateMatrixWorld(true);
let posed = capture();
const hipPosition = hips.getWorldPosition(new Vector3()), raycaster = new Raycaster();
const triangle = new Triangle(), point = new Vector3(), bary = new Vector3();
const views = [
  { side: 1, name: "left", pixels: [[470, 375], [500, 360], [510, 390], [470, 405], [540, 350], [410, 450]] },
  { side: -1, name: "right", pixels: [[335, 355], [390, 365], [420, 390], [330, 415], [280, 430], [470, 445]] }
];
const mapViews = () => views.map(view => {
  const camera = new PerspectiveCamera(30, 900 / 800, .01, 100);
  const offset = new Vector3(view.side * .7, .2, .8).applyAxisAngle(new Vector3(0, 1, 0), .8);
  camera.position.copy(hipPosition).add(offset); camera.lookAt(hipPosition.x, hipPosition.y - .07, hipPosition.z);
  camera.updateMatrixWorld(true);
  return { view: view.name, hips: hipPosition.toArray(), camera: camera.position.toArray(), rays: view.pixels.map(pixel => {
    raycaster.setFromCamera(new Vector2(pixel[0]! / 900 * 2 - 1, 1 - pixel[1]! / 800 * 2), camera);
    const hits = meshes.flatMap((mesh, mi) => {
      const indices = mesh.geometry.index!, result = [];
      for (let face = 0; face < indices.count / 3; face++) {
        const vertices = [0, 1, 2].map(corner => indices.getX(face * 3 + corner));
        triangle.set(...vertices.map(vertex => posed[mi]![vertex]!) as [Vector3, Vector3, Vector3]);
        if (!raycaster.ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, point)) continue;
        triangle.getBarycoord(point, bary);
        const sourcePoint = vertices.reduce((sum, vertex, corner) =>
          sum.addScaledVector(rest[mi]![vertex]!, bary.getComponent(corner)), new Vector3());
        result.push({ mesh: mesh.name, primitive: source.parser.associations.get(mesh)?.primitives,
          face, vertices, distance: point.distanceTo(raycaster.ray.origin), sourcePoint: sourcePoint.toArray(),
          rest: vertices.map(vertex => rest[mi]![vertex]!.toArray()), weights: vertices.map(vertex => weights(mesh, vertex)) });
      }
      return result;
    }).sort((a, b) => a.distance - b.distance);
    return { pixel, hits: hits.slice(0, 6) };
  }) };
});
const rows = mapViews();
const bodyIndex = meshes.findIndex(mesh => source.parser.associations.get(mesh)?.primitives === 0);
const clothIndex = meshes.findIndex(mesh => source.parser.associations.get(mesh)?.primitives === 1);
const body = meshes[bodyIndex]!, cloth = meshes[clothIndex]!, bodyIndices = body.geometry.index!;
const initialBodyPoints = posed[bodyIndex]!;
const originalIndices = cloth.geometry.getAttribute("skinIndex").clone();
const originalWeights = cloth.geometry.getAttribute("skinWeight").clone();
const protectedLeg = (vertex: number) => {
  const bindings = weights(body, vertex);
  return bindings.reduce((sum, binding) => sum + (/^(Left|Right)UpLeg$/.test(binding.bone) ? binding.weight : 0), 0) > .5 &&
    bindings.every(binding => /^(Hips|Spine\d*|(Left|Right)UpLeg)$/.test(binding.bone));
};
const legFaces = Array.from({ length: bodyIndices.count / 3 }, (_, face) =>
  [0, 1, 2].map(corner => bodyIndices.getX(face * 3 + corner))).filter(vertices => vertices.every(protectedLeg));
const samples = [
  { clip: "idle", time: .4, attack: null as number | null, guard: false },
  { clip: "idle", time: .4, attack: null, guard: true },
  ...[0, .4, .7, .9].map(attack => ({ clip: "idle", time: .4, attack, guard: false })),
  ...["walk", "trot", "gallop"].flatMap(clip => [.13, .41, .73].map(time => ({ clip, time, attack: null, guard: false })))
].flatMap(sample => [{ ...sample, engage: 0 }, { ...sample, engage: 1 }])
  .flatMap(sample => [{ ...sample, manualControl: true }, { ...sample, manualControl: false }]);
const poseSample = (sample: typeof samples[number]) => {
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
if (process.argv.includes("--bone-audit")) {
  const pairs = [["Hips", "ClothFront"], ["Spine", "Spine1"], ["Spine1", "Spine2"]];
  const reports = pairs.map(pair => ({ pair, maximumMatrixDifference: 0 }));
  for (const sample of samples) {
    poseSample(sample);
    for (const report of reports) {
      const transforms = report.pair.map(name => {
        const index = cloth.skeleton.bones.findIndex(bone => bone.name === name);
        assert(index >= 0);
        return new Matrix4().multiplyMatrices(cloth.skeleton.bones[index]!.matrixWorld,
          cloth.skeleton.boneInverses[index]!);
      });
      report.maximumMatrixDifference = Math.max(report.maximumMatrixDifference,
        ...transforms[0]!.elements.map((value, index) => Math.abs(value - transforms[1]!.elements[index]!)));
    }
  }
  writeFileSync(resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/source-bone-equivalence-audit.json"),
    JSON.stringify({ samples: samples.length, reports }, null, 2));
  console.log(JSON.stringify({ samples: samples.length, reports }));
  process.exit(0);
}
const clothFaces = Array.from({ length: cloth.geometry.index!.count / 3 }, (_, face) =>
  [0, 1, 2].map(corner => cloth.geometry.index!.getX(face * 3 + corner)));
const coverageFaces = legFaces.filter(vertices => {
  const centroid = vertices.reduce((sum, vertex) => sum.add(rest[bodyIndex]![vertex]!), new Vector3()).divideScalar(3);
  return centroid.y > .41 && centroid.y < .57 && Math.abs(centroid.x) > .05 && centroid.z > -.02;
});
const dense = process.argv.includes("--dense");
const coverageCoordinates = dense ? [[1 / 3, 1 / 3, 1 / 3], ...Array.from({ length: 5 }, (_, a) =>
  Array.from({ length: 5 - a }, (_, b) => [(a + .2) / 4.6, (b + .2) / 4.6, (4 - a - b + .2) / 4.6])).flat()]
  : [[1 / 3, 1 / 3, 1 / 3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]];
const coverage = (points: Vector3[][]) => {
  const ray = new Ray(), hit = new Vector3();
  return coverageFaces.flatMap(vertices => {
    const normal = new Triangle(...vertices.map(vertex => points[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3])
      .getNormal(new Vector3());
    const sourceNormal = new Triangle(...vertices.map(vertex => rest[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3])
      .getNormal(new Vector3());
    const average = vertices.reduce((sum, vertex) => sum.add(restNormals[bodyIndex]![vertex]!), new Vector3());
    if (sourceNormal.dot(average) < 0) normal.negate();
    return coverageCoordinates.map(coordinates => {
      const origin = vertices.reduce((sum, vertex, corner) =>
        sum.addScaledVector(points[bodyIndex]![vertex]!, coordinates[corner]!), new Vector3());
      ray.set(origin.addScaledVector(normal, .00015), normal);
      return clothFaces.some(face => {
        const found = ray.intersectTriangle(...face.map(vertex => points[clothIndex]![vertex]!) as [Vector3, Vector3, Vector3], false, hit);
        return found && hit.distanceTo(ray.origin) <= .05;
      });
    });
  });
};
const cameraCoverage = (points: Vector3[][]) => {
  const ray = new Ray(), hit = new Vector3(), currentHips = hips.getWorldPosition(new Vector3());
  return coverageFaces.flatMap(vertices => {
    const normal = new Triangle(...vertices.map(vertex => points[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3])
      .getNormal(new Vector3());
    const sourceNormal = new Triangle(...vertices.map(vertex => rest[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3])
      .getNormal(new Vector3());
    const average = vertices.reduce((sum, vertex) => sum.add(restNormals[bodyIndex]![vertex]!), new Vector3());
    if (sourceNormal.dot(average) < 0) normal.negate();
    const side = Math.sign(vertices.reduce((sum, vertex) => sum + rest[bodyIndex]![vertex]!.x, 0));
    const cameraPosition = new Vector3(side * .7, .2, .8).applyAxisAngle(new Vector3(0, 1, 0), .8).add(currentHips);
    return coverageCoordinates.map(coordinates => {
      const origin = vertices.reduce((sum, vertex, corner) =>
        sum.addScaledVector(points[bodyIndex]![vertex]!, coordinates[corner]!), new Vector3());
      const direction = cameraPosition.clone().sub(origin), maximum = direction.length(); direction.normalize();
      if (direction.dot(normal) <= 0) return false;
      ray.set(origin.addScaledVector(direction, .00015), direction);
      return clothFaces.some(face => {
        const found = ray.intersectTriangle(...face.map(vertex => points[clothIndex]![vertex]!) as [Vector3, Vector3, Vector3], false, hit);
        return found && hit.distanceTo(ray.origin) < maximum;
      });
    });
  });
};
const baseline = samples.map(sample => { const points = poseSample(sample);
  return { points, covered: coverage(points), cameraCovered: cameraCoverage(points) }; });
if (process.argv.includes("--target-origin-audit")) {
  const strikeIndex = samples.findIndex(sample => sample.attack === .7 && sample.engage === 1 && sample.manualControl);
  posed = poseSample(samples[strikeIndex]!);
  const currentRows = mapViews();
  const targets = rows.flatMap(view => view.rays.slice(0, view.view === "left" ? 5 : 3).map(original => {
    const current = currentRows.find(row => row.view === view.view)!.rays.find(ray => ray.pixel.join() === original.pixel.join())!;
    const currentBody = current.hits.find(hit => hit.primitive === 0);
    return { view: view.view, pixel: original.pixel, originalFirstPrimitive: original.hits[0]!.primitive,
      originalFirstDistance: original.hits[0]!.distance, currentFirstPrimitive: current.hits[0]!.primitive,
      currentFirstDistance: current.hits[0]!.distance, currentBodyDistance: currentBody?.distance,
      targetOriginInFrontOfCurrentBody: currentBody ? currentBody.distance - original.hits[0]!.distance + .00015 : null };
  }));
  const report = { newFit: false, originalSourceUnchanged: true, strikeIndex,
    maximumInitialVersusResetBodyDifference: Math.max(...initialBodyPoints.map((point, vertex) =>
      point.distanceTo(baseline[strikeIndex]!.points[bodyIndex]![vertex]!))), targets };
  writeFileSync("/tmp/viking-target-origin-audit.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(0);
}
poseSample(samples.find(sample => sample.attack === .7 && sample.engage === 1)!);
const traceSample = (points: Vector3[][], index: number, cameraRay = false) => {
  const vertices = coverageFaces[Math.floor(index / coverageCoordinates.length)]!;
  const coordinates = coverageCoordinates[index % coverageCoordinates.length]!;
  const normal = new Triangle(...vertices.map(vertex => points[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3])
    .getNormal(new Vector3());
  const sourceNormal = new Triangle(...vertices.map(vertex => rest[bodyIndex]![vertex]!) as [Vector3, Vector3, Vector3])
    .getNormal(new Vector3());
  const average = vertices.reduce((sum, vertex) => sum.add(restNormals[bodyIndex]![vertex]!), new Vector3());
  if (sourceNormal.dot(average) < 0) normal.negate();
  const origin = vertices.reduce((sum, vertex, corner) =>
    sum.addScaledVector(points[bodyIndex]![vertex]!, coordinates[corner]!), new Vector3());
  if (cameraRay) {
    const side = Math.sign(vertices.reduce((sum, vertex) => sum + rest[bodyIndex]![vertex]!.x, 0));
    normal.copy(new Vector3(side * .7, .2, .8).applyAxisAngle(new Vector3(0, 1, 0), .8)
      .add(hips.getWorldPosition(new Vector3())).sub(origin).normalize());
  }
  const ray = new Ray(origin.addScaledVector(normal, .00015), normal), target = new Vector3();
  return clothFaces.flatMap((face, faceIndex) => {
    if (!ray.intersectTriangle(...face.map(vertex => points[clothIndex]![vertex]!) as [Vector3, Vector3, Vector3], false, target)) return [];
    return [{ face: faceIndex, vertices: face, distance: target.distanceTo(origin),
      sourcePoints: face.map(vertex => rest[clothIndex]![vertex]!.toArray()) }];
  }).sort((a, b) => a.distance - b.distance).slice(0, 3);
};
const donors = rest[clothIndex]!.flatMap((sourcePoint, vertex) => {
  // Diagnostic region around the confirmed bilateral apertures, including both authored shell layers.
  if (sourcePoint.y < .425 || sourcePoint.y > .555 || Math.abs(sourcePoint.x) < .06 || sourcePoint.z < -.005) return [];
  let distance = .035, best: { vertices: number[]; bary: number[] } | undefined;
  for (const vertices of legFaces) {
    triangle.set(...vertices.map(index => rest[bodyIndex]![index]!) as [Vector3, Vector3, Vector3]);
    triangle.closestPointToPoint(sourcePoint, point);
    const gap = sourcePoint.distanceTo(point);
    if (gap >= distance) continue;
    const coordinates = triangle.getBarycoord(point, new Vector3());
    if (!coordinates) continue;
    distance = gap; best = { vertices, bary: coordinates.toArray() };
  }
  if (!best) return [];
  const palette = new Map<number, number>();
  for (const [corner, index] of best.vertices.entries()) for (let slot = 0; slot < 4; slot++) {
    const joint = body.geometry.getAttribute("skinIndex").getComponent(index, slot);
    const weight = body.geometry.getAttribute("skinWeight").getComponent(index, slot) * best.bary[corner]!;
    palette.set(joint, (palette.get(joint) ?? 0) + weight);
  }
  const sorted = [...palette].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = sorted.reduce((sum, entry) => sum + entry[1], 0);
  while (sorted.length < 4) sorted.push([0, 0]);
  return [{ vertex, distance, sourceBodyFace: best.vertices,
    joints: sorted.map(entry => entry[0]), values: sorted.map(entry => entry[1] / total) }];
});
for (const donor of donors) {
  cloth.geometry.getAttribute("skinIndex").setXYZW(donor.vertex, ...donor.joints as [number, number, number, number]);
  cloth.geometry.getAttribute("skinWeight").setXYZW(donor.vertex, ...donor.values as [number, number, number, number]);
}
const old = posed;
posed = capture();
const donorRows = mapViews();
const maximumStrikeShift = Math.max(...donors.map(donor =>
  posed[clothIndex]![donor.vertex]!.distanceTo(old[clothIndex]![donor.vertex]!)));
const controls = [];
const conservative = process.argv.includes("--conservative");
const connectedFit = process.argv.includes("--fit");
const boneFit = process.argv.includes("--bone-fit");
const sourceHull = process.argv.includes("--source-hull");
assert(!sourceHull || boneFit, "An exact-source support hull needs the four-bone solver");
const surfaceFit = process.argv.includes("--surface-fit");
assert(!surfaceFit || sourceHull, "Moving surface correspondence needs the feasible original-source hull");
const continueSurface = process.argv.includes("--continue-surface");
assert(!continueSurface || surfaceFit, "Only the bounded surface fit can be continued");
const restoredMask = process.argv.includes("--restore-approved-cloth");
assert(!restoredMask || surfaceFit, "The restored approved source points require the guarded surface hull");
const pairedShell = process.argv.includes("--paired-shell-contact");
assert(!pairedShell || restoredMask, "Physical paired-shell correspondence uses the approved restored cloth mask");
const approvedSpineSeed = process.argv.includes("--approved-spine-seed");
assert(!approvedSpineSeed || pairedShell, "Previously approved cloth support needs the guarded restored paired-shell control");
const approvedProfile = approvedSpineSeed ? JSON.parse(readFileSync(resolve(
  "../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-spine-approved-a/profile.json"), "utf8")) : undefined;
if (approvedProfile) assert.equal(approvedProfile.inputHash,
  "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907");
const approvedRecords = new Map<number, { joints: number[]; values: number[] }>(
  (approvedProfile?.records ?? []).map((record: { vertex: number; joints: number[]; values: number[] }) => [record.vertex, record]));
const controlOptions = [[.065, 1, false], [.075, 1, false], [.085, .5, false], [.085, .7, false],
  [.085, .775, false], [.085, .85, false], [.085, 1, false], [.095, 1, false], [.085, .775, true]] as const;
for (const [threshold, amount, pinBoundary] of controlOptions.filter(option => !dense || option[2])) {
  for (let vertex = 0; vertex < originalIndices.count; vertex++) {
    cloth.geometry.getAttribute("skinIndex").setXYZW(vertex, ...[0, 1, 2, 3].map(slot =>
      originalIndices.getComponent(vertex, slot)) as [number, number, number, number]);
    cloth.geometry.getAttribute("skinWeight").setXYZW(vertex, ...[0, 1, 2, 3].map(slot =>
      originalWeights.getComponent(vertex, slot)) as [number, number, number, number]);
  }
  let included = donors.filter(donor => (Math.abs(rest[clothIndex]![donor.vertex]!.x) >= threshold ||
    restoredMask && [137, 151].includes(donor.vertex)) &&
    (!pinBoundary || conservative || connectedFit || boneFit || ![1576, 34, 2, 32, 775, 776, 777, 1602, 1604, 1605].some(vertex =>
      rest[clothIndex]![vertex]!.distanceTo(rest[clothIndex]![donor.vertex]!) < .000001)));
  for (const donor of included) {
    const merged = new Map<number, number>();
    for (let slot = 0; slot < 4; slot++) {
      const originalJoint = originalIndices.getComponent(donor.vertex, slot);
      merged.set(originalJoint, (merged.get(originalJoint) ?? 0) + originalWeights.getComponent(donor.vertex, slot) * (1 - amount));
      merged.set(donor.joints[slot]!, (merged.get(donor.joints[slot]!) ?? 0) + donor.values[slot]! * amount);
    }
    const sorted = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4), total = sorted.reduce((sum, row) => sum + row[1], 0);
    while (sorted.length < 4) sorted.push([0, 0]);
    cloth.geometry.getAttribute("skinIndex").setXYZW(donor.vertex, ...sorted.map(row => row[0]) as [number, number, number, number]);
    cloth.geometry.getAttribute("skinWeight").setXYZW(donor.vertex, ...sorted.map(row => row[1] / total) as [number, number, number, number]);
  }
  let fit;
  if (connectedFit || boneFit) {
    if (restoredMask) {
      assert.equal(included.length, 137);
      assert(included.some(donor => donor.vertex === 137) && included.some(donor => donor.vertex === 151));
    }
    poseSample(samples.find(sample => sample.attack === .7 && sample.engage === 1 && sample.manualControl)!);
    posed = capture();
    const positiveTargets = mapViews();
    const keys = new Map<string, number>(), groupOf = new Map<number, number>();
    const groupKey = (vertex: number) => [...rest[clothIndex]![vertex]!.toArray().map(value => value.toFixed(6)),
      ...[0, 1, 2, 3].map(slot => `${originalIndices.getComponent(vertex, slot)}:${originalWeights.getComponent(vertex, slot)}`)].join();
    for (const donor of included) {
      const key = groupKey(donor.vertex);
      if (!keys.has(key)) keys.set(key, keys.size);
      groupOf.set(donor.vertex, keys.get(key)!);
    }
    const sourceJoints = (vertex: number) => {
      const original = [0, 1, 2, 3].filter(slot => originalWeights.getComponent(vertex, slot) > 0)
        .map(slot => originalIndices.getComponent(vertex, slot));
      const extras = ["Spine", rest[clothIndex]![vertex]!.x > 0 ? "LeftUpLeg" : "RightUpLeg", "Hips", "ClothFront"]
        .map(name => cloth.skeleton.bones.findIndex(bone => bone.name === name));
      return [...new Set([...original, ...extras])].slice(0, 4);
    };
    const candidateJoints = (vertex: number) => {
      if (approvedRecords.has(vertex)) return approvedRecords.get(vertex)!.joints;
      if (!boneFit) return [0, 1, 2, 3].map(slot =>
        cloth.geometry.getAttribute("skinIndex").getComponent(vertex, slot));
      if (sourceHull) return sourceJoints(vertex);
      return ["Hips", "ClothFront", rest[clothIndex]![vertex]!.x > 0 ? "LeftUpLeg" : "RightUpLeg", "Spine"]
        .map(name => cloth.skeleton.bones.findIndex(bone => bone.name === name));
    };
    const targetWeights = included.map(donor => ({ vertex: donor.vertex,
      joints: candidateJoints(donor.vertex),
      values: [0, 1, 2, 3].map(slot => cloth.geometry.getAttribute("skinWeight").getComponent(donor.vertex, slot)) }));
    const baseWeights = targetWeights.map(record => {
      const seenJoints = new Set<number>();
      const values = record.joints.map(joint => {
        if (seenJoints.has(joint)) return 0;
        seenJoints.add(joint);
        return [0, 1, 2, 3].reduce((sum, slot) => sum +
          (originalIndices.getComponent(record.vertex, slot) === joint ? originalWeights.getComponent(record.vertex, slot) : 0), 0);
      });
      const hipsSlot = record.joints.findIndex(joint => cloth.skeleton.bones[joint]!.name === "Hips");
      values[Math.max(0, hipsSlot)]! += 1 - values.reduce((sum, value) => sum + value, 0);
      return { ...record, values };
    });
    const writeRecords = (records: typeof targetWeights) => { for (const record of records) {
      assert(record.values.every(value => value >= 0 && value <= 1), "Skin interpolation must stay in the nonnegative normalized simplex");
      assert(Math.abs(record.values.reduce((sum, value) => sum + value, 0) - 1) < .0001);
      cloth.geometry.getAttribute("skinIndex").setXYZW(record.vertex, ...record.joints as [number, number, number, number]);
      cloth.geometry.getAttribute("skinWeight").setXYZW(record.vertex, ...record.values as [number, number, number, number]);
    } };
    writeRecords(baseWeights);
    const bases = samples.map(poseSample);
    if (sourceHull) {
      const seedError = Math.max(...included.filter(donor => !approvedRecords.has(donor.vertex)).flatMap(donor => samples.map((_, caseIndex) =>
        bases[caseIndex]![clothIndex]![donor.vertex]!.distanceTo(baseline[caseIndex]!.points[clothIndex]![donor.vertex]!))));
      assert(seedError < .000001, "The preserved-source hull seed must reproduce all original poses before fitting");
    }
    if (!boneFit) writeRecords(targetWeights);
    const endpoints = samples.map(poseSample);
    const basis = boneFit ? [0, 1, 2, 3].map(slot => {
      writeRecords(baseWeights.map(record => ({ ...record, values: [0, 1, 2, 3].map(index => Number(index === slot)) })));
      return samples.map(sample => {
        poseSample(sample);
        return new Map(included.map(donor => [donor.vertex,
          cloth.getVertexPosition(donor.vertex, new Vector3()).applyMatrix4(cloth.matrixWorld)]));
      });
    }) : [];
    writeRecords(baseWeights);
    const constraints: DonorRayConstraint[] = [], seen = new Set<string>();
    const add = (caseIndex: number, vertices: number[], origin: Vector3, direction: Vector3, length: number, target = false) => {
      const cornersOf = (face: number[]) => face.map(vertex => ({ group: groupOf.get(vertex) ?? -1,
        base: bases[caseIndex]![clothIndex]![vertex]!,
        delta: endpoints[caseIndex]![clothIndex]![vertex]!.clone().sub(bases[caseIndex]![clothIndex]![vertex]!),
        ...boneFit && groupOf.has(vertex) ? { basis: basis.map(slot => slot[caseIndex]!.get(vertex)!) } : {} }));
      const corners = cornersOf(vertices);
      if (corners.every(corner => corner.group < 0)) return;
      const key = [origin, direction, ...corners.flatMap(corner => [corner.base, corner.delta, ...corner.basis ?? []])]
        .flatMap(vector => vector.toArray()).map(value => value.toFixed(7)).join();
      if (seen.has(key)) return;
      const neighbours = (face: number[]) => face.some(vertex => vertices.includes(vertex)
        || pairedShell && vertices.some(other =>
          rest[clothIndex]![vertex]!.distanceToSquared(rest[clothIndex]![other]!) < .010 ** 2));
      const sourceFaces = surfaceFit ? clothFaces.filter(neighbours) : [];
      if (pairedShell && target) {
        const adjacent = new Set(sourceFaces.flat());
        for (const face of clothFaces) if (face.some(vertex => adjacent.has(vertex)) && !sourceFaces.includes(face))
          sourceFaces.push(face);
      }
      const alternativeFaces = sourceFaces.filter(face => face.join() !== vertices.join());
      const alternatives = surfaceFit ? alternativeFaces.map(cornersOf) : undefined;
      seen.add(key); constraints.push({ origin, direction, length, corners, target, alternatives, sourceVertices: vertices,
        ...pairedShell && target ? { alternativeSourceVertices: alternativeFaces } : {} });
    };
    for (const [caseIndex, sample] of samples.entries()) {
      poseSample(sample);
      for (const [index, covered] of baseline[caseIndex]!.cameraCovered.entries()) if (covered) {
        const vertices = coverageFaces[Math.floor(index / coverageCoordinates.length)]!;
        const coordinates = coverageCoordinates[index % coverageCoordinates.length]!;
        const origin = vertices.reduce((sum, vertex, corner) => sum.addScaledVector(
          baseline[caseIndex]!.points[bodyIndex]![vertex]!, coordinates[corner]!), new Vector3());
        const side = Math.sign(vertices.reduce((sum, vertex) => sum + rest[bodyIndex]![vertex]!.x, 0));
        const direction = new Vector3(side * .7, .2, .8).applyAxisAngle(new Vector3(0, 1, 0), .8)
          .add(hips.getWorldPosition(new Vector3())).sub(origin);
        const length = direction.length(); direction.normalize();
        const face = traceSample(baseline[caseIndex]!.points, index, true)[0]!;
        add(caseIndex, face.vertices, origin.addScaledVector(direction, .00015), direction, length);
      }
    }
    const strikeCase = samples.findIndex(sample => sample.attack === .7 && sample.engage === 1 && sample.manualControl);
    poseSample(samples[strikeCase]!); posed = capture();
    const targets = mapViews();
    for (const view of targets) for (const row of view.rays.slice(0, view.view === "left" ? 5 : 3)) {
      const sourceView = rows.find(originalView => originalView.view === view.view)!;
      const sourceRay = sourceView.rays.find(originalRay => originalRay.pixel.join() === row.pixel.join())!;
      const camera = new PerspectiveCamera(30, 900 / 800, .01, 100);
      camera.position.fromArray(view.camera); camera.lookAt(hipPosition.x, hipPosition.y - .07, hipPosition.z); camera.updateMatrixWorld(true);
      raycaster.setFromCamera(new Vector2(row.pixel[0]! / 900 * 2 - 1, 1 - row.pixel[1]! / 800 * 2), camera);
      const direction = raycaster.ray.direction.clone().negate();
      const origin = raycaster.ray.at(sourceRay.hits[0]!.distance, new Vector3()).addScaledVector(direction, .00015);
      const positiveRow = positiveTargets.find(positiveView => positiveView.view === view.view)!.rays
        .find(positiveRay => positiveRay.pixel.join() === row.pixel.join())!;
      const face = (boneFit ? positiveRow : row).hits.find(hit => hit.primitive === 1)!;
      add(strikeCase, face.vertices, origin, direction, .2, true);
    }
    if (process.argv.includes("--correspondence-audit")) {
      const report = constraints.filter(constraint => constraint.target).map(constraint => ({
        alternatives: constraint.alternatives?.length ?? 0, sourceVertices: constraint.sourceVertices,
        alternativeSourceVertices: constraint.alternativeSourceVertices }));
      writeFileSync(resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/paired-shell-correspondence-audit.json"),
        JSON.stringify({ pairedShell, report }, null, 2));
      console.log(JSON.stringify({ pairedShell, report }));
      process.exit(0);
    }
    if (boneFit) {
      if (process.argv.includes("--constraint-audit")) {
        assert(approvedSpineSeed, "Audit the exact latest frozen support family");
        const previous = JSON.parse(readFileSync(resolve(
          "../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/visible-source-map-dense-bone-fit-source-hull-surface-restored-paired-shell-approved-spine-seed.json"), "utf8"));
        assert.equal(previous.controls[0].fit.weldedGroups, keys.size);
        assert.equal(previous.controls[0].fit.constraints, constraints.length);
        const { gradient: _gradient, ...audit } = evaluateSourceClothBoneRays(previous.controls[0].fit.weights, constraints);
        writeFileSync(resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/approved-spine-constraint-audit.json"),
          JSON.stringify({ constraints: constraints.length, originalSourceUnchanged: true, newFit: false, ...audit }, null, 2));
        console.log(JSON.stringify(audit));
        process.exit(0);
      }
      const groupSeeds = Array.from({ length: keys.size }, (_, group) => baseWeights.find(record => groupOf.get(record.vertex) === group)!);
      const hulls = groupSeeds.map((record, group) => {
        const sourceValues = record.values, vertex = record.vertex;
        const baseError = Math.max(...samples.map((_, caseIndex) =>
          bases[caseIndex]![clothIndex]![vertex]!.distanceTo(baseline[caseIndex]!.points[clothIndex]![vertex]!)));
        const approved = approvedRecords.get(vertex);
        return [sourceValues, ...sourceClothWeightVertices(sourceValues, .35), ...sourceClothWeightVertices(sourceValues, 2),
          ...approved ? [approved.values] : []]
          .map(values => {
            const maximumDelta = Math.max(...samples.map((_, caseIndex) => {
              const point = basis.reduce((sum, slot, at) => sum.addScaledVector(slot[caseIndex]!.get(vertex)!, values[at]!), new Vector3());
              return point.distanceTo(bases[caseIndex]![clothIndex]![vertex]!);
            }));
            let cap = continueSurface || restoredMask ? .0649 : .063;
            if (restoredMask && [137, 151].some(vertex => groupOf.get(vertex) === group)) cap = .0599;
            const amount = Math.min(1, Math.max(0, cap - baseError) / Math.max(.000001, maximumDelta));
            return values.map((value, slot) => sourceValues[slot]! + amount * (value - sourceValues[slot]!));
          });
      });
      if (process.argv.includes("--dump-constraints") || process.argv.includes("--dump-motion-constraints")) {
        assert(approvedSpineSeed, "Dump the exact latest frozen support family");
        const motionDump = process.argv.includes("--dump-motion-constraints");
        const file = motionDump ? "/tmp/viking-hard-contact-input.json" : "/tmp/viking-approved-spine-constraints.json";
        writeFileSync(file, JSON.stringify({ sourceSha256: approvedProfile.inputHash,
          groupSeeds, groupOf: [...groupOf], hulls, constraints,
          ...motionDump ? { motion: included.flatMap(record => samples.map((_, caseIndex) => ({
            vertex: record.vertex, group: groupOf.get(record.vertex)!, caseIndex,
            maximumMotion: [137, 151].includes(record.vertex) ? .060 : .065,
            original: baseline[caseIndex]!.points[clothIndex]![record.vertex]!,
            basis: basis.map(slot => slot[caseIndex]!.get(record.vertex)!),
          }))) } : {},
          vertices: included.map(record => ({ vertex: record.vertex, rest: rest[clothIndex]![record.vertex]!,
            maximumMotion: [137, 151].includes(record.vertex) ? .060 : .065 })),
          samples, originalSourceUnchanged: true, newFit: false }));
        console.log(JSON.stringify({ file, groups: keys.size, constraints: constraints.length }));
        process.exit(0);
      }
      let seed = groupSeeds.flatMap(record => record.values);
      if (continueSurface) {
        const previous = JSON.parse(readFileSync(resolve(
          "../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/visible-source-map-dense-bone-fit-source-hull-surface.json"), "utf8"));
        assert.equal(previous.controls[0].fit.weldedGroups, keys.size);
        seed = previous.controls[0].fit.weights;
        assert.equal(seed.length, keys.size * 4);
      }
      if (restoredMask) {
        const previous = JSON.parse(readFileSync(resolve(
          `../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/visible-source-map-dense-bone-fit-source-hull-surface-${pairedShell ? "restored" : "continued"}.json`), "utf8"));
        const previousKeys = new Map<string, number>();
        for (const donor of included.filter(donor => pairedShell || ![137, 151].includes(donor.vertex))) {
          const key = groupKey(donor.vertex);
          if (!previousKeys.has(key)) previousKeys.set(key, previousKeys.size);
        }
        assert.equal(previousKeys.size, previous.controls[0].fit.weldedGroups);
        seed = groupSeeds.flatMap(record => {
          const approved = approvedRecords.get(record.vertex);
          if (approved) return approved.values;
          const previousIndex = previousKeys.get(groupKey(record.vertex));
          if (previousIndex === undefined) return record.values;
          return previous.controls[0].fit.weights.slice(previousIndex * 4, previousIndex * 4 + 4);
        });
      }
      fit = { constraints: constraints.length, weldedGroups: keys.size,
        ...fitSourceClothBoneRays(hulls, seed, constraints) };
      const fittedRecords = baseWeights.map(record => ({ ...record,
        values: fit!.weights.slice(groupOf.get(record.vertex)! * 4, groupOf.get(record.vertex)! * 4 + 4) }));
      writeRecords(fittedRecords);
      if (restoredMask) {
        const sourceProfile = fittedRecords.map(record => ({ vertices: [record.vertex], joints: record.joints,
          jointNames: record.joints.map(joint => cloth.skeleton.bones[joint]!.name), weights: record.values }));
        applyLoadedSourceClothProfile(cloth, sourceProfile, new Set(included.map(donor => donor.vertex)), new Set());
        fit = { ...fit, sourceProfile };
      }
    } else {
      fit = { constraints: constraints.length, weldedGroups: keys.size, ...fitSourceClothDonorRays(keys.size, constraints) };
      writeRecords(targetWeights.map((record, index) => ({ ...record,
        values: record.values.map((value, slot) => baseWeights[index]!.values[slot]! * (1 - fit!.weights[groupOf.get(record.vertex)!]!) +
          value * fit!.weights[groupOf.get(record.vertex)!]!) })));
    }
  }
  const pinRounds = [];
  if (conservative) for (let round = 0; round < 12; round++) {
    const pinned = new Set<number>(), active = new Set(included.map(donor => donor.vertex));
    let lost = 0;
    for (const [caseIndex, sample] of samples.entries()) {
      const points = poseSample(sample), visible = cameraCoverage(points), before = baseline[caseIndex]!;
      for (const [index, value] of visible.entries()) if (!value && before.cameraCovered[index]) {
        lost++;
        const face = traceSample(before.points, index, true)[0];
        for (const vertex of face?.vertices ?? []) if (active.has(vertex)) pinned.add(vertex);
      }
    }
    pinRounds.push({ round, lostVisibleSamples: lost, pinnedVertices: [...pinned] });
    if (!lost || !pinned.size) break;
    for (const vertex of pinned) {
      cloth.geometry.getAttribute("skinIndex").setXYZW(vertex, ...[0, 1, 2, 3].map(slot =>
        originalIndices.getComponent(vertex, slot)) as [number, number, number, number]);
      cloth.geometry.getAttribute("skinWeight").setXYZW(vertex, ...[0, 1, 2, 3].map(slot =>
        originalWeights.getComponent(vertex, slot)) as [number, number, number, number]);
    }
    included = included.filter(donor => !pinned.has(donor.vertex));
  }
  const guards = samples.map((sample, caseIndex) => {
    const points = poseSample(sample), covered = coverage(points), cameraCovered = cameraCoverage(points), before = baseline[caseIndex]!;
    return { ...sample, examined: covered.length,
      maximumPoseShift: Math.max(...included.map(donor =>
        points[clothIndex]![donor.vertex]!.distanceTo(before.points[clothIndex]![donor.vertex]!))),
      ...restoredMask ? { maximumRestoredPointShift: Math.max(...[137, 151].map(vertex =>
        points[clothIndex]![vertex]!.distanceTo(before.points[clothIndex]![vertex]!))) } : {},
      beforeCovered: before.covered.filter(Boolean).length, afterCovered: covered.filter(Boolean).length,
      beforeCameraCovered: before.cameraCovered.filter(Boolean).length, afterCameraCovered: cameraCovered.filter(Boolean).length,
      newCameraExposures: cameraCovered.filter((value, index) => !value && before.cameraCovered[index]).length,
      cameraLostSamples: cameraCovered.flatMap((value, index) => !value && before.cameraCovered[index] ? [index] : []),
      newExposures: covered.filter((value, index) => !value && before.covered[index]).length,
      lostSamples: covered.flatMap((value, index) => !value && before.covered[index] ? [{ index,
        bodyVertices: coverageFaces[Math.floor(index / coverageCoordinates.length)],
        ...threshold === .085 && amount === .775 ? { original: traceSample(before.points, index), candidate: traceSample(points, index) } : {} }] : []) };
  });
  poseSample(samples.find(sample => sample.attack === .7 && sample.engage === 1)!);
  posed = capture();
  controls.push({ threshold, amount, pinBoundary, pinRounds, fit, changedVertices: included.length,
    guards, maximumPoseShift: Math.max(...guards.map(guard => guard.maximumPoseShift)),
    maximumStrikeShift: Math.max(...included.map(donor => posed[clothIndex]![donor.vertex]!.distanceTo(old[clothIndex]![donor.vertex]!))),
    rows: mapViews().map(view => ({ view: view.view, rays: view.rays.map(ray => ({ pixel: ray.pixel, first: ray.hits[0]?.primitive })) })) });
}
writeFileSync(resolve(`../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/visible-source-map${dense ? "-dense" : ""}${conservative ? "-conservative" : ""}${connectedFit ? "-fit" : ""}${boneFit ? "-bone-fit" : ""}${sourceHull ? "-source-hull" : ""}${surfaceFit ? "-surface" : ""}${continueSurface ? "-continued" : ""}${restoredMask ? "-restored" : ""}${pairedShell ? "-paired-shell" : ""}${approvedSpineSeed ? "-approved-spine-seed" : ""}.json`),
  JSON.stringify({ scope: "Original rider only; armour omitted, so grey armour pixels are not diagnoses", rows,
    inMemoryOnlyDonorControl: { publicationAllowed: false, donors, maximumStrikeShift, rows: donorRows }, controls }, null, 2));
for (const view of rows) for (const row of view.rays) console.log(JSON.stringify({ view: view.view, pixel: row.pixel,
  hits: row.hits.map(hit => ({ primitive: hit.primitive, face: hit.face, vertices: hit.vertices, distance: hit.distance })) }));
console.log(JSON.stringify({ control: "Bilateral source-body donor, memory only", changedVertices: donors.length, maximumStrikeShift,
  pixels: donorRows.flatMap(view => view.rays.map(row => ({ view: view.view, pixel: row.pixel,
    first: row.hits[0]?.primitive, firstFace: row.hits[0]?.face,
    beforeFirst: rows.find(beforeView => beforeView.view === view.view)!.rays.find(beforeRow =>
      beforeRow.pixel.join() === row.pixel.join())!.hits[0]?.primitive }))) }));
console.log(JSON.stringify({ controls }));
