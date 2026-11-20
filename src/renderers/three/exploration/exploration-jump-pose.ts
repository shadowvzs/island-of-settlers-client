import { type Object3D, Quaternion, Vector3 } from "three";

/** One temporary explorer rig only; reset before its mixer so procedural crouch never accumulates. */
export const createExplorationJumpPose = (root: Object3D) => {
  const names = ["Hips", "Spine", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"];
  const joints = names.map(name => root.getObjectByName(name));
  const rotations = joints.map(() => new Quaternion()), hip = new Vector3(), scale = new Vector3();
  let applied = false;
  return {
    reset: () => {
      if (!applied) return;
      joints.forEach((joint, index) => joint?.quaternion.copy(rotations[index]!));
      joints[0]?.position.copy(hip); applied = false;
    },
    apply: (pose: { crouch: number; tuck: number } | undefined) => {
      if (!pose) return;
      joints.forEach((joint, index) => joint && rotations[index]!.copy(joint.quaternion));
      if (joints[0]) hip.copy(joints[0].position);
      root.getWorldScale(scale);
      const bend = pose.crouch + pose.tuck * .5;
      if (joints[0]) joints[0].position.y -= pose.crouch * .045 / Math.max(.01, scale.y);
      joints[1]?.rotateX(pose.crouch * .08);
      joints[2]?.rotateX(-bend * .45); joints[3]?.rotateX(-bend * .45);
      joints[4]?.rotateX(bend * .9); joints[5]?.rotateX(bend * .9);
      applied = true;
    }
  };
};
