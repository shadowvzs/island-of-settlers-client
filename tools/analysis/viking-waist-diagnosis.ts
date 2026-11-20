import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, PerspectiveCamera, Quaternion, Raycaster, type SkinnedMesh, Vector2, Vector3 } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createWorkerCombatPose } from "../../src/renderers/three/worker-combat-pose";
import { mountedWeaponPose } from "../../src/renderers/three/worker-mounted-equipment";
import { readCpuGltf } from "../assets/read-cpu-gltf";

const folder = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue");
const source = await readCpuGltf(resolve(folder, "model.glb"));
const { animations } = await readCpuGltf(resolve(folder, "actions.glb"));
const root = source.scene, mixer = new AnimationMixer(root);
const pose = createWorkerCombatPose(root, animations, true);
const hips = root.getObjectByName("Hips")!, standing = hips.position.y;
const meshes: SkinnedMesh[] = [];
root.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
const snapshot = () => {
  root.updateMatrixWorld(true);
  return meshes.map(mesh => Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, index) =>
    mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld)));
};
const bones = () => ["Hips", "Spine", "ClothFront", "ClothBack"].map(name => {
  const bone = root.getObjectByName(name)!;
  return { name, position: bone.getWorldPosition(new Vector3()).toArray(),
    quaternion: bone.getWorldQuaternion(new Quaternion()).toArray() };
});
const rest = snapshot(), restBones = bones();
const weightsOf = (mesh: SkinnedMesh, index: number) => {
  const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
  return [0, 1, 2, 3].flatMap(slot => {
    const weight = weights.getComponent(index, slot);
    return weight > .00001 ? [{ bone: mesh.skeleton.bones[joints.getComponent(index, slot)]!.name, weight }] : [];
  });
};
const sample = (attack: number | null, ignoreCloth = false) => {
  pose.reset(); mixer.stopAllAction();
  mixer.clipAction(animations.find(clip => clip.name === "idle")!).play(); mixer.setTime(.4);
  const before = snapshot(), beforeBones = bones();
  const frame = { actorId: 1, commander: true, commanderLoadout: "axe", manualControl: true,
    manualGuard: false, guard: 0, attackProgress: attack, nation: "viking", rider: "viking-woman-blue",
    x: 0, y: 0, z: 0, coat: "bay", heading: 0, turnRate: 0, clip: "idle", clipTime: .4 };
  const override = mountedWeaponPose(frame as never, standing - hips.position.y);
  const cloth = ["ClothFront", "ClothBack"].map(name => root.getObjectByName(name)!);
  const clothWorld = cloth.map(bone => bone.getWorldQuaternion(new Quaternion()));
  pose.apply({ nation: "viking", combat: { type: "heavy", attackProgress: attack, faction: 0 } } as never, override);
  if (ignoreCloth) for (const [index, bone] of cloth.entries()) {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(clothWorld[index]!));
  }
  const after = snapshot();
  const meshReports = meshes.map((mesh, mi) => {
    const geometry = mesh.geometry, indices = geometry.index!;
    const triangles = Array.from({ length: indices.count / 3 }, (_, face) => {
      const vertices = [0, 1, 2].map(offset => indices.getX(face * 3 + offset));
      const centroid = new Vector3();
      let longest = 0, idleLongest = 0, restLongest = 0, delta = 0;
      for (let edge = 0; edge < 3; edge++) {
        const a = vertices[edge]!, b = vertices[(edge + 1) % 3]!;
        longest = Math.max(longest, after[mi]![a]!.distanceTo(after[mi]![b]!));
        idleLongest = Math.max(idleLongest, before[mi]![a]!.distanceTo(before[mi]![b]!));
        restLongest = Math.max(restLongest, rest[mi]![a]!.distanceTo(rest[mi]![b]!));
        delta = Math.max(delta, after[mi]![a]!.distanceTo(before[mi]![a]!));
        centroid.add(after[mi]![a]!);
      }
      centroid.divideScalar(3);
      return { face, vertices, centroid: centroid.toArray(), longest, idleLongest, restLongest, delta,
        ratio: longest / Math.max(restLongest, 1e-8), idleRatio: idleLongest / Math.max(restLongest, 1e-8),
        rest: vertices.map(vertex => rest[mi]![vertex]!.toArray()),
        idle: vertices.map(vertex => before[mi]![vertex]!.toArray()),
        posed: vertices.map(vertex => after[mi]![vertex]!.toArray()),
        weights: vertices.map(vertex => weightsOf(mesh, vertex)) };
    });
    return { name: mesh.name, vertices: geometry.getAttribute("position").count, triangles: triangles.length,
      association: source.parser.associations.get(mesh),
      waist: triangles.filter(face => Math.abs(face.centroid[1]! - hips.getWorldPosition(new Vector3()).y) < .3)
        .sort((a, b) => b.delta - a.delta).slice(0, 35),
      worstStrain: [...triangles].sort((a, b) => b.ratio - a.ratio).slice(0, 15) };
  });
  return { attack, ignoreCloth, override, beforeBones, afterBones: bones(), meshes: meshReports };
};
const report = { originalFile: resolve(folder, "model.glb"), restBones,
  samples: [sample(null), sample(.7), sample(.7, true)] };
const horse = await readCpuGltf(resolve(folder, "../../horse/model.glb"));
const horseMixer = new AnimationMixer(horse.scene);
horseMixer.clipAction(horse.animations.find(clip => clip.name === "idle")!).play(); horseMixer.setTime(.4);
horse.scene.getObjectByName("Saddle")!.add(root); horse.scene.scale.setScalar(WORKER_SCALE);
horse.scene.position.y = .005;
sample(.7);
const posed = snapshot();
const camera = new PerspectiveCamera(30, 900 / 800, .01, 100);
camera.position.set(2.5, 1.9, 4); camera.lookAt(0, .95, 0); camera.updateMatrixWorld(true);
const raycaster = new Raycaster(), hitPoint = new Vector3();
const rayHits = [[443, 380], [447, 388], [440, 402], [430, 411], [447, 410], [449, 375]].map(([x, y]) => {
  raycaster.setFromCamera(new Vector2(x! / 900 * 2 - 1, 1 - y! / 800 * 2), camera);
  const hits: { mesh: string; face: number; distance: number; vertices: number[]; weights: ReturnType<typeof weightsOf>[] }[] = [];
  for (const [mi, mesh] of meshes.entries()) {
    const indices = mesh.geometry.index!;
    for (let face = 0; face < indices.count / 3; face++) {
      const vertices = [0, 1, 2].map(offset => indices.getX(face * 3 + offset));
      const point = raycaster.ray.intersectTriangle(posed[mi]![vertices[0]!]!, posed[mi]![vertices[1]!]!,
        posed[mi]![vertices[2]!]!, false, hitPoint);
      if (point) hits.push({ mesh: mesh.name, face, distance: point.distanceTo(raycaster.ray.origin), vertices,
        weights: vertices.map(vertex => weightsOf(mesh, vertex)) });
    }
  }
  return { pixel: [x, y], hits: hits.sort((a, b) => a.distance - b.distance).slice(0, 3) };
});
const output = resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-waist-diagnosis.json");
writeFileSync(output, JSON.stringify({ ...report, rayHits }, null, 2));
for (const entry of report.samples) console.log(JSON.stringify({ attack: entry.attack,
  ignoreCloth: entry.ignoreCloth, bones: entry.afterBones, meshes: entry.meshes.map(mesh => ({
    name: mesh.name, vertices: mesh.vertices, triangles: mesh.triangles, association: mesh.association,
    waist: mesh.waist.slice(0, 5), worstStrain: mesh.worstStrain.slice(0, 3) })) }));
