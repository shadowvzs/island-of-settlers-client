import { type Object3D, Quaternion, Vector3 } from "three";

import { hasDualTomahawks, rangedWeaponStyle } from "../../render-common/workers/military-weapon-style";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { setEquipmentFaction } from "./military-equipment";
import { STRING_Z } from "./military-equipment-bows";
import { chineseSwordTravelPose } from "./worker-chinese-sword-grip";
import { javelinHeld, javelinPose } from "./worker-javelin-pose";
import { isManualAxeGuard } from "./worker-manual-axe-guard";
import { meleePose } from "./worker-melee-moves";
import type { MeleePose } from "./worker-melee-tracks";
import { alignTwoHandedGrip, orientMeleeWeapon } from "./worker-melee-weapon";

/**
 * On the march a sword hangs low and forward from the swinging hand; a long two-handed weapon is
 * carried sloped up past the shoulder (hanging down it would drag its head over the ground).
 */
const marchingCarry = (pitch: number, yaw: number): MeleePose => ({ bend: 0, leftHand: [0, 0, 0], pitch,
  rightHand: [0, 0, 0], shield: true, sweep: false, twist: 0, yaw });
const MARCHING_SWORD = marchingCarry(2.75, 0), MARCHING_POLEARM = marchingCarry(.3, -.2);
const isMarching = (frame: WorkerFrame) =>
  frame.combat?.attackProgress === null && (frame.action === "walk" || frame.action === "run");

/** Military equipment keeps the canonical grip and handles its own national release/reload pose. */
export const createWorkerMilitaryPlacement = (root: Object3D, joints: Map<string, Object3D>,
  attachToHand: (prop: Object3D, side: "L" | "R", worldCurrent?: boolean) => void) => {
  const handPosition = new Vector3(), restingString = new Vector3(0, 0, STRING_Z);
  const parentRotation = new Quaternion(), rootRotation = new Quaternion(), bowTilt = new Quaternion();
  const across = new Vector3(1, 0, 0);
  return (prop: Object3D, frame: WorkerFrame, id: string, worldCurrent = false) => {
    if (!frame.combat) return;
    const dual = hasDualTomahawks(frame.nation, frame.combat.type);
    const ranged = rangedWeaponStyle(frame.nation, frame.combat.bandit);
    attachToHand(prop, id === "bow" && ranged !== "javelin" ? "L" : "R", worldCurrent);
    setEquipmentFaction(prop, frame.combat.faction);
    if (id === "bow") {
      if (ranged === "javelin") {
        prop.visible = javelinHeld(frame.combat.attackProgress);
        orientMeleeWeapon(prop, root, javelinPose(frame.combat.attackProgress), false, worldCurrent);
        return;
      }
      prop.quaternion.identity();
      if (ranged === "crossbow") {
        prop.userData.updateCrossbow?.(frame.combat.attackProgress);
        return;
      }
      // Riding sources expose raw Mixamo hand bones, without the oriented standing palm alias.
      const rawHand = joints.get("LeftHand");
      if (!joints.has("socket_hand_L") && !joints.has("hand_L") && rawHand && prop.parent === rawHand) {
        prop.quaternion.copy(rawHand.getWorldQuaternion(parentRotation).invert())
          .multiply(root.getWorldQuaternion(rootRotation))
          .multiply(bowTilt.setFromAxisAngle(across, -(frame.combat.manualBowPitch ?? 0)));
      }
      const hand = joints.get("socket_hand_R") ?? joints.get("hand_R") ?? joints.get("RightHand");
      if (hand && prop.userData.updateBowString) {
        if (!worldCurrent) root.updateMatrixWorld(true);
        const contact = prop.worldToLocal(hand.getWorldPosition(handPosition));
        const drawing = frame.combat.attackProgress !== null && frame.combat.attackProgress < .75;
        prop.userData.updateBowString(drawing ? contact : restingString, drawing);
      }
    }
    let melee = id === "bow" ? null : meleePose(frame);
    if (!melee) return;
    const twoHanded = id === "axe" && !dual;
    const anatomical = twoHanded && isManualAxeGuard(frame);
    // A parry's blade faces outward regardless of the preceding attack's sweeping variation.
    if (anatomical) melee = { ...melee, sweep: false };
    const axeLeft = anatomical ? root.getObjectByName("socket_axe_L") : undefined;
    const axeRight = anatomical ? root.getObjectByName("socket_axe_R") : undefined;
    // Standing props stay under worker.root; its callback writes parent-space coordinates each frame.
    if (axeRight && prop.parent) prop.position.copy(prop.parent.worldToLocal(axeRight.getWorldPosition(handPosition)));
    const chineseHeavy = twoHanded && frame.nation === "chinese";
    if (isMarching(frame) && !chineseHeavy && !isManualAxeGuard(frame))
      return orientMeleeWeapon(prop, root, twoHanded ? MARCHING_POLEARM : MARCHING_SWORD, false, worldCurrent);
    if (isMarching(frame) && chineseHeavy) melee = chineseSwordTravelPose(melee);
    const left = axeLeft ?? joints.get("socket_hand_L") ?? joints.get("LeftHand");
    const right = axeRight ?? joints.get("socket_hand_R") ?? joints.get("RightHand");
    orientMeleeWeapon(prop, root,
      twoHanded && left && right ? alignTwoHandedGrip(melee, root, left, right, worldCurrent) : melee,
      anatomical, worldCurrent);
  };
};
