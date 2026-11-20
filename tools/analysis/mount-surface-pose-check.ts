import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, type Object3D, type SkinnedMesh, Triangle, Vector3 } from "three";

import { createWorkerCombatPose } from "../../src/renderers/three/worker-combat-pose";
import { mountedWeaponPose } from "../../src/renderers/three/worker-mounted-equipment";
import { readCpuGltf } from "../assets/read-cpu-gltf";

interface Surface { points: Vector3[]; triangles: [Vector3, Vector3, Vector3][] }
const surfaceOf = (root: Object3D): Surface => {
  const points: Vector3[] = [], triangles: Surface["triangles"] = [];
  root.updateMatrixWorld(true);
  root.traverse(object => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const count = mesh.geometry.getAttribute("position").count, vertices: Vector3[] = [];
    for (let index = 0; index < count; index++) vertices.push(mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld));
    points.push(...vertices);
    const indices = mesh.geometry.index!;
    for (let index = 0; index < indices.count; index += 3)
      triangles.push([vertices[indices.getX(index)]!, vertices[indices.getX(index + 1)]!, vertices[indices.getX(index + 2)]!]);
  });
  return { points, triangles };
};
const distanceCheck = (reference: Surface, points: Vector3[]) => {
  const size = .05, grid = new Map<string, number[]>(), min = new Vector3(), max = new Vector3();
  const cell = (value: number) => Math.floor(value / size);
  for (const [index, face] of reference.triangles.entries()) {
    min.copy(face[0]).min(face[1]).min(face[2]); max.copy(face[0]).max(face[1]).max(face[2]);
    for (let x = cell(min.x); x <= cell(max.x); x++) for (let y = cell(min.y); y <= cell(max.y); y++)
      for (let z = cell(min.z); z <= cell(max.z); z++) {
        const key = `${x}:${y}:${z}`, bin = grid.get(key) ?? []; bin.push(index); grid.set(key, bin);
      }
  }
  const triangle = new Triangle(), closest = new Vector3();
  let maximum = 0;
  for (const point of points) {
    let nearest = Infinity;
    for (let x = cell(point.x) - 1; x <= cell(point.x) + 1; x++)
      for (let y = cell(point.y) - 1; y <= cell(point.y) + 1; y++)
        for (let z = cell(point.z) - 1; z <= cell(point.z) + 1; z++)
          for (const index of grid.get(`${x}:${y}:${z}`) ?? []) {
            triangle.set(...reference.triangles[index]!); triangle.closestPointToPoint(point, closest);
            nearest = Math.min(nearest, point.distanceToSquared(closest));
          }
    maximum = Math.max(maximum, Math.sqrt(nearest));
  }
  return maximum;
};
const reports = [];
for (const [nation, body] of [["nubian", "nubian-man-kilt"], ["viking", "viking-woman-blue"]]) {
  const folder = resolve(`../island-of-settlers-worker-generation/game_ready/mounts/riders/${body}`);
  const source = await readCpuGltf(resolve(folder, "model.glb"));
  const candidate = await readCpuGltf(resolve(`../resources/project-reviews/commander-possession-2026-11-03/rider-surface-d/${nation}-rider-minimal.glb`));
  const { animations } = await readCpuGltf(resolve(folder, "actions.glb"));
  const entries = [source, candidate].map(gltf => ({ root: gltf.scene, mixer: new AnimationMixer(gltf.scene),
    pose: createWorkerCombatPose(gltf.scene, animations, nation === "viking"),
    standing: gltf.scene.getObjectByName("Hips")!.position.y }));
  const cases = [{ clip: "idle", time: .4, attack: null, guard: true },
    ...[0, .4, .7, .9].map(attack => ({ clip: "idle", time: .4, attack, guard: false })),
    ...[.13, .41, .73].map(time => ({ clip: "gallop", time, attack: null, guard: false }))];
  for (const sample of cases) {
    const surfaces = entries.map(entry => {
      entry.pose.reset(); entry.mixer.stopAllAction();
      entry.mixer.clipAction(animations.find(clip => clip.name === sample.clip)!).play(); entry.mixer.setTime(sample.time);
      const frame = { actorId: 1, commander: true, commanderLoadout: nation === "viking" ? "axe" : "bow", manualControl: true,
        manualBowPitch: nation === "nubian" ? 0 : undefined, manualGuard: sample.guard, guard: sample.guard ? 1 : 0,
        attackProgress: sample.attack, nation, rider: body, x: 0, y: 0, z: 0, coat: "bay", heading: 0, turnRate: 0,
        clip: sample.clip, clipTime: sample.time };
      const pose = mountedWeaponPose(frame as never, entry.standing - entry.root.getObjectByName("Hips")!.position.y);
      entry.pose.apply({ nation, combat: { type: nation === "viking" ? "heavy" : "archer", attackProgress: sample.attack,
        faction: 0, manualBowPitch: frame.manualBowPitch } } as never, pose);
      return surfaceOf(entry.root);
    });
    const sourceToCandidate = distanceCheck(surfaces[1]!, surfaces[0]!.points);
    const candidateToSource = distanceCheck(surfaces[0]!, surfaces[1]!.triangles.map(face =>
      new Vector3().copy(face[0]).add(face[1]).add(face[2]).multiplyScalar(1 / 3)));
    const report = { nation, ...sample, sourceToCandidate, candidateToSource };
    console.log(JSON.stringify(report)); reports.push(report);
    assert(sourceToCandidate < .008 && candidateToSource < .008,
      "All original vertices and candidate triangle centres stay within8mm of the opposite posed surface");
  }
}
writeFileSync(resolve("../resources/project-reviews/commander-possession-2026-11-03/rider-surface-d/pose-report.json"), JSON.stringify(reports, null, 2));
