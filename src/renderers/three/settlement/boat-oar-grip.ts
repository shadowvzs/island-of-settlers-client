import { createPhysicalHandGrip } from "@workers/physical-hand-grip";
import { Matrix4, type Object3D, Quaternion, Vector3 } from "three";

import { WORKER_SCALE } from "../../../render-common/workers/worker-dimensions";
import { createBoatArmApplicator } from "../worker-boat-elbow-clearance";
import { createBoatFingerContactFit } from "./boat-finger-contact-fit";
import { measureBoatFingerPadding } from "./boat-hand-surface";

type Side = "Left" | "Right";
/** Palms over the handles, fingers underneath, with the native thumb opposing the fingers. */
export const createBoatOarGrip = (body: Object3D) => {
  const padding = measureBoatFingerPadding(body);
  const nativeArm = createBoatArmApplicator(body);
  const physicalGrip = createPhysicalHandGrip(body, padding, nativeArm.apply);
  const fitFingers = createBoatFingerContactFit(body);
  body.userData.boatFingerPadding = padding;
  const hands = { Left: body.getObjectByName("LeftHand")!, Right: body.getObjectByName("RightHand")! };
  const frames = new Map<Side, { inverse: Matrix4; palmSign: number }>();
  for (const side of ["Left", "Right"] as const) {
    const hand = hands[side], at = hand.getWorldPosition(new Vector3());
    const get = (name: string) => body.getObjectByName(side + name)!.getWorldPosition(new Vector3());
    const forward = get("HandMiddle1").sub(at).normalize();
    const across = get("HandIndex1").sub(get("HandPinky1"));
    across.addScaledVector(forward, -across.dot(forward)).normalize();
    const normal = forward.clone().cross(across);
    const thumb = get("HandThumb3"), thumbTip = thumb.clone().add(thumb.clone().sub(get("HandThumb2")).multiplyScalar(.7));
    const palmSign = Math.sign(thumbTip.sub(at).dot(normal)) || (side === "Left" ? 1 : -1);
    const inverseHand = hand.getWorldQuaternion(new Quaternion()).invert();
    frames.set(side, { inverse: new Matrix4().makeBasis(forward.applyQuaternion(inverseHand),
      across.applyQuaternion(inverseHand), normal.applyQuaternion(inverseHand)).invert(), palmSign });
  }
  const axis = new Vector3(), down = new Vector3(), forward = new Vector3();
  const parentRotation = new Quaternion(), handRotation = new Quaternion(), rotation = new Quaternion();
  const basis = new Matrix4();
  return {
    solve: (side: Side, contact: Vector3, localAxis: Vector3, parent: Object3D) => {
      const hand = hands[side], frame = frames.get(side)!;
      parent.getWorldQuaternion(parentRotation);
      // Keep the native fingers pointing away from the wrist, palm down on the handle.
      axis.copy(localAxis).negate().applyQuaternion(parentRotation).normalize();
      down.set(0, -1, 0).applyQuaternion(parentRotation);
      down.addScaledVector(axis, -down.dot(axis)).normalize();
      forward.crossVectors(axis, down).multiplyScalar(frame.palmSign).normalize();
      handRotation.setFromRotationMatrix(basis.makeBasis(forward, axis,
        forward.clone().cross(axis)).multiply(frame.inverse));
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(rotation).invert().multiply(handRotation));
      body.updateMatrixWorld(true);
      const pole = contact.clone().addScaledVector(forward, -.22).addScaledVector(down, -.04);
      // Bounded comfort correction keeps the palm above the handle throughout the stroke.
      const result = physicalGrip(side, contact, axis, .0118 / WORKER_SCALE, pole, true);
      if (!result) return undefined;
      body.userData.boatOarGrips ??= {};
      body.userData.boatOarGrips[side] = { palmNormal: result.palmNormal.toArray(), wristTwist: result.wristTwist };
      const shaftRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), localAxis).premultiply(parentRotation);
      fitFingers(side, contact, axis.clone().negate(), new Vector3(1, 0, 0).applyQuaternion(shaftRotation),
        new Vector3(0, 1, 0).applyQuaternion(shaftRotation));
      return result.gripError;
    }
  };
};
