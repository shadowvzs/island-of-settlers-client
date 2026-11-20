import { type Object3D,Quaternion, Vector3 } from "three";

/** Reusable local bone snapshots avoid snapping a travelling gait into a material gesture. */
export const createWorkerPoseTransition = (root: Object3D) => {
  const bones: { bone: Object3D; position: Vector3; rotation: Quaternion }[] = [];
  root.traverse((bone) => {
    if ((bone as Object3D & { isBone?: boolean }).isBone) bones.push({ bone, position: new Vector3(), rotation: new Quaternion() });
  });
  let captured = false;
  const capture = () => {
    for (const entry of bones) { entry.position.copy(entry.bone.position); entry.rotation.copy(entry.bone.quaternion); }
    captured = true;
  };
  /** Puts the captured pose back as it was (nothing before the first capture). */
  const restore = () => {
    if (!captured) return;
    for (const entry of bones) { entry.bone.position.copy(entry.position); entry.bone.quaternion.copy(entry.rotation); }
  };
  /** Blends the posed bones back towards the captured pose; `fraction` 0 = captured .. 1 = new. */
  const blend = (fraction: number) => {
    const p = Math.max(0, Math.min(1, fraction));
    if (p >= 1) return;
    const weight = p * p * (3 - 2 * p);
    for (const entry of bones) {
      entry.bone.position.lerp(entry.position, 1 - weight);
      entry.bone.quaternion.slerp(entry.rotation, 1 - weight);
    }
  };
  /** Transfers ease in over their first 15 %. */
  const ease = (progress: number) => blend(progress / .15);
  return { blend, capture, ease, restore };
};
