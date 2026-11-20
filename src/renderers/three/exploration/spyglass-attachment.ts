import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { actionToolHandRotation } from "@workers/worker-action-contacts";
import { EYE_SHAPE } from "@workers/worker-eye-shape";
import {
  SPYGLASS_ACTION, SPYGLASS_HEAD_HEIGHT, SPYGLASS_TRIPO_EYE_SHIFT, spyglassGrip
} from "@workers/worker-spyglass";
import { type Object3D, Quaternion, Vector3 } from "three";

import { SPYGLASS_EYE_LENS_Y, SPYGLASS_TOOL_SCALE } from "../../../render-common/wares/spyglass-parts";

interface ArmContact {
  hand: Object3D;
  lower: Object3D;
  socket: Object3D;
  upper: Object3D;
  saved: Quaternion[];
}

const findArm = (root: Object3D, side: "L" | "R"): ArmContact | undefined => {
  const prefix = side === "L" ? "Left" : "Right";
  const upper = root.getObjectByName(`${prefix}Arm`) ?? root.getObjectByName(`upper_arm_${side}`);
  const lower = root.getObjectByName(`${prefix}ForeArm`) ?? root.getObjectByName(`forearm_${side}`);
  const hand = root.getObjectByName(`${prefix}Hand`) ?? root.getObjectByName(`hand_${side}`);
  const socket = root.getObjectByName(`socket_hand_${side}`);
  if (!upper?.parent || !lower?.parent || !hand?.parent || !socket || socket.parent !== hand) return;
  return { hand, lower, saved: [new Quaternion(), new Quaternion(), new Quaternion()], socket, upper };
};

/** Per-explorer hand contact; the tool remains a child of the animated palm in both poses. */
export const createExplorationSpyglassAttachment = (root: Object3D, tool: Object3D) => {
  const right = findArm(root, "R"), left = findArm(root, "L");
  const head = root.getObjectByName("head") ?? root.getObjectByName("Head");
  const tripo = Boolean(root.getObjectByName("Head"));
  const arms = [right, left].filter((arm): arm is ArmContact => Boolean(arm));
  const position = new Vector3(), shoulder = new Vector3(), elbow = new Vector3(), wrist = new Vector3();
  const target = new Vector3(), wristTarget = new Vector3(), offset = new Vector3(), scale = new Vector3();
  const axis = new Vector3(), eye = new Vector3(), pole = new Vector3();
  const toolRotation = new Quaternion(), handRotation = new Quaternion(), parentRotation = new Quaternion();
  const upperRotation = new Quaternion(), lowerRotation = new Quaternion(), socketRotation = new Quaternion();
  const opticalTurn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  const grip = new Vector3();
  const rightGrip = new Vector3(...spyglassGrip("R")).divideScalar(SPYGLASS_TOOL_SCALE);
  const leftGrip = new Vector3(...spyglassGrip("L")).divideScalar(SPYGLASS_TOOL_SCALE);
  const handFrames = { L: actionToolHandRotation(SPYGLASS_ACTION, "L"),
    R: actionToolHandRotation(SPYGLASS_ACTION, "R") };
  let adjusted = false;
  if (right) right.socket.add(tool);
  else { tool.removeFromParent(); tool.visible = false; }

  const reset = () => {
    if (!adjusted) return;
    for (const arm of arms) {
      [arm.upper, arm.lower, arm.hand].forEach((joint, index) => joint.quaternion.copy(arm.saved[index]!));
    }
    adjusted = false;
  };
  const save = () => {
    for (const arm of arms) {
      [arm.upper, arm.lower, arm.hand].forEach((joint, index) => arm.saved[index]!.copy(joint.quaternion));
    }
    adjusted = true;
  };
  const solveContact = (arm: ArmContact, side: "L" | "R", contact: Vector3) => {
    // The exported socket carries a rig-specific rest rotation/offset; solve the raw wrist from it.
    handRotation.copy(toolRotation).multiply(handFrames[side]);
    socketRotation.copy(arm.socket.quaternion).invert();
    handRotation.multiply(socketRotation);
    arm.hand.getWorldScale(scale);
    offset.copy(arm.socket.position).multiply(scale).applyQuaternion(handRotation);
    wristTarget.copy(contact).sub(offset);
    for (let pass = 0; pass < 3; pass++) {
      root.updateWorldMatrix(true, true);
      arm.upper.getWorldPosition(shoulder); arm.lower.getWorldPosition(elbow); arm.hand.getWorldPosition(wrist);
      arm.upper.getWorldQuaternion(upperRotation); arm.lower.getWorldQuaternion(lowerRotation);
      pole.set(side === "L" ? .5 : -.5, -.5, -.2).applyQuaternion(root.getWorldQuaternion(parentRotation));
      const solved = solveTwoBone({ end: wrist, middle: elbow, root: shoulder }, wristTarget, pole);
      arm.upper.quaternion.copy(arm.upper.parent!.getWorldQuaternion(parentRotation).invert()
        .multiply(solved.rootDelta.multiply(upperRotation)));
      root.updateWorldMatrix(true, true);
      arm.lower.quaternion.copy(arm.lower.parent!.getWorldQuaternion(parentRotation).invert()
        .multiply(solved.middleDelta.multiply(lowerRotation)));
    }
    root.updateWorldMatrix(true, true);
    arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(parentRotation).invert().multiply(handRotation));
    root.updateWorldMatrix(true, true);
  };
  const placeInRightHand = (contact: Vector3) => {
    if (!right) return;
    right.socket.getWorldQuaternion(socketRotation);
    tool.quaternion.copy(socketRotation.invert().multiply(toolRotation));
    // Transform the chosen authored grip into socket space; the palm/tool gap stays exactly zero.
    tool.position.copy(contact).multiply(tool.scale).applyQuaternion(tool.quaternion).negate();
    tool.updateMatrix();
  };
  const apply = (raised: boolean) => {
    if (!right) return false;
    root.updateWorldMatrix(true, true);
    if (!raised || !head || !left) {
      tool.quaternion.identity();
      tool.position.set(0, -.065 * tool.scale.y, 0);
      tool.updateMatrix();
      return true;
    }
    save();
    const eyeOffset = EYE_SHAPE.centerY - SPYGLASS_HEAD_HEIGHT;
    eye.set(-EYE_SHAPE.spacing, eyeOffset, EYE_SHAPE.centerZ);
    if (tripo) eye.y += SPYGLASS_TRIPO_EYE_SHIFT;
    head.localToWorld(eye);
    head.getWorldQuaternion(toolRotation); toolRotation.multiply(opticalTurn);
    root.getWorldScale(scale);
    axis.set(0, 1, 0).applyQuaternion(toolRotation);
    position.copy(eye).addScaledVector(axis, -SPYGLASS_EYE_LENS_Y * tool.scale.y * scale.y);
    grip.copy(rightGrip).multiply(tool.scale).multiply(scale).applyQuaternion(toolRotation).add(position);
    solveContact(right, "R", grip);
    placeInRightHand(rightGrip);
    // The right hand owns the telescope. The left supports its actual resulting tube, even at reach limits.
    tool.updateWorldMatrix(true, false);
    leftGrip.set(...spyglassGrip("L")).divideScalar(SPYGLASS_TOOL_SCALE);
    // A short forearm supports a nearer point of the same draw tube; never stretch the body rig.
    for (let step = 0; step <= 8; step++) {
      leftGrip.y = (-.14 - step * .01) / SPYGLASS_TOOL_SCALE;
      tool.localToWorld(target.copy(leftGrip));
      left.hand.getWorldScale(scale);
      handRotation.copy(toolRotation).multiply(handFrames.L)
        .multiply(socketRotation.copy(left.socket.quaternion).invert());
      wristTarget.copy(target).sub(offset.copy(left.socket.position).multiply(scale).applyQuaternion(handRotation));
      left.upper.getWorldPosition(shoulder); left.lower.getWorldPosition(elbow); left.hand.getWorldPosition(wrist);
      const reach = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
      if (shoulder.distanceTo(wristTarget) < reach * .995) break;
    }
    solveContact(left, "L", target);
    return true;
  };
  const reason = () => {
    if (!right) return "missing-right-hand";
    if (!left) return "missing-left-hand";
    if (!head) return "missing-head";
    return null;
  };
  return { apply, reason, reset, attached: () => Boolean(right),
    /** Diagnostic contact landmarks; no mesh, material or camera state is owned here. */
    contacts: () => ({ eye: eye.clone(), leftGrip: leftGrip.clone(), rightGrip: rightGrip.clone(),
      left: left?.socket, right: right?.socket }) };
};
