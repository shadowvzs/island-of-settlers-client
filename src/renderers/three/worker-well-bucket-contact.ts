import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";
import { createGroundedKneePlacement } from "./worker-grounded-knees";
import { transferCarryWeight } from "./worker-ware-transfer";

const contactResets = new WeakMap<Object3D, () => void>();
export const resetWellBucketHandContacts = (root: Object3D) => contactResets.get(root)?.();

/** Keep the original standing feet and lean over the rim, rather than kneeling to a waist-high bucket. */
export const createWellBucketPickupLean = (root: Object3D) => {
  const plantKnees = createGroundedKneePlacement(root);
  const spine = root.getObjectByName("Spine"), hips = root.getObjectByName("Hips");
  const legs = ["Left", "Right"].map(side => ({
    upper: root.getObjectByName(`${side}UpLeg`), lower: root.getObjectByName(`${side}Leg`),
    foot: root.getObjectByName(`${side}Foot`), target: new Vector3(), orientation: new Quaternion(),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), footPose: new Quaternion()
  }));
  const axis = new Vector3(), world = new Quaternion(), parent = new Quaternion(), delta = new Quaternion();
  const original = new Quaternion(), hipsPosition = new Vector3(), position = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion();
  let adjusted = false;
  let transferKey = "", previousProgress = -1, planted = false;
  const reset = (frame?: WorkerFrame) => {
    if (frame && frame.wareTransfer?.ware !== "water") {
      transferKey = ""; previousProgress = -1; planted = false;
    }
    if (!adjusted || !spine || !hips) return;
    spine.quaternion.copy(original); hips.position.copy(hipsPosition);
    for (const leg of legs) {
      leg.upper?.quaternion.copy(leg.upperPose); leg.lower?.quaternion.copy(leg.lowerPose);
      leg.foot?.quaternion.copy(leg.footPose);
    }
    adjusted = false;
  };
  const apply = (frame: WorkerFrame) => {
    if (!spine?.parent || !hips?.parent || frame.wareTransfer?.ware !== "water") return;
    const transfer = frame.wareTransfer;
    const key = `${transfer.direction}:${transfer.target.x}:${transfer.target.z}`;
    if (key !== transferKey || transfer.progress < previousProgress) planted = false;
    transferKey = key; previousProgress = transfer.progress;
    const pickup = frame.wareTransfer.direction === "pickup";
    const progress = frame.wareTransfer.progress;
    const raisedPickup = !!frame.wareTransfer.pour || pickup && frame.workerJob === "Well worker";
    let reach: number;
    if (raisedPickup) reach = smoothstep01(progress / .3) * (1 - transferCarryWeight(frame.wareTransfer));
    else if (pickup) reach = smoothstep01(progress / .25) * (1 - smoothstep01((progress - .4) / .55));
    else reach = smoothstep01(progress / .25) * (1 - smoothstep01((progress - .85) / .15));
    const bendReach = pickup || raisedPickup ? reach :
      smoothstep01((progress - .3) / .45) * (1 - smoothstep01((progress - .85) / .15));
    // Raised (well) pickups bend less than ground pickups.
    let crouch: number, hipShift: number, spineBend: number;
    if (raisedPickup) { crouch = .09 * bendReach; hipShift = .245; spineBend = .9; }
    else { crouch = .32 * bendReach; hipShift = .15; spineBend = 1.0; }
    original.copy(spine.quaternion); hipsPosition.copy(hips.position);
    adjusted = true;
    root.updateMatrixWorld(true);
    for (const leg of legs) {
      leg.upperPose.copy(leg.upper!.quaternion); leg.lowerPose.copy(leg.lower!.quaternion);
      leg.footPose.copy(leg.foot!.quaternion);
      // Sparse standing clips can retain an incoming gait on unkeyed joints. Once settled,
      // the feet stay at their actual planted contacts throughout the whole bucket gesture.
      if (!planted || raisedPickup) {
        leg.foot!.getWorldPosition(leg.target); leg.foot!.getWorldQuaternion(leg.orientation);
      }
    }
    planted = progress >= .15;
    root.getWorldQuaternion(world);
    axis.set(0, -crouch, hipShift * bendReach).applyQuaternion(world);
    hips.getWorldPosition(position).add(axis); hips.parent.worldToLocal(position);
    hips.position.copy(position);
    root.updateMatrixWorld(true);
    axis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(world));
    spine.getWorldQuaternion(world);
    delta.setFromAxisAngle(axis, spineBend * bendReach);
    spine.quaternion.copy(spine.parent.getWorldQuaternion(parent).invert().multiply(delta.multiply(world)));
    root.updateMatrixWorld(true);
    for (const { foot, lower, orientation, target, upper } of legs) {
      if (!upper?.parent || !lower?.parent || !foot?.parent) continue;
      if (!raisedPickup) {
        plantKnees(upper, lower, foot, target);
        foot.quaternion.copy(foot.parent.getWorldQuaternion(parent).invert().multiply(orientation));
        root.updateMatrixWorld(true);
        continue;
      }
      for (let pass = 0; pass < 3; pass++) {
        upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
        pole.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(parent));
        const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
          middle: lower.getWorldPosition(elbow), end: foot.getWorldPosition(end) }, target, pole);
        upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        root.updateMatrixWorld(true);
        lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
        root.updateMatrixWorld(true);
      }
      foot.quaternion.copy(foot.parent.getWorldQuaternion(parent).invert().multiply(orientation));
      root.updateMatrixWorld(true);
    }
  };
  return { apply, reset };
};

/** Both palms follow the actual iron handle, including its scale and bucket motion. */
export const createWellBucketHandContacts = (root: Object3D) => {
  const arms = ["Left", "Right"].map(side => ({
    side,
    upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), socket: root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), adjusted: false
  }));
  contactResets.set(root, () => {
    for (const arm of arms) {
      if (!arm.adjusted) continue;
      arm.upper?.quaternion.copy(arm.upperPose); arm.lower?.quaternion.copy(arm.lowerPose);
      arm.adjusted = false;
    }
  });
  const target = new Vector3(), socketOffset = new Vector3(), shoulder = new Vector3();
  const elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion(), parent = new Quaternion();
  const originalUpper = new Quaternion(), originalLower = new Quaternion();
  return (bucket: Object3D, transfer: NonNullable<WorkerFrame["wareTransfer"]>, carryOnly = false) => {
    const carry = transferCarryWeight(transfer);
    let reach = 1;
    if (!transfer.pour) {
      reach = transfer.direction === "pickup" ? smoothstep01(transfer.progress / .3)
        : 1 - smoothstep01((transfer.progress - .8) / .15);
    }
    const weight = carryOnly ? 1 : reach;
    if (weight <= 0) return;
    for (const arm of arms) {
      const { hand, lower, lowerPose, side, socket, upper, upperPose } = arm;
      const handWeight = !carryOnly && transfer.direction === "pickup" && side === "Right"
        ? weight * (1 - carry) : weight;
      if (!upper?.parent || !lower?.parent || !hand || !socket || (carryOnly && side !== "Left")) continue;
      arm.adjusted = true;
      upperPose.copy(upper.quaternion); lowerPose.copy(lower.quaternion);
      originalUpper.copy(upperPose); originalLower.copy(lowerPose);
      for (let pass = 0; pass < 5; pass++) {
        root.updateMatrixWorld(true);
        target.set(side === "Left" ? .035 : -.035, .15, 0);
        bucket.localToWorld(target);
        socketOffset.copy(socket.getWorldPosition(socketOffset)).sub(hand.getWorldPosition(end));
        target.sub(socketOffset);
        upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
        pole.set(side === "Left" ? -.5 : .5, -.8, -.3)
          .applyQuaternion(root.getWorldQuaternion(parent));
        const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
          middle: lower.getWorldPosition(elbow), end: hand.getWorldPosition(end) }, target, pole);
        upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        root.updateMatrixWorld(true);
        lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
      }
      upper.quaternion.slerp(originalUpper, 1 - handWeight);
      lower.quaternion.slerp(originalLower, 1 - handWeight);
      root.updateMatrixWorld(true);
    }
  };
};
