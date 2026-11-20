import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D, Quaternion, Vector3 } from "three";

/** Match wrist orientation to the real reachable shaft, after the ordinary arm IK has clamped. */
export const createAxeContactAlignment = (root: Object3D, sockets: readonly (Object3D | undefined)[]) => {
  const arms = ["Left", "Right"].map(side => ({ upper: root.getObjectByName(`${side}Arm`),
    lower: root.getObjectByName(`${side}ForeArm`), hand: root.getObjectByName(`${side}Hand`),
    index: root.getObjectByName(`${side}HandIndex1`), pinky: root.getObjectByName(`${side}HandPinky1`) }));
  const contacts = [new Vector3(), new Vector3()], axis = new Vector3(), across = new Vector3();
  const point = new Vector3(), end = new Vector3(), target = new Vector3(), offset = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), pole = new Vector3();
  const parent = new Quaternion(), upper = new Quaternion(), lower = new Quaternion();
  const hand = new Quaternion(), turn = new Quaternion();
  return () => {
    if (sockets.some(socket => !socket) || arms.some(arm => !arm.upper?.parent || !arm.lower?.parent ||
      !arm.hand?.parent || !arm.index || !arm.pinky)) return;
    for (let pass = 0; pass < 2; pass++) {
      root.updateMatrixWorld(true);
      sockets.forEach((socket, index) => socket!.getWorldPosition(contacts[index]!));
      axis.subVectors(contacts[1]!, contacts[0]!);
      if (axis.length() < .05) return;
      axis.normalize();
      for (const [index, arm] of arms.entries()) {
        across.copy(arm.index!.getWorldPosition(point)).sub(arm.pinky!.getWorldPosition(end)).normalize();
        hand.copy(arm.hand!.getWorldQuaternion(upper));
        hand.premultiply(turn.setFromUnitVectors(across, axis));
        arm.hand!.quaternion.copy(arm.hand!.parent!.getWorldQuaternion(parent).invert().multiply(hand));
        // Keep the already reachable actual palm contact, rather than extending the source arm.
        for (let refine = 0; refine < 4; refine++) {
          target.copy(contacts[index]!).sub(sockets[index]!.getWorldPosition(offset).sub(arm.hand!.getWorldPosition(end)));
          arm.upper!.getWorldQuaternion(upper); arm.lower!.getWorldQuaternion(lower);
          pole.set(index === 0 ? .7 : -.7, -.25, -.25).applyQuaternion(root.getWorldQuaternion(parent));
          const solution = solveTwoBone({ root: arm.upper!.getWorldPosition(shoulder),
            middle: arm.lower!.getWorldPosition(elbow), end: arm.hand!.getWorldPosition(end) }, target, pole);
          arm.upper!.quaternion.copy(arm.upper!.parent!.getWorldQuaternion(parent).invert()
            .multiply(solution.rootDelta.multiply(upper)));
          arm.lower!.quaternion.copy(arm.lower!.parent!.getWorldQuaternion(parent).invert()
            .multiply(solution.middleDelta.multiply(lower)));
          arm.hand!.quaternion.copy(arm.hand!.parent!.getWorldQuaternion(parent).invert().multiply(hand));
        }
      }
    }
  };
};
