import { type Object3D,Quaternion, Vector3 } from "three";

// The original scythe blade lies below the side handles. During travel it points up,
// with its curved cutting edge outside the right arm rather than beside the feet.
const bladeUp = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).multiply(
  new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
);
// Travel holds the real upper snath; mowing retains both original side handles.
const rightGrip = new Vector3(.012, .16, -.08);
export const createWalkingScytheGrip = () => {
  const palm = new Vector3(), offset = new Vector3();
  return (scythe: Object3D, root: Object3D, hand: Object3D, worldCurrent = false) => {
    if (!worldCurrent) root.updateWorldMatrix(true, true);
    scythe.quaternion.copy(bladeUp);
    hand.getWorldPosition(palm);
    offset.copy(rightGrip).applyQuaternion(scythe.quaternion);
    scythe.position.copy(root.worldToLocal(palm)).sub(offset);
  };
};
