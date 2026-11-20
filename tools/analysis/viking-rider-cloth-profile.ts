import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Box3, Matrix3, PerspectiveCamera, Ray, Raycaster, type SkinnedMesh, Triangle, Vector2, Vector3 } from "three";

import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createWorkerCombatPose } from "../../src/renderers/three/worker-combat-pose";
import { mountedWeaponPose } from "../../src/renderers/three/worker-mounted-equipment";
import { readCpuGltf } from "../assets/read-cpu-gltf";
import { type ClothHalfspace, solveConnectedClothHalfspaces } from "./source-cloth-connected-halfspace";
import { closestClothRayTriangle, solveConnectedClothRays } from "./source-cloth-ray-triangle";
import { sourceClothWeightVertices } from "./source-cloth-weight-polytope";

type Weights = { joints: number[]; values: number[] };
const halfLineSeparation = (points: readonly Vector3[], origin: Vector3, direction: Vector3) => {
  let separation: { margin: number; normal: number[]; limit: number } | undefined;
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++)
    for (let c = b + 1; c < points.length; c++) {
      const normal = new Vector3().crossVectors(points[b]!.clone().sub(points[a]!), points[c]!.clone().sub(points[a]!));
      if (normal.length() < 1e-10) continue;
      normal.normalize();
      for (const sign of [1, -1]) {
        const n = normal.clone().multiplyScalar(sign), limit = n.dot(points[a]!);
        if (!points.every(point => n.dot(point) <= limit + 1e-9) || n.dot(direction) < -1e-9) continue;
        const margin = n.dot(origin) - limit;
        if (margin > 1e-9 && margin > (separation?.margin ?? 0)) separation = { margin, normal: n.toArray(), limit };
      }
    }
  return separation;
};
const folder = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue");
const input = resolve(folder, "model.glb"), inputHash = createHash("sha256").update(readFileSync(input)).digest("hex");
const source = await readCpuGltf(input), { animations } = await readCpuGltf(resolve(folder, "actions.glb"));
const root = source.scene, meshes: SkinnedMesh[] = [];
root.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
const body = meshes.find(mesh => source.parser.associations.get(mesh)?.primitives === 0)!;
const cloth = meshes.find(mesh => source.parser.associations.get(mesh)?.primitives === 1)!;
assert(body && cloth);
const originalJoints = cloth.geometry.getAttribute("skinIndex").clone();
const fullDonor = process.argv.includes("--full-donor");
const targeted = process.argv.includes("--targeted");
const bodyBinding = process.argv.includes("--body-binding");
const spineDonor = process.argv.includes("--spine-donor");
const coverDonor = process.argv.includes("--cover-donor");
const exactRays = process.argv.includes("--exact-rays");
const diagnosticStage = process.argv.includes("--diagnostic-stage");
const approvedWaist60mm = process.argv.includes("--approved-waist-60mm");
const poseLimitArgument = process.argv.find(argument => argument.startsWith("--diagnostic-pose-limit="));
const poseLimit = poseLimitArgument ? Number(poseLimitArgument.split("=")[1]) : .02;
const solverLimit = process.argv.includes("--converge") ? 6000 : 800;
const quantizedMargin = process.argv.includes("--quantized-margin");
assert(poseLimit >= .02 && poseLimit <= .2, "Diagnostic limit is explicit, bounded and never changes the20mm publish gate");
if (approvedWaist60mm) {
  assert.equal(inputHash, "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907");
  assert(targeted && spineDonor && exactRays && quantizedMargin && poseLimit <= .06,
    "The approved60mm exception applies only to this original six-point Spine-donor patch");
}
const weightsOf = (mesh: SkinnedMesh, vertex: number): Weights => ({
  joints: [0, 1, 2, 3].map(slot => mesh.geometry.getAttribute("skinIndex").getComponent(vertex, slot)),
  values: [0, 1, 2, 3].map(slot => mesh.geometry.getAttribute("skinWeight").getComponent(vertex, slot))
});
const original = Array.from({ length: originalJoints.count }, (_, vertex) => weightsOf(cloth, vertex));
root.updateMatrixWorld(true);
const pointsOf = (mesh: SkinnedMesh) => Array.from({ length: mesh.geometry.getAttribute("position").count },
  (_, vertex) => mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld));
const restBody = pointsOf(body), restCloth = pointsOf(cloth);
const clothNormalMatrix = new Matrix3().getNormalMatrix(cloth.matrixWorld);
const bodyNormalMatrix = new Matrix3().getNormalMatrix(body.matrixWorld);
const clothNormals = Array.from({ length: originalJoints.count }, (_, vertex) =>
  new Vector3().fromBufferAttribute(cloth.geometry.getAttribute("normal"), vertex).applyMatrix3(clothNormalMatrix).normalize());
const bodyNormals = Array.from({ length: restBody.length }, (_, vertex) =>
  new Vector3().fromBufferAttribute(body.geometry.getAttribute("normal"), vertex).applyMatrix3(bodyNormalMatrix).normalize());
const hips = root.getObjectByName("Hips")!, standing = hips.position.y;
const hipY = hips.getWorldPosition(new Vector3()).y;
const names = body.skeleton.bones.map(bone => bone.name);
const isProtectedLeg = (vertex: number) => {
  const weights = weightsOf(body, vertex);
  let leg = 0, lower = 0;
  for (const [slot, joint] of weights.joints.entries()) {
    const weight = weights.values[slot]!;
    if (names[joint]!.startsWith("Cloth") && weight > 0) return false;
    if (/^(Left|Right)UpLeg$/.test(names[joint]!)) leg += weight;
    if (/^(Hips|Spine\d*|(Left|Right)UpLeg)$/.test(names[joint]!)) lower += weight;
  }
  return leg >= .5 && lower > .999 && restBody[vertex]!.y < hipY;
};
const bodyIndices = body.geometry.index!;
const donorFaces = Array.from({ length: bodyIndices.count / 3 }, (_, face) =>
  [0, 1, 2].map(offset => bodyIndices.getX(face * 3 + offset))).filter(vertices => vertices.every(isProtectedLeg));
const triangle = new Triangle(), nearest = new Vector3(), barycentric = new Vector3();
const donors = original.map((weights, vertex) => {
  const point = restCloth[vertex]!;
  if (point.y >= hipY || point.y < hipY - .28) return undefined;
  const lowerShare = weights.joints.reduce((sum, joint, slot) => sum +
    (/^(Hips|Spine\d*|(Left|Right)UpLeg|ClothFront|ClothBack)$/.test(names[joint]!) ? weights.values[slot]! : 0), 0);
  if (!coverDonor && lowerShare < .99) return undefined;
  let distance = .035, donor: Weights | undefined;
  for (const vertices of donorFaces) {
    triangle.set(restBody[vertices[0]!]!, restBody[vertices[1]!]!, restBody[vertices[2]!]!);
    triangle.closestPointToPoint(point, nearest);
    const gap = point.distanceTo(nearest);
    if (gap >= distance || gap < .001) continue;
    if (coverDonor) {
      const normal = vertices.reduce((sum, index) => sum.add(bodyNormals[index]!), new Vector3()).normalize();
      if (normal.dot(clothNormals[vertex]!) < .25 || point.clone().sub(nearest).dot(normal) < .001) continue;
    }
    const map = new Map<number, number>();
    triangle.getBarycoord(nearest, barycentric);
    for (const [corner, index] of vertices.entries()) {
      const skin = weightsOf(body, index), share = barycentric.getComponent(corner);
      for (const [slot, joint] of skin.joints.entries()) map.set(joint,
        (map.get(joint) ?? 0) + share * skin.values[slot]!);
    }
    const sorted = [...map].sort((a, b) => b[1] - a[1]).slice(0, 4), total = sorted.reduce((sum, row) => sum + row[1], 0);
    while (sorted.length < 4) sorted.push([0, 0]);
    donor = { joints: sorted.map(row => row[0]), values: sorted.map(row => row[1] / total) };
    distance = gap;
  }
  return donor;
});
const horse = await readCpuGltf(resolve(folder, "../../horse/model.glb"));
horse.scene.getObjectByName("Saddle")!.add(root); horse.scene.scale.setScalar(WORKER_SCALE); horse.scene.position.y = .005;
const mixer = new AnimationMixer(root), horseMixer = new AnimationMixer(horse.scene);
const pose = createWorkerCombatPose(root, animations, true);
const samples = [
  { clip: "idle", time: .4, attack: null, guard: false },
  { clip: "idle", time: .4, attack: null, guard: true },
  ...[0, .4, .7, .9].map(attack => ({ clip: "idle", time: .4, attack, guard: false })),
  ...["walk", "trot", "gallop"].flatMap(clip => [.13, .41, .73].map(time => ({ clip, time, attack: null, guard: false })))
];
const cases = samples.flatMap(sample => [{ ...sample, engage: 0 }, { ...sample, engage: 1 }]);
const strikeIndex = cases.findIndex(sample => sample.attack === .7 && sample.engage === 0);
const poseCase = (sample: typeof cases[number]) => {
  pose.reset(); mixer.stopAllAction(); horseMixer.stopAllAction();
  mixer.clipAction(animations.find(clip => clip.name === sample.clip)!).play(); mixer.setTime(sample.time);
  horseMixer.clipAction(horse.animations.find(clip => clip.name === sample.clip)!).play(); horseMixer.setTime(sample.time);
  const frame = { actorId: 1, commander: true, commanderLoadout: "axe", manualControl: true,
    manualGuard: sample.guard, guard: Number(sample.guard), attackProgress: sample.attack, nation: "viking",
    rider: "viking-woman-blue", x: 0, y: 0, z: 0, coat: "bay", heading: 0, turnRate: 0,
    clip: sample.clip, clipTime: sample.time, engage: sample.engage };
  const override = mountedWeaponPose(frame as never, standing - hips.position.y);
  pose.apply({ nation: "viking", combat: { type: "heavy", attackProgress: sample.attack, faction: 0 } } as never, override);
  horse.scene.updateMatrixWorld(true);
};
const captureCloth = () => cases.map(sample => { poseCase(sample); return pointsOf(cloth); });
const before = captureCloth();
const merge = (first: Weights, second: Weights, amount: number): Weights => {
  const merged = new Map<number, number>();
  for (const [sourceWeights, factor] of [[first, 1 - amount], [second, amount]] as const)
    for (const [slot, joint] of sourceWeights.joints.entries())
      merged.set(joint, (merged.get(joint) ?? 0) + sourceWeights.values[slot]! * factor);
  const sorted = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4), total = sorted.reduce((sum, row) => sum + row[1], 0);
  while (sorted.length < 4) sorted.push([0, 0]);
  return { joints: sorted.map(row => row[0]), values: sorted.map(row => row[1] / total) };
};
const write = (vertex: number, weights: Weights) => {
  cloth.geometry.getAttribute("skinIndex").setXYZW(vertex, ...weights.joints as [number, number, number, number]);
  cloth.geometry.getAttribute("skinWeight").setXYZW(vertex, ...weights.values as [number, number, number, number]);
};
for (const [vertex, donor] of donors.entries()) if (donor) write(vertex, donor);
const fullyMatched = captureCloth();
let records = donors.flatMap((donor, vertex) => {
  if (!donor) return [];
  const maximumDonorShift = Math.max(...before.map((points, index) => points[vertex]!.distanceTo(fullyMatched[index]![vertex]!)));
  const amount = fullDonor ? 1 : Math.min(1, .0195 / Math.max(.0195, maximumDonorShift));
  const weights = merge(original[vertex]!, donor, amount);
  write(vertex, weights);
  return [{ vertex, maximumDonorShift, amount, original: original[vertex], ...weights }];
});
let fit: ReturnType<typeof solveConnectedClothHalfspaces> | ReturnType<typeof solveConnectedClothRays> | undefined;
const hullProofs: unknown[] = [];
if (targeted) {
  original.forEach((weights, vertex) => write(vertex, weights));
  const ids = [151, 137, 152, 167, 168, 169];
  const groups = ids.map(vertex => {
    const originalSeed = original[vertex]!, seed = { joints: [...originalSeed.joints], values: [...originalSeed.values] };
    const key = restCloth[vertex]!.toArray().map(value => value.toFixed(6)).join();
    const aliases = original.flatMap((weights, index) =>
      restCloth[index]!.toArray().map(value => value.toFixed(6)).join() === key &&
      JSON.stringify(weights) === JSON.stringify(originalSeed) ? [index] : []);
    if (bodyBinding) {
      const empty = seed.values.findIndex(weight => weight === 0);
      if (empty >= 0) seed.joints[empty] = names.indexOf("Spine1");
    }
    if (spineDonor) {
      const palette = ["Hips", "ClothFront", "LeftUpLeg", "Spine"].map(name => names.indexOf(name));
      const values = palette.map(joint => originalSeed.joints.reduce((sum, candidate, slot) =>
        sum + (candidate === joint ? originalSeed.values[slot]! : 0), 0));
      values[0]! += 1 - values.reduce((sum, value) => sum + value, 0);
      seed.joints = palette; seed.values = values;
    }
    return { vertex, aliases, seed };
  });
  const basis = cases.map(sample => {
    poseCase(sample);
    return groups.map(group => {
      const positions = [0, 1, 2, 3].map(slot => {
        write(group.vertex, { joints: group.seed.joints, values: [0, 1, 2, 3].map(at => Number(at === slot)) });
        return cloth.getVertexPosition(group.vertex, new Vector3()).applyMatrix4(cloth.matrixWorld);
      });
      write(group.vertex, group.seed);
      return positions;
    });
  });
  const corners = groups.map((group, gi) => [group.seed.values, ...sourceClothWeightVertices(group.seed.values, .35),
    ...(bodyBinding ? sourceClothWeightVertices(group.seed.values, 2) : [])]
    .map(corner => {
      const maximum = Math.max(...basis.map((positions, ci) => {
        const point = positions[gi]!.reduce((sum, value, slot) => sum.addScaledVector(value, corner[slot]!), new Vector3());
        return point.distanceTo(before[ci]![group.vertex]!);
      }));
      const limit = poseLimit * .975;
      const shrink = Math.min(1, limit / Math.max(limit, maximum));
      return corner.map((value, slot) => group.seed.values[slot]! + shrink * (value - group.seed.values[slot]!));
    }));
  poseCase(cases[strikeIndex]!);
  const bodyPoints = pointsOf(body), indices = cloth.geometry.index!, raycaster = new Raycaster();
  const camera = new PerspectiveCamera(30, 900 / 800, .01, 100);
  camera.position.set(2.5, 1.9, 4); camera.lookAt(0, .95, 0); camera.updateMatrixWorld(true);
  const rows: ClothHalfspace[] = [];
  const rays: { origin: Vector3; direction: Vector3; vertices: number[] }[] = [];
  for (const [pixel, face, bodyFace] of [[[440, 402], 161, 6908], [[447, 410], 184, 6904],
    ...exactRays ? [[[430, 411], 160, 6931] as const] : []] as const) {
    raycaster.setFromCamera(new Vector2(pixel[0] / 900 * 2 - 1, 1 - pixel[1] / 800 * 2), camera);
    const vertices = [0, 1, 2].map(at => indices.getX(face * 3 + at));
    const target = raycaster.ray.intersectTriangle(...[0, 1, 2].map(at =>
      bodyPoints[bodyIndices.getX(bodyFace * 3 + at)]!) as [Vector3, Vector3, Vector3], false, new Vector3())!;
    const sourcePoint = raycaster.ray.intersectTriangle(...vertices.map(vertex => before[strikeIndex]![vertex]!) as
      [Vector3, Vector3, Vector3], false, new Vector3())!;
    const bary = new Triangle(...vertices.map(vertex => before[strikeIndex]![vertex]!) as [Vector3, Vector3, Vector3])
      .getBarycoord(sourcePoint, new Vector3());
    assert(bary, "Original covering triangle is nondegenerate");
    const outward = raycaster.ray.direction.clone().negate(), coefficients = groups.flatMap(() => [0, 0, 0, 0]);
    rays.push({ origin: target.clone().addScaledVector(outward, .00015), direction: outward, vertices });
    const possible = vertices.flatMap(vertex => {
      const gi = groups.findIndex(group => group.aliases.includes(vertex));
      return gi < 0 ? [before[strikeIndex]![vertex]!] : basis[strikeIndex]![gi]!;
    });
    const origin = target.clone().addScaledVector(outward, .00015);
    const separation = halfLineSeparation(possible, origin, outward);
    const safeJointNames = ["Hips", "Spine", "Spine1", "Spine2", "LeftUpLeg", "RightUpLeg", "ClothFront", "ClothBack"];
    const safePossible = vertices.flatMap(vertex => {
      const positions = safeJointNames.map(name => {
        write(vertex, { joints: [names.indexOf(name), 0, 0, 0], values: [1, 0, 0, 0] });
        return cloth.getVertexPosition(vertex, new Vector3()).applyMatrix4(cloth.matrixWorld);
      });
      write(vertex, original[vertex]!);
      return positions;
    });
    hullProofs.push({ pixel, face, bodyFace, origin: origin.toArray(), direction: outward.toArray(),
      possible: possible.map(point => point.toArray()), separation, safeJointNames,
      safePossible: safePossible.map(point => point.toArray()), safeSeparation: halfLineSeparation(safePossible, origin, outward) });
    let constant = 0;
    for (const [corner, vertex] of vertices.entries()) {
      const gi = groups.findIndex(group => group.aliases.includes(vertex)), share = bary.getComponent(corner);
      if (gi < 0) constant += share * before[strikeIndex]![vertex]!.dot(outward);
      else for (let slot = 0; slot < 4; slot++) coefficients[gi * 4 + slot]! += share * basis[strikeIndex]![gi]![slot]!.dot(outward);
    }
    rows.push({ coefficients, target: target.dot(outward) + .00015 - constant });
  }
  const seed = groups.flatMap(group => group.seed.values);
  if (exactRays) fit = solveConnectedClothRays(corners, seed, weights => {
    const gradient = seed.map(() => 0);
    let objective = 0, maximum = 0;
    for (const ray of rays) {
      const points = ray.vertices.map(vertex => {
        const gi = groups.findIndex(group => group.aliases.includes(vertex));
        if (gi < 0) return before[strikeIndex]![vertex]!;
        return basis[strikeIndex]![gi]!.reduce((sum, point, slot) => sum.addScaledVector(point, weights[gi * 4 + slot]!), new Vector3());
      });
      const result = closestClothRayTriangle(ray.origin, ray.direction, .04, points, quantizedMargin ? .01 : .0001);
      objective += result.distanceSquared; maximum = Math.max(maximum, result.distanceSquared);
      for (const [corner, vertex] of ray.vertices.entries()) {
        const gi = groups.findIndex(group => group.aliases.includes(vertex));
        if (gi < 0) continue;
        for (let slot = 0; slot < 4; slot++) gradient[gi * 4 + slot]! +=
          2 * result.bary[corner]! * result.residual.dot(basis[strikeIndex]![gi]![slot]!);
      }
    }
    return { gradient, maximumDistance: Math.sqrt(maximum), objective };
  }, solverLimit);
  else fit = solveConnectedClothHalfspaces(corners, seed, rows);
  records = groups.flatMap((group, gi) => group.aliases.map(vertex => {
    const weights = { joints: group.seed.joints, values: fit!.weights.slice(gi * 4, gi * 4 + 4) };
    write(vertex, weights);
    return { vertex, maximumDonorShift: 0, amount: 0, original: original[vertex], ...weights };
  }));
}
let after = captureCloth();
if (!targeted && !fullDonor) for (let round = 0; round < 8; round++) {
  const over = records.filter(record => Math.max(...after.map((points, index) =>
    points[record.vertex]!.distanceTo(before[index]![record.vertex]!))) > .0195);
  if (!over.length) break;
  for (const record of over) {
    const maximum = Math.max(...after.map((points, index) => points[record.vertex]!.distanceTo(before[index]![record.vertex]!)));
    record.amount *= .0192 / maximum;
    const weights = merge(original[record.vertex]!, donors[record.vertex]!, record.amount);
    Object.assign(record, weights); write(record.vertex, weights);
  }
  after = captureCloth();
}
const maximumPoseShift = Math.max(...after.flatMap((points, index) => points.map((point, vertex) => point.distanceTo(before[index]![vertex]!))));
const camera = new PerspectiveCamera(30, 900 / 800, .01, 100);
camera.position.set(2.5, 1.9, 4); camera.lookAt(0, .95, 0); camera.updateMatrixWorld(true);
const raycaster = new Raycaster(), point = new Vector3();
const savedRays = [[440, 402], [447, 410], [430, 411]].map(([x, y]) => {
  poseCase(cases[strikeIndex]!);
  raycaster.setFromCamera(new Vector2(x! / 900 * 2 - 1, 1 - y! / 800 * 2), camera);
  const hits: { mesh: string; face: number; distance: number }[] = [];
  for (const mesh of meshes) {
    const points = pointsOf(mesh), indices = mesh.geometry.index!;
    for (let face = 0; face < indices.count / 3; face++) {
      const ids = [0, 1, 2].map(offset => indices.getX(face * 3 + offset));
      if (raycaster.ray.intersectTriangle(points[ids[0]!]!, points[ids[1]!]!, points[ids[2]!]!, false, point))
        hits.push({ mesh: mesh.name, face, distance: point.distanceTo(raycaster.ray.origin) });
    }
  }
  return { pixel: [x, y], hits: hits.sort((a, b) => a.distance - b.distance).slice(0, 3) };
});
const affected = new Set(records.map(record => record.vertex)), clothIndices = cloth.geometry.index!;
const allClothFaces = Array.from({ length: clothIndices.count / 3 }, (_, face) =>
  [0, 1, 2].map(at => clothIndices.getX(face * 3 + at)));
const changedFaces = allClothFaces.filter(vertices => vertices.some(vertex => affected.has(vertex)));
const coverageGuards = cases.map((sample, ci) => {
  poseCase(sample);
  const bodyPoints = pointsOf(body), ray = new Ray(), hit = new Vector3();
  const boxes = changedFaces.flatMap(vertices => [before[ci]!, after[ci]!].map(points =>
    new Box3().setFromPoints(vertices.map(vertex => points[vertex]!)).expandByScalar(.05)));
  const covered = (points: Vector3[]) => allClothFaces.some(vertices => {
    const found = ray.intersectTriangle(points[vertices[0]!]!, points[vertices[1]!]!, points[vertices[2]!]!, false, hit);
    return found && hit.distanceTo(ray.origin) <= .05;
  });
  let examined = 0, beforeCovered = 0, afterCovered = 0;
  const lostFaces: number[][] = [];
  for (const vertices of donorFaces) {
    const centroid = vertices.reduce((sum, vertex) => sum.add(bodyPoints[vertex]!), new Vector3()).multiplyScalar(1 / 3);
    if (!boxes.some(box => box.containsPoint(centroid))) continue;
    const restNormal = new Triangle(...vertices.map(vertex => restBody[vertex]!) as [Vector3, Vector3, Vector3]).getNormal(new Vector3());
    const average = vertices.reduce((sum, vertex) => sum.add(bodyNormals[vertex]!), new Vector3());
    const normal = new Triangle(...vertices.map(vertex => bodyPoints[vertex]!) as [Vector3, Vector3, Vector3]).getNormal(new Vector3());
    if (restNormal.dot(average) < 0) normal.negate();
    ray.set(centroid.clone().addScaledVector(normal, .00015), normal);
    const first = covered(before[ci]!), second = covered(after[ci]!);
    examined++; beforeCovered += Number(first); afterCovered += Number(second);
    if (first && !second) lostFaces.push(vertices);
  }
  return { ...sample, examined, beforeCovered, afterCovered, newExposures: lostFaces.length, lostFaces };
});
let label = "a";
if (fullDonor) label = "full-donor-control";
if (targeted) label = "targeted";
if (bodyBinding) label = "body-binding";
if (spineDonor) label = "spine-donor";
if (coverDonor) label = fullDonor ? "cover-full-control" : "cover-donor";
const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6);
if (run) { assert(/^[a-z0-9-]+$/.test(run)); label = run; }
const output = resolve(`../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-${label}`);
mkdirSync(output, { recursive: true });
const publicationPoseLimit = approvedWaist60mm ? .06 : .02;
if (approvedWaist60mm) assert.deepEqual([...affected].sort((a, b) => a - b),
  [137, 151, 152, 167, 168, 169, 780, 783, 791, 1548, 1556]);
const cpuPassed = maximumPoseShift <= publicationPoseLimit && savedRays.every(ray => ray.hits[0]?.mesh === cloth.name) &&
  coverageGuards.every(guard => guard.newExposures === 0);
const report = { source: input, inputHash, candidate: "cloth-only original-body binding",
  records: records.map(record => ({ ...record, jointNames: record.joints.map(joint => names[joint]),
    maximumPoseShift: Math.max(...after.map((points, index) => points[record.vertex]!.distanceTo(before[index]![record.vertex]!))) })), cases,
  maximumPoseShift, diagnosticPoseLimit: poseLimit, publicationPoseLimit,
  approvedWaist60mm, savedRays, fit, hullProofs,
  coverageGuards, cpuPassed, nativeAccepted: false, originalUnchanged: true };
writeFileSync(resolve(output, "profile.json"), JSON.stringify(report, null, 2));
if (cpuPassed || diagnosticStage) {
  const io = await createRetargetIO(), document = await io.read(input);
  const metadata = async (document: Awaited<ReturnType<typeof io.read>>) => ({
    nodes: (await io.writeJSON(document)).json.nodes,
    skins: document.getRoot().listSkins().map(skin => ({ joints: skin.listJoints().map(node => node.getName()),
      inverseBinds: Array.from(skin.getInverseBindMatrices()!.getArray()!) })),
    images: document.getRoot().listTextures().map(texture => ({ name: texture.getName(), mime: texture.getMimeType(),
      sha256: createHash("sha256").update(texture.getImage()!).digest("hex") })),
    materials: (await io.writeJSON(document)).json.materials
  });
  const originalMetadata = await metadata(document);
  const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const streams = primitives.map(primitive => ({ indices: Array.from(primitive.getIndices()!.getArray()!),
    attributes: primitive.listSemantics().map(name => ({ name, values: Array.from(primitive.getAttribute(name)!.getArray()!) })) }));
  for (const record of records) {
    primitives[1]!.getAttribute("JOINTS_0")!.setElement(record.vertex, record.joints);
    primitives[1]!.getAttribute("WEIGHTS_0")!.setElement(record.vertex, record.values);
  }
  const expectedSkin = ["JOINTS_0", "WEIGHTS_0"].map(name => ({ name,
    values: Array.from(primitives[1]!.getAttribute(name)!.getArray()!) }));
  const destination = resolve(output, "model.glb");
  assert(!existsSync(destination), "Never overwrite an immutable staged review model");
  await io.write(destination, document);
  const written = await io.read(destination);
  assert.deepEqual(await metadata(written), originalMetadata);
  written.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).forEach((primitive, index) => {
    assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), streams[index]!.indices);
    for (const stream of streams[index]!.attributes) {
      if (index === 1 && ["JOINTS_0", "WEIGHTS_0"].includes(stream.name)) {
        const attribute = primitive.getAttribute(stream.name)!, size = attribute.getElementSize(), values = attribute.getArray()!;
        for (let vertex = 0; vertex < attribute.getCount(); vertex++) if (!affected.has(vertex))
          assert.deepEqual(Array.from(values.slice(vertex * size, (vertex + 1) * size)),
            stream.values.slice(vertex * size, (vertex + 1) * size));
        assert.deepEqual(Array.from(values), expectedSkin.find(skin => skin.name === stream.name)!.values);
        continue;
      }
      assert.deepEqual(Array.from(primitive.getAttribute(stream.name)!.getArray()!), stream.values);
    }
  });
  writeFileSync(resolve(output, "provenance.json"), JSON.stringify({ source: input, sourceSha256: inputHash,
    destination, candidateSha256: createHash("sha256").update(readFileSync(destination)).digest("hex"),
    originalBodyPrimitiveExact: true, allRestNormalUvTopologyExact: true, allRigMaterialsTexturesExact: true,
    modifiedSkinPrimitive: 1, modifiedClothVertices: records.map(record => record.vertex),
    cpuPassed, publicationAllowed: false, nativeAccepted: false, reviewOnly: true,
    publicationPoseLimit, approvedWaist60mm,
    limitation: "Private review stage only; the explicit six-point60mm exception does not establish native acceptance or permit any body/geometry/rig/texture change" }, null, 2));
}
assert.equal(createHash("sha256").update(readFileSync(input)).digest("hex"), inputHash);
console.log(JSON.stringify({ records: records.length, maximumPoseShift, savedRays,
  maximumNewExposures: Math.max(...coverageGuards.map(guard => guard.newExposures)), cpuPassed }));
