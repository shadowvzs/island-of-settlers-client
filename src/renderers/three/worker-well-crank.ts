import { type Object3D,Quaternion, Vector3 } from "three";

import { sampleWellWorkCycle, wellCrankHandTarget, wellRopeHandTargets, type WellWorkFrame } from "../../render-common/buildings/well-work-cycle";
import { createTwoBoneArmApplicator } from "./worker-two-bone-arm";

/** Original arm pose, layered over the existing worker's idle breathing and stable standing legs. */
export const createWorkerWellCrank = (root: Object3D) => {
  const joints = new Map<string, Object3D>();
  root.traverse(object => joints.set(object.name.replace(/[^a-z]/gi, ""), object));
  const bone = (name: string) => [...joints.entries()].find(([key]) => key.endsWith(name))?.[1];
  const arms = ["Left", "Right"].map(side => ({
    side, upper: bone(`${side}Arm`), lower: bone(`${side}ForeArm`), hand: bone(`${side}Hand`),
    socket: root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`)
  }));
  const target = new Vector3();
  const applyArm = createTwoBoneArmApplicator(root);
  const parentWorld = new Quaternion(), handEnd = new Vector3();
  const pole = new Vector3(), socketOffset = new Vector3();
  const upperPose = new Quaternion(), lowerPose = new Quaternion();
  const spine = bone("Spine"), spinePose = new Quaternion();
  const leanAxis = new Vector3(), spineWorld = new Quaternion(), leanDelta = new Quaternion();
  let leaned = false;
  const reset = () => { if (leaned && spine) spine.quaternion.copy(spinePose); leaned = false; };
  const apply = (frame: WellWorkFrame | undefined) => {
    if (!frame) return;
    const { phase } = sampleWellWorkCycle(frame.elapsed);
    const manual = frame.style === "hand-rope";
    if (manual && spine?.parent) {
      spinePose.copy(spine.quaternion); leaned = true;
      leanAxis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(parentWorld));
      spine.getWorldQuaternion(spineWorld); leanDelta.setFromAxisAngle(leanAxis, .25);
      spine.quaternion.copy(spine.parent.getWorldQuaternion(parentWorld).invert()
        .multiply(leanDelta.multiply(spineWorld)));
      root.updateMatrixWorld(true);
    }
    const gripWeight = !manual && phase >= 2 && phase < 12
      ? Math.max(0, 1 - (phase - 2) / .3, (phase - 11.7) / .3) : 1;
    if (gripWeight === 0) return;
    const ropeGrips = manual ? wellRopeHandTargets(frame) : undefined;
    const crankGrip = manual ? undefined : wellCrankHandTarget(frame);
    for (let index = 0; index < arms.length; index++) {
      const { hand, lower, side, socket, upper } = arms[index]!;
      if (!manual && side === "Left") continue;
      const grip = ropeGrips?.[index] ?? crankGrip!;
      if (!upper?.parent || !lower?.parent || !hand) continue;
      upperPose.copy(upper.quaternion); lowerPose.copy(lower.quaternion);
      // The grip socket rotates with the wrist: refine its offset after each arm solution.
      for (let pass = 0; pass < 3; pass++) {
        root.updateMatrixWorld(true);
        target.fromArray(grip);
        if (socket) {
          socketOffset.copy(socket.getWorldPosition(socketOffset)).sub(hand.getWorldPosition(handEnd));
          target.sub(socketOffset);
        }
        pole.set(side === "Left" ? -0.5 : 0.5, -0.8, -0.3)
          .applyQuaternion(root.getWorldQuaternion(parentWorld));
        applyArm(upper, lower, hand, target, pole);
        root.updateMatrixWorld(true);
      }
      upper.quaternion.slerp(upperPose, 1 - gripWeight);
      lower.quaternion.slerp(lowerPose, 1 - gripWeight);
    }
  };
  return Object.assign(apply, { reset });
};
