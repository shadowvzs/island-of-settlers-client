import { type Object3D, Quaternion, Vector3 } from "three";

import { WINDOW_LOOK_UP } from "../../render-common/buildings/window-soldier-head-envelope";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";

const LATERAL_AXIS = new Vector3(1, 0, 0);
/** The forearms rest this far (world units) above the sill top: half a forearm's thickness. */
const FOREARM_REST = .035;
/** Folded forearms point mostly inward with a little forward reach (horizontal, unit length). */
const FOREARM_INWARD = .83, FOREARM_FORWARD = .56;

interface SillArm {
  hand: Object3D | undefined; index: Object3D | undefined; lower: Object3D | undefined; middle: Object3D | undefined;
  pinky: Object3D | undefined; upper: Object3D | undefined;
}

/**
 * Presentation-only pose of a soldier leaning out of a window: the neck turns back by part of the
 * lean so the face looks out, and both forearms are folded on the sill (elbows at sill height in
 * front of the shoulders, forearms horizontal and pointing inward), so no hand hangs below it.
 * Applied after the pose is rebuilt, only for window soldiers (`frame.lean`).
 */
export const createWorkerWindowPose = (root: Object3D) => {
  const neck = root.getObjectByName("Neck") ?? root.getObjectByName("neck");
  const neckChain: Object3D[] = [];
  for (let node = neck?.parent; node && node !== root; node = node.parent) neckChain.unshift(node);
  const arms: SillArm[] = ["Left", "Right"].map(side => ({ hand: root.getObjectByName(`${side}Hand`),
    index: root.getObjectByName(`${side}HandIndex1`), lower: root.getObjectByName(`${side}ForeArm`),
    middle: root.getObjectByName(`${side}HandMiddle1`) ?? root.getObjectByName(`${side}HandIndex1`),
    pinky: root.getObjectByName(`${side}HandPinky1`), upper: root.getObjectByName(`${side}Arm`) }));
  const parent = new Quaternion(), inverse = new Quaternion(), turn = new Quaternion();
  const from = new Vector3(), to = new Vector3(), start = new Vector3(), end = new Vector3();
  const forward = new Vector3(), lateral = new Vector3(), feet = new Vector3(), shoulder = new Vector3();
  const liftHead = (lean: number) => {
    if (!neck) return;
    parent.identity();
    for (const node of neckChain) parent.multiply(node.quaternion);
    inverse.copy(parent).invert();
    turn.setFromAxisAngle(LATERAL_AXIS, -lean * WINDOW_LOOK_UP);
    neck.quaternion.premultiply(parent).premultiply(turn).premultiply(inverse);
  };
  /** Turns `bone` (world matrices current) so the direction to `child` becomes `direction`. */
  const aim = (bone: Object3D, child: Object3D, direction: Vector3) => {
    if (!bone.parent) return;
    from.copy(child.getWorldPosition(end).sub(bone.getWorldPosition(start))).normalize();
    turn.setFromUnitVectors(from, to.copy(direction).normalize());
    bone.parent.getWorldQuaternion(parent);
    inverse.copy(parent).invert();
    bone.quaternion.premultiply(parent).premultiply(turn).premultiply(inverse);
    bone.updateMatrixWorld(true);
  };
  const axis = new Vector3(), current = new Vector3(), wanted = new Vector3();
  /**
   * Rolls the forearm about its own axis so the palm lies flat on the sill: on this rig a palm-down hand
   * pointing inward has its index knuckle toward the window and its little finger toward the body.
   */
  const flattenPalm = (lower: Object3D, hand: Object3D, index: Object3D, pinky: Object3D) => {
    if (!lower.parent) return;
    axis.copy(hand.getWorldPosition(end).sub(lower.getWorldPosition(start))).normalize();
    current.copy(index.getWorldPosition(end).sub(pinky.getWorldPosition(start)));
    current.addScaledVector(axis, -current.dot(axis));
    wanted.copy(forward).addScaledVector(axis, -forward.dot(axis));
    if (current.lengthSq() < 1e-8 || wanted.lengthSq() < 1e-8) return;
    turn.setFromUnitVectors(current.normalize(), wanted.normalize());
    lower.parent.getWorldQuaternion(parent);
    inverse.copy(parent).invert();
    lower.quaternion.premultiply(parent).premultiply(turn).premultiply(inverse);
    lower.updateMatrixWorld(true);
  };
  const foldArm = ({ hand, index, lower, middle, pinky, upper }: SillArm, elbowHeight: number) => {
    if (!hand || !lower || !upper) return;
    upper.getWorldPosition(shoulder);
    const length = lower.getWorldPosition(end).distanceTo(shoulder);
    const drop = Math.max(-length, Math.min(0, elbowHeight - shoulder.y));
    const reach = Math.sqrt(Math.max(0, length * length - drop * drop));
    aim(upper, lower, to.copy(forward).multiplyScalar(reach).setY(drop));
    // Inward is toward the body's centre line from this arm's side.
    const side = Math.sign(shoulder.sub(feet).dot(lateral)) || 1;
    aim(lower, hand, to.copy(forward).multiplyScalar(FOREARM_FORWARD).addScaledVector(lateral, -side * FOREARM_INWARD));
    if (index && pinky) flattenPalm(lower, hand, index, pinky);
    // A straight wrist lays the hand flat on the sill instead of letting the idle clip droop it.
    if (middle) aim(hand, middle, to.copy(hand.getWorldPosition(end)).sub(lower.getWorldPosition(start)));
  };
  return (frame: WorkerFrame) => {
    if (!frame.lean) return;
    liftHead(frame.lean);
    if (frame.windowSillRise === undefined) return;
    root.updateMatrixWorld(true);
    root.getWorldPosition(feet);
    forward.set(Math.sin(frame.heading), 0, Math.cos(frame.heading));
    lateral.set(forward.z, 0, -forward.x);
    for (const arm of arms) foldArm(arm, feet.y + frame.windowSillRise + FOREARM_REST);
  };
};
