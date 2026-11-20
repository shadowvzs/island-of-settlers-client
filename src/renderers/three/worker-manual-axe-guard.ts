import { type Object3D, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createUnitEyeOffset } from "./unit-eye-offset";
import { type MeleePose, type Point3, weaponDirection } from "./worker-melee-tracks";

export const isManualAxeGuard = (frame: WorkerFrame) => frame.nation === "viking" &&
  frame.combat?.type === "heavy" && frame.combat.manualGuard && frame.combat.defending &&
  frame.combat.attackProgress === null;

/** Standing national rigs have different head heights: place the actual palms below their own eyes. */
export const createManualAxeGuard = (root: Object3D) => {
  const eyeOffset = createUnitEyeOffset(root, root), eye = new Vector3(), base = new Vector3();
  return (pose: MeleePose, travelling = false): MeleePose => {
    const offset = eyeOffset();
    if (!offset) return pose;
    root.getWorldPosition(base);
    eye.set(offset.x, offset.y, offset.z).add(base); root.worldToLocal(eye);
    const rightHand: Point3 = [travelling ? -.1 : -.03, eye.y - (travelling ? .02 : .06), eye.z + (travelling ? .29 : .4)];
    // Turn the actual long haft forward as it crosses the chest, so its head remains in view.
    const pitch = travelling ? pose.pitch : 1.65, yaw = travelling ? pose.yaw : -.78;
    const axis = weaponDirection(pitch, yaw);
    const leftHand = rightHand.map((value, index) => value + axis[index]! * (pose.leftAlong ?? -.15)) as Point3;
    return { ...pose, rightHand, leftHand, pitch, yaw };
  };
};
