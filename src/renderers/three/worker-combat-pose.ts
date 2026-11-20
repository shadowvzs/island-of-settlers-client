import { fitPhysicalCombatReach } from "@workers/physical-combat-reach";
import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type AnimationClip, type Object3D,Quaternion, Vector3 } from "three";

import { rangedWeaponStyle } from "../../render-common/workers/military-weapon-style";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createMountedAxeGrip } from "./mounted-axe-grip";
import { archerGuardPose, archerPose, commanderArcherPose } from "./worker-archer-pose";
import { alignChineseSwordWrist, chineseSwordTravelPose } from "./worker-chinese-sword-grip";
import { createWorkerCombatBody } from "./worker-combat-body";
import { crossbowPose } from "./worker-crossbow-pose";
import { createPreparedFootAxeGrip } from "./worker-foot-axe-grip";
import { javelinHeld, javelinPose } from "./worker-javelin-pose";
import { createManualAxeGuard, isManualAxeGuard } from "./worker-manual-axe-guard";
import { meleePose } from "./worker-melee-moves";
import { type MeleePose, type Point3, weaponDirection } from "./worker-melee-tracks";

/** A hit soldier recoils: torso back, hips back and down, easing out again (`amount` 0..1). */
const flinch = (pose: MeleePose, amount: number | undefined): MeleePose => {
  if (amount === undefined) return pose;
  const k = Math.sin(Math.PI * amount);
  const body = pose.body && { ...pose.body, drop: pose.body.drop + .02 * k, shift: pose.body.shift - .05 * k };
  return { ...pose, bend: pose.bend - .3 * k, body };
};

/** The fighting pose of a soldier on foot: its melee move, or the bow for archers and hunters. */
const footPose = (frame: WorkerFrame) => {
  if (frame.combat?.type === "archer") {
    if (frame.combat.manualBowPitch !== undefined)
      return commanderArcherPose(frame.combat.attackProgress, frame.combat.manualBowPitch,
        frame.combat.manualGuard && frame.combat.defending && frame.combat.attackProgress === null);
    if (frame.combat.manualGuard && frame.combat.defending && frame.combat.attackProgress === null)
      return archerGuardPose();
    const style = rangedWeaponStyle(frame.nation, frame.combat.bandit);
    if (style === "javelin") return javelinPose(frame.combat.attackProgress);
    if (style === "crossbow") return crossbowPose(frame.combat.attackProgress);
  }
  return meleePose(frame) ?? archerPose(frame.combat?.attackProgress ?? null);
};

/** Combat overlays the authored standing pose; travel retains distance-driven locomotion. */
export const createWorkerCombatPose = (root: Object3D, clips: readonly AnimationClip[], mountedAxeGrip = false) => {
  const anatomicalGrip = mountedAxeGrip ? createMountedAxeGrip(root) : undefined;
  let footGrip: ReturnType<typeof createPreparedFootAxeGrip>;
  const manualAxeGuard = createManualAxeGuard(root);
  const fingers = ["Left", "Right"].flatMap(side => {
    const clip = clips.find(clip => clip.name === "build_hammer");
    return (clip?.tracks ?? []).flatMap(track => {
      if (!track.name.startsWith(`${side}Hand`) || !track.name.endsWith(".quaternion")) return [];
      if (track.name === `${side}Hand.quaternion`) return [];
      const bone = root.getObjectByName(track.name.slice(0, -11));
      if (!bone) return [];
      let key = 0;
      while (key + 1 < track.times.length && track.times[key + 1]! <= .65) key++;
      return [{ bone, original: new Quaternion(), grip: new Quaternion().fromArray(track.values, key * 4) }];
    });
  });
  const ridingFingers: typeof fingers = [];
  if (!fingers.length) root.traverse(bone => {
    if (!/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(bone.name)) return;
    ridingFingers.push({ bone, grip: bone.quaternion.clone(), original: new Quaternion() });
  });
  let activeFingers = fingers;
  const gripAxis = new Vector3(), localGripAxis = new Vector3();
  const gripRotation = new Quaternion(), gripParentRotation = new Quaternion();
  const shaft = new Vector3(), across = new Vector3(), point = new Vector3(), turn = new Quaternion();
  const arms = ["Left", "Right"].map(side => ({
    indexFinger: root.getObjectByName(`${side}HandIndex1`),
    pinky: root.getObjectByName(`${side}HandPinky1`),
    socket: root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`),
    upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), savedUpper: new Quaternion(), savedLower: new Quaternion(), savedHand: new Quaternion()
  }));
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), socketOffset = new Vector3();
  const target = new Vector3(), pole = new Vector3();
  const parent = new Quaternion(), upperWorld = new Quaternion(), lowerWorld = new Quaternion();
  const desiredHand = new Quaternion(), contact = new Vector3();
  const spine = root.getObjectByName("Spine"), spinePose = new Quaternion(), torso = new Quaternion();
  const neck = root.getObjectByName("Neck"), neckPose = new Quaternion();
  const bendAxis = new Vector3(1, 0, 0), twistAxis = new Vector3(0, 1, 0), leanAxis = new Vector3(0, 0, 1);
  const body = createWorkerCombatBody(root);
  let adjusted = false;
  const reset = () => {
    if (!adjusted) return;
    for (const arm of arms) {
      arm.upper?.quaternion.copy(arm.savedUpper); arm.lower?.quaternion.copy(arm.savedLower); arm.hand?.quaternion.copy(arm.savedHand);
    }
    for (const finger of activeFingers) finger.bone.quaternion.copy(finger.original);
    spine?.quaternion.copy(spinePose);
    neck?.quaternion.copy(neckPose);
    adjusted = false;
  };
  /** `override`: an explicit melee pose (a mounted cut) instead of the frame's foot moves. */
  const apply = (frame: WorkerFrame, override?: MeleePose) => {
    if (!frame.combat || arms.some(arm => !arm.upper?.parent || !arm.lower?.parent || !arm.hand)) return;
    const footAxeGuard = !override && isManualAxeGuard(frame);
    if (footAxeGuard && !footGrip) footGrip = createPreparedFootAxeGrip(root, frame.variant);
    let axeGrip: ReturnType<typeof createMountedAxeGrip> | ReturnType<typeof createPreparedFootAxeGrip> = footAxeGuard ? footGrip : undefined;
    if (override && frame.nation === "viking" && frame.combat.type === "heavy") axeGrip = anatomicalGrip;
    activeFingers = ["archer", "heavy"].includes(frame.combat.type) && !fingers.length ? ridingFingers : fingers;
    if (axeGrip) activeFingers = axeGrip.fingers;
    const progress = frame.combat.attackProgress;
    // Marching soldiers keep the gait's arm swing; window lean-outs show only head and shoulders.
    const chineseHeavy = frame.nation === "chinese" && frame.combat.type === "heavy";
    const travelling = progress === null && (frame.action === "walk" || frame.action === "run");
    if (frame.lean || travelling && !chineseHeavy && !footAxeGuard) return;
    let melee = flinch(override ?? footPose(frame), frame.combat.flinch);
    if (root.userData.physicalHandGrip === true) melee = fitPhysicalCombatReach(root, melee,
      progress !== null && progress > .55 && progress < .9);
    if (footAxeGuard) {
      melee = manualAxeGuard(melee, travelling);
      if (travelling) melee = { ...melee, body: undefined };
    }
    if (travelling && chineseHeavy) melee = chineseSwordTravelPose(melee);
    const releasedThrow = !override && frame.combat.type === "archer" &&
      rangedWeaponStyle(frame.nation, frame.combat.bandit) === "javelin" &&
      !javelinHeld(progress);
    shaft.fromArray(weaponDirection(melee.pitch, melee.yaw));
    // Feet, hips and knees first (riders keep the saddle); the hands move with the hips.
    if (melee.body && !override) body.apply(melee.body);
    const carried = melee.body ? [0, -melee.body.drop, melee.body.shift] : [0, 0, 0];
    const positions = [melee.leftHand, melee.rightHand]
      .map(hand => hand.map((value, axis) => value + carried[axis]!) as Point3);
    // The whole torso takes part in a blow: bend into the strike, twist with the swing, lean out.
    if (spine) {
      spinePose.copy(spine.quaternion);
      spine.quaternion.multiply(torso.setFromAxisAngle(bendAxis, melee.bend))
        .multiply(torso.setFromAxisAngle(twistAxis, melee.twist))
        .multiply(torso.setFromAxisAngle(leanAxis, melee.lean ?? 0));
    }
    if (neck) {
      neckPose.copy(neck.quaternion);
      neck.quaternion.multiply(torso.setFromAxisAngle(twistAxis, melee.headYaw ?? 0));
    }
    // Sync once; world-space bone getters refresh their ancestor chain during each IK solve.
    root.updateMatrixWorld(true);
    for (let index = 0; index < arms.length; index++) {
      const arm = arms[index]!;
      arm.savedUpper.copy(arm.upper!.quaternion); arm.savedLower.copy(arm.lower!.quaternion);
      arm.savedHand.copy(arm.hand!.quaternion);
      target.fromArray(positions[index]!); root.localToWorld(target);
      const socket = axeGrip ? axeGrip.sockets[index] : arm.socket;
      if (socket) target.sub(socket.getWorldPosition(socketOffset).sub(arm.hand!.getWorldPosition(end)));
      for (let pass = 0; pass < 3; pass++) {
        arm.upper!.getWorldQuaternion(upperWorld); arm.lower!.getWorldQuaternion(lowerWorld);
        pole.fromArray(index === 1 && melee.rightElbow ? melee.rightElbow :
          [index === 0 ? .7 : -.7, -.25, -.25]).applyQuaternion(root.getWorldQuaternion(parent));
        const solution = solveTwoBone({ root: arm.upper!.getWorldPosition(shoulder),
          middle: arm.lower!.getWorldPosition(elbow), end: arm.hand!.getWorldPosition(end) }, target, pole);
        arm.upper!.quaternion.copy(arm.upper!.parent!.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        arm.lower!.quaternion.copy(arm.lower!.parent!.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
      }
    }
    for (const finger of activeFingers) {
      finger.original.copy(finger.bone.quaternion);
      if (!releasedThrow || !finger.bone.name.startsWith("RightHand"))
        finger.bone.quaternion.copy(finger.grip);
    }
    for (let index = 0; index < arms.length; index++) {
      const arm = arms[index]!;
      const indexFinger = arm.indexFinger;
      const pinky = arm.pinky;
      if (!indexFinger || !pinky || !arm.hand?.parent) continue;
      across.copy(indexFinger.getWorldPosition(point)).sub(pinky.getWorldPosition(end)).normalize();
      // A shield or bow hand keeps its upright grip; weapon hands follow the weapon.
      const followsWeapon = index === 1 || !melee.shield || index === 0 && frame.combat.manualBowPitch !== undefined;
      if (index === 0 && melee.leftPitch !== undefined)
        shaft.fromArray(weaponDirection(melee.leftPitch, melee.leftYaw ?? melee.yaw));
      else shaft.fromArray(weaponDirection(melee.pitch, melee.yaw));
      const desired = target.copy(followsWeapon ? shaft : point.set(0, 1, 0))
        .applyQuaternion(root.getWorldQuaternion(parent));
      turn.setFromUnitVectors(across, desired);
      arm.hand.getWorldQuaternion(upperWorld);
      arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(parent).invert()
        .multiply(turn.multiply(upperWorld)));
      if (chineseHeavy) alignChineseSwordWrist(root, arm.hand, indexFinger, pinky, melee);
    }
    // Wrist alignment changes the palm offset: refine the actual socket contact afterwards.
    for (let index = 0; index < arms.length; index++) {
      const arm = arms[index]!;
      const socket = axeGrip ? axeGrip.sockets[index] : arm.socket;
      if (!socket || !arm.hand?.parent) continue;
      arm.hand.getWorldQuaternion(desiredHand);
      contact.fromArray(positions[index]!); root.localToWorld(contact);
      for (let pass = 0; pass < 4; pass++) {
        target.copy(contact).sub(socket.getWorldPosition(socketOffset).sub(arm.hand.getWorldPosition(end)));
        arm.upper!.getWorldQuaternion(upperWorld); arm.lower!.getWorldQuaternion(lowerWorld);
        pole.fromArray(index === 1 && melee.rightElbow ? melee.rightElbow :
          [index === 0 ? .7 : -.7, -.25, -.25]).applyQuaternion(root.getWorldQuaternion(parent));
        const solution = solveTwoBone({ root: arm.upper!.getWorldPosition(shoulder),
          middle: arm.lower!.getWorldPosition(elbow), end: arm.hand.getWorldPosition(end) }, target, pole);
        arm.upper!.quaternion.copy(arm.upper!.parent!.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        arm.lower!.quaternion.copy(arm.lower!.parent!.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
        arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(parent).invert().multiply(desiredHand));
      }
    }
    // Close finger phalanges around a shaft/string; imported generic clips leave palms open.
    for (const [index, side] of ["Left", "Right"].entries()) {
      if (axeGrip) break;
      if (releasedThrow && side === "Right") continue;
      const arm = arms[index]!;
      const first = arm.indexFinger;
      const last = arm.pinky;
      if (!first || !last) continue;
      gripAxis.copy(first.getWorldPosition(point)).sub(last.getWorldPosition(end)).normalize();
      for (const finger of activeFingers) {
        if (!finger.bone.name.startsWith(`${side}Hand`) || finger.bone.name.includes("Thumb") || !finger.bone.parent) continue;
        localGripAxis.copy(gripAxis).applyQuaternion(finger.bone.parent.getWorldQuaternion(gripParentRotation).invert());
        let bend = .6;
        if (finger.bone.name.endsWith("1")) bend = .7;
        else if (finger.bone.name.endsWith("2")) bend = 1.1;
        finger.bone.quaternion.premultiply(gripRotation.setFromAxisAngle(localGripAxis, bend));
      }
    }
    if (footAxeGuard && footGrip) footGrip.alignContacts(positions);
    else if (axeGrip) axeGrip.alignContacts();
    adjusted = true;
  };
  return { reset, apply };
};
