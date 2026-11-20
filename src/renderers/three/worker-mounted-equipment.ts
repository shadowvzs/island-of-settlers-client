import type { Object3D } from "three";

import type { MountFrame } from "../../render-common/mounts/mount-frame";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { type MilitaryEquipmentId, type MilitaryEquipmentKit, releaseEquipmentProp, setEquipmentFaction } from "./military-equipment";
import { archerGuardPose, archerPose, commanderArcherPose } from "./worker-archer-pose";
import { meleePose } from "./worker-melee-moves";
import { type MeleePose, type Point3, weaponDirection } from "./worker-melee-tracks";
import { alignTwoHandedGrip, orientMeleeWeapon } from "./worker-melee-weapon";
import { createWorkerMilitaryPlacement } from "./worker-military-placement";
import { cavalrySwordPose, MOUNTED_ENGAGE } from "./worker-mounted-cut";

/** Actual catalogue weapon, while the horse keeps its physical cavalry identity. */
export const mountedWeaponType = (frame: MountFrame) => {
  if (frame.commanderLoadout === "bow") return "archer" as const;
  if (frame.commanderLoadout === "axe") return "heavy" as const;
  return "cavalry" as const;
};

/** Foot weapon targets lowered by the actual seated pelvis displacement; the hips stay in the saddle. */
export const mountedWeaponPose = (frame: MountFrame, pelvisDrop: number): MeleePose => {
  const progress = frame.attackProgress ?? null;
  if (!frame.commanderLoadout || frame.commanderLoadout === "sword")
    return cavalrySwordPose(progress, frame.guard ?? 0, frame.nation, frame.manualGuard);
  const guarding = progress === null && frame.manualGuard && (frame.guard ?? 0) > .5;
  let bow = guarding ? archerGuardPose() : archerPose(progress);
  if (frame.manualBowPitch !== undefined) bow = commanderArcherPose(progress, frame.manualBowPitch, guarding);
  let pose = frame.commanderLoadout === "bow" ? bow : meleePose({ nation: frame.nation,
    combat: { attackProgress: progress, defending: (frame.guard ?? 0) > .5, faction: frame.faction ?? 0, type: "heavy" } })!;
  if (frame.commanderLoadout === "axe" && frame.nation === "viking" && frame.manualControl) {
    const lift = frame.manualGuard && progress === null ? .17 : .08;
    const raised = (hand: Point3): Point3 => [hand[0], hand[1] + lift, hand[2] + .03];
    pose = { ...pose, leftHand: raised(pose.leftHand), rightHand: raised(pose.rightHand) };
  }
  if (frame.commanderLoadout === "axe" && frame.nation === "viking") {
    const yaw = pose.yaw - MOUNTED_ENGAGE.turn * (frame.engage ?? 0), direction = weaponDirection(pose.pitch, yaw);
    const leftHand = pose.rightHand.map((value, axis) => value + direction[axis]! * (pose.leftAlong ?? -.15)) as Point3;
    pose = { ...pose, leftHand, yaw };
  }
  const hands = (hand: Point3): Point3 => [hand[0], hand[1] - pelvisDrop - (pose.body?.drop ?? 0),
    hand[2] + (pose.body?.shift ?? 0)];
  return { ...pose, body: undefined, headYaw: -pose.twist, leftHand: hands(pose.leftHand), rightHand: hands(pose.rightHand) };
};

/** One owned prop/string per rider, template-owned meshes/materials; changing loadout releases the old prop. */
export const createMountedEquipment = (root: Object3D, kit: MilitaryEquipmentKit) => {
  const joints = new Map<string, Object3D>();
  root.traverse(joint => { if (joint.name) joints.set(joint.name, joint); });
  const attach = (prop: Object3D, side: "L" | "R") => {
    const joint = joints.get(`socket_hand_${side}`) ?? joints.get(side === "L" ? "LeftHand" : "RightHand");
    if (joint && prop.parent !== joint) joint.add(prop);
  };
  const place = createWorkerMilitaryPlacement(root, joints, attach);
  let prop: Object3D | undefined, key: string | undefined;
  const release = () => { if (prop) { releaseEquipmentProp(prop); } prop = undefined; key = undefined; };
  return {
    update: (frame: MountFrame, pose: MeleePose) => {
      if (frame.actorId === undefined) { release(); return; }
      const id: MilitaryEquipmentId = frame.commanderLoadout ?? "sword", nation = frame.nation ?? "roman";
      const next = `${id}:${nation}`;
      if (key !== next) { release(); prop = kit.create(id, nation, mountedWeaponType(frame)); key = next; }
      const worker = { nation, combat: { attackProgress: frame.attackProgress ?? null, faction: frame.faction ?? 0,
        manualBowPitch: frame.manualBowPitch,
        type: mountedWeaponType(frame) } } as WorkerFrame;
      if (id === "bow") { place(prop!, worker, id); return; }
      const anatomical = id === "axe" && nation === "viking";
      const left = (anatomical && joints.get("socket_axe_L")) || joints.get("socket_hand_L") || joints.get("LeftHand");
      const right = (anatomical && joints.get("socket_axe_R")) || joints.get("socket_hand_R") || joints.get("RightHand");
      if (right && prop!.parent !== right) right.add(prop!);
      const grip = id === "axe" && left && right ? alignTwoHandedGrip(pose, root, left, right) : pose;
      orientMeleeWeapon(prop!, root, grip);
      setEquipmentFaction(prop!, frame.faction ?? 0);
    },
    dispose: release
  };
};
