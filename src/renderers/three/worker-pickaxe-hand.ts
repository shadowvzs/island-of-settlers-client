import { type AnimationClip, type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { CARRIED_UPRIGHT_TOOLS, carriedToolAxis } from "./worker-hammer-grip";

/** Use the original tool-holding finger pose during tool transport and horse leading. */
export const createCarriedPickaxeHand = (root: Object3D, clips: readonly AnimationClip[]) => {
  const clip = clips.find(candidate => candidate.name === "build_hammer");
  const fingers = (clip?.tracks ?? []).flatMap(track => {
    if (!/^RightHand((Thumb|Index|Middle|Ring|Pinky)[123])?\.quaternion$/.test(track.name)) return [];
    const bone = root.getObjectByName(track.name.slice(0, -11));
    if (!bone) return [];
    let key = 0;
    while (key + 1 < track.times.length && track.times[key + 1]! <= .65) key++;
    return [{ bone, original: new Quaternion(), grip: new Quaternion().fromArray(track.values, key * 4) }];
  });
  const hand = root.getObjectByName("RightHand"), index = root.getObjectByName("RightHandIndex1");
  const pinky = root.getObjectByName("RightHandPinky1");
  const pinkyPoint = new Vector3(), axis = new Vector3(), up = new Vector3(), point = new Vector3();
  const world = new Quaternion(), parent = new Quaternion(), turn = new Quaternion();
  let adjusted = false;
  const reset = () => {
    if (!adjusted) return;
    for (const finger of fingers) finger.bone.quaternion.copy(finger.original);
    adjusted = false;
  };
  const apply = (frame: WorkerFrame) => {
    if ((!frame.horseLead && !CARRIED_UPRIGHT_TOOLS.includes(frame.workerTool ?? "")) || frame.carryingWare || frame.wareTransfer ||
      !["walk", "run", "idle_breathe"].includes(frame.action)) return;
    for (const finger of fingers) {
      finger.original.copy(finger.bone.quaternion); finger.bone.quaternion.copy(finger.grip);
    }
    if (hand?.parent && index && pinky) {
      root.updateMatrixWorld(true);
      axis.copy(index.getWorldPosition(point)).sub(pinky.getWorldPosition(pinkyPoint)).normalize();
      carriedToolAxis(root, frame.workerTool, up);
      turn.setFromUnitVectors(axis,up);
      hand.getWorldQuaternion(world);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(turn.multiply(world)));
      root.updateMatrixWorld(true);
    }
    adjusted = true;
  };
  return { apply, reset };
};
