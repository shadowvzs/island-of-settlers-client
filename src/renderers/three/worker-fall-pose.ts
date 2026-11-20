import { type Object3D,Quaternion, Vector3 } from "three";

import { BUCKLE } from "../../render-common/workers/worker-fall";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createWorkerCombatBody } from "./worker-combat-body";

/** Fully buckled: hips this much lower and forward, torso and head slumped (radians). */
const SLUMP = { bend: .4, drop: .2, head: .35, shift: .05 };
const STILL = { back: 0, front: 0, width: 0 };

/**
 * A fallen soldier's collapse before it tips over (worker-fall.ts): the knees give way with the
 * feet planted, the hips sink and the torso and head slump forward.
 */
export const createWorkerFallPose = (root: Object3D) => {
  const body = createWorkerCombatBody(root);
  const spine = root.getObjectByName("Spine"), neck = root.getObjectByName("Neck");
  const bend = new Quaternion(), axis = new Vector3(1, 0, 0);
  return (frame: Pick<WorkerFrame, "fall">) => {
    if (frame.fall === undefined) return;
    const t = Math.min(1, frame.fall / BUCKLE), buckle = t * t * (3 - 2 * t);
    body.apply({ drop: SLUMP.drop * buckle, hipYaw: 0, lift: 0, shift: SLUMP.shift * buckle, stance: STILL, step: 0 });
    spine?.quaternion.multiply(bend.setFromAxisAngle(axis, SLUMP.bend * buckle));
    neck?.quaternion.multiply(bend.setFromAxisAngle(axis, SLUMP.head * buckle));
  };
};
