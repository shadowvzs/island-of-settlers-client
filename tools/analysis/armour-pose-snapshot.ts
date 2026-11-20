import type { Object3D, SkinnedMesh } from "three";

export interface ArmourPoseSnapshot {
  schema: number;
  posedMeshes: { name: string; skeleton: number; matrixWorld: number[];
    bindMatrix: number[]; bindMatrixInverse: number[] }[];
  skeletons: { bones: { name: string; matrixWorld: number[] }[]; inverses: number[][] }[];
}

/** Reproduce the exact equipped native frame on a separately loaded, matching rig.
 * Do not update local/world transforms afterward: the captured matrices are authoritative. */
export const applyArmourPoseSnapshot = (root: Object3D, snapshot: ArmourPoseSnapshot) => {
  if (snapshot.schema !== 1) throw new Error("Unsupported armour native pose snapshot");
  const meshes: SkinnedMesh[] = [];
  for (const captured of snapshot.posedMeshes) {
    const mesh = root.getObjectByName(captured.name) as SkinnedMesh | undefined;
    if (!mesh?.isSkinnedMesh) throw new Error(`Captured skinned mesh is missing: ${captured.name}`);
    const skeleton = snapshot.skeletons[captured.skeleton];
    if (!skeleton || skeleton.bones.length !== mesh.skeleton.bones.length)
      throw new Error("Captured native rig joint count differs from the loaded asset");
    skeleton.bones.forEach((bone, joint) => {
      const target = mesh.skeleton.bones[joint]!;
      if (target.name !== bone.name) throw new Error(`Captured native joint order changed at ${bone.name}`);
      const inverse = skeleton.inverses[joint]!;
      if (mesh.skeleton.boneInverses[joint]!.elements.some((value, element) =>
        Math.abs(value - inverse[element]!) > .000001 * Math.max(1, Math.abs(value))))
        throw new Error(`Captured inverse bind differs from loaded rig at ${bone.name}`);
      target.matrixWorld.fromArray(bone.matrixWorld);
      mesh.skeleton.boneInverses[joint]!.fromArray(inverse);
    });
    mesh.matrixWorld.fromArray(captured.matrixWorld);
    mesh.bindMatrix.fromArray(captured.bindMatrix);
    mesh.bindMatrixInverse.fromArray(captured.bindMatrixInverse);
    mesh.skeleton.update();
    meshes.push(mesh);
  }
  return meshes;
};
