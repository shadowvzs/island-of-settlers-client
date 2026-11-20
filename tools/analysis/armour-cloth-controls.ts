import { Matrix3, Matrix4, type Object3D, type SkinnedMesh, Vector3 } from "three";

import type { MotionClothVertex } from "../../../island-of-settlers-worker-generation/src/armour/cloth-motion-fit";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";

interface Alias { mesh: SkinnedMesh; vertex: number }
export interface ClothControlVertex extends MotionClothVertex { aliases: Alias[]; bones: string[]; localEase: Vector3 }

const visible = (node: Object3D) => {
  for (let parent: Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
};
const pointOf = (mesh: SkinnedMesh, vertex: number) => mesh.applyBoneTransform(vertex,
  new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld);

/** Weld only identical physical cloth/skin aliases, including the deliberate two-material seam. */
export const createArmourClothControls = (root: Object3D, minimal: boolean, maximumEase = 0, allowTrunkMerge = false) => {
  const vertices: ClothControlVertex[] = [], indices: number[] = [], known = new Map<string, number>();
  root.traverse(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || !visible(mesh)
      || !new RegExp(`^armour_(?:torso|underclothes)_lod${minimal ? 1 : 0}$`).test(node.name)) return;
    const joints = mesh.geometry.getAttribute("skinIndex"), skin = mesh.geometry.getAttribute("skinWeight");
    const remap: number[] = [];
    for (let vertex = 0; vertex < joints.count; vertex++) {
      const rest = pointOf(mesh, vertex), original = new Map<string, number>();
      for (let slot = 0; slot < 4; slot++) if (skin.getComponent(vertex, slot) > 1e-8)
        original.set(mesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name, skin.getComponent(vertex, slot));
      const sorted = [...original].sort(([a], [b]) => a.localeCompare(b));
      const key = `${rest.toArray().map(value => value.toFixed(7)).join(",")}/${
        sorted.map(([name, weight]) => `${name}:${weight.toFixed(7)}`).join(",")}`;
      const existing = known.get(key);
      if (existing !== undefined) { vertices[existing]!.aliases.push({ mesh, vertex }); remap.push(existing); continue; }
      const side = rest.x > 0 ? "Left" : "Right";
      const start = mesh.skeleton.bones.find(bone => bone.name === `${side}Arm`)!.getWorldPosition(new Vector3());
      const end = mesh.skeleton.bones.find(bone => bone.name === `${side}ForeArm`)!.getWorldPosition(new Vector3());
      const axis = end.clone().sub(start), fraction = rest.clone().sub(start).dot(axis) / axis.lengthSq();
      const centre = start.clone().addScaledVector(axis, fraction);
      const forbidden = sorted.reduce((sum, [name, weight]) => sum + (/Neck|Head|ForeArm|Hand/.test(name) ? weight : 0), 0);
      const movable = Math.abs(rest.x) > .035 * WORKER_SCALE && rest.y > .68 * WORKER_SCALE
        && fraction > -.4 && fraction < .75 && rest.distanceTo(centre) < .18 * WORKER_SCALE && forbidden < .15;
      // A tiny inherited neck share can fill the fourth slot beside three trunk joints,
      // leaving no actual Arm control at a coarse shoulder. Merge only redundant trunk
      // controls into Spine2; retain all neck/head/forearm/hand shares exactly.
      if (movable && allowTrunkMerge && (!original.has(`${side}Shoulder`) || !original.has(`${side}Arm`)))
        for (const name of ["Spine", "Spine1"]) {
          if (!original.has(name)) continue;
          original.set("Spine2", (original.get("Spine2") ?? 0) + original.get(name)!); original.delete(name);
        }
      if (movable) for (const name of [`${side}Shoulder`, `${side}Arm`, "Spine2", "Spine1"])
        if (original.size < 4 && !original.has(name)) original.set(name, 0);
      const bones = [...original.keys()], weights = [...original.values()];
      const fixedSlots = bones.flatMap((name, slot) => /Neck|Head|ForeArm|Hand/.test(name) ? [slot] : []);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const restBlend = new Matrix4(); restBlend.elements.fill(0);
      for (let slot = 0; slot < 4; slot++) {
        const joint = joints.getComponent(vertex, slot), weight = skin.getComponent(vertex, slot);
        const transform = new Matrix4().copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
          .multiply(mesh.skeleton.bones[joint]!.matrixWorld).multiply(mesh.skeleton.boneInverses[joint]!).multiply(mesh.bindMatrix);
        transform.elements.forEach((value, element) => { restBlend.elements[element]! += value * weight; });
      }
      const easeDirection = rest.clone().sub(centre).normalize();
      const localEase = easeDirection.clone().applyMatrix3(new Matrix3().setFromMatrix4(restBlend.clone().invert()));
      known.set(key, vertices.length); remap.push(vertices.length);
      vertices.push({ rest, movable, bones, fixedSlots, localEase, easeDirection, maximumEase: movable ? maximumEase : 0,
        weights: weights.map(weight => weight / total), aliases: [{ mesh, vertex }] });
    }
    const triangles = mesh.geometry.index!;
    for (let at = 0; at < triangles.count; at += 3) {
      const face = [0, 1, 2].map(corner => remap[triangles.getX(at + corner)]!);
      if (new Set(face).size === 3) indices.push(...face);
    }
  });
  if (!vertices.length || !vertices.some(vertex => vertex.movable)) throw new Error("Actual movable shoulder cloth is required");
  return { vertices, indices };
};

/** Exact LBS control positions from the captured native bind/bone/mesh matrices. */
export const armourClothControlPositions = (vertices: ClothControlVertex[]) => vertices.map(group => {
  const { mesh, vertex } = group.aliases[0]!;
  const bound = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex).applyMatrix4(mesh.bindMatrix);
  return group.bones.map(name => {
    const joint = mesh.skeleton.bones.findIndex(bone => bone.name === name);
    if (joint < 0) throw new Error(`Native cloth control is missing joint ${name}`);
    const matrix = new Matrix4().multiplyMatrices(mesh.skeleton.bones[joint]!.matrixWorld, mesh.skeleton.boneInverses[joint]!);
    return bound.clone().applyMatrix4(matrix).applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
  });
});

/** Exact linear skin response to the bounded outward rest-cloth displacement. */
export const armourClothEaseControls = (vertices: ClothControlVertex[]) => vertices.map(group => {
  const { mesh } = group.aliases[0]!;
  return group.bones.map(name => {
    const joint = mesh.skeleton.bones.findIndex(bone => bone.name === name);
    const matrix = new Matrix4().copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
      .multiply(mesh.skeleton.bones[joint]!.matrixWorld).multiply(mesh.skeleton.boneInverses[joint]!).multiply(mesh.bindMatrix);
    return group.localEase.clone().applyMatrix3(new Matrix3().setFromMatrix4(matrix));
  });
});
