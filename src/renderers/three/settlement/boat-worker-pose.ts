import { type AnimationClip, AnimationMixer, Bone, Box3, LoopOnce, type Object3D, Quaternion, Vector3 } from "three";

import { WORKER_SCALE } from "../../../render-common/workers/worker-dimensions";
import { createTwoBoneArmApplicator } from "../worker-two-bone-arm";
import { createBoatOarGrip } from "./boat-oar-grip";
import { BARGE_DRY_FLOOR_Y, SEAT_Y } from "./harbour-barge-geometry";

const UP = new Vector3(0, 1, 0);

export interface BoatGrip { point: Vector3; axis: Vector3 }
export interface BoatPersonPose {
  seat: Vector3;
  facing: number;
  fisherMotion?: boolean;
  lean?: number;
  net?: number;
  grips?: readonly BoatGrip[];
  climb?: number;
  time?: number;
  strokePhase?: number;
}
/** Actual population skeleton, seated on a thwart, with grounded feet and real palm/oar contacts. */
export const createBoatWorkerPose = (body: Object3D, clips: readonly AnimationClip[]) => {
  const bone = (name: string) => {
    const found = body.getObjectByName(name);
    if (!found) throw new Error(`Boat settler rig lacks ${name}`);
    return found;
  };
  const hips = bone("Hips");
  const mixer = new AnimationMixer(body);
  const actions = new Map(["row_single", "net_cast", "net_haul"].flatMap(name => {
    const clip = clips.find(candidate => candidate.name === name);
    if (!clip) return [];
    const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true;
    return [[name, action] as const];
  }));
  const bones: { bone: Object3D; position: Vector3; rotation: Quaternion }[] = [];
  body.traverse(object => { if (object instanceof Bone) bones.push({ bone: object,
    position: object.position.clone(), rotation: object.quaternion.clone() }); });
  const limbs = ["Left", "Right"].map(side => ({
    side, thigh: bone(`${side}UpLeg`), knee: bone(`${side}Leg`), foot: bone(`${side}Foot`),
    arm: bone(`${side}Arm`), elbow: bone(`${side}ForeArm`), hand: bone(`${side}Hand`),
    socket: bone(`socket_hand_${side === "Left" ? "L" : "R"}`),
    index: body.getObjectByName(`${side}HandIndex1`), pinky: body.getObjectByName(`${side}HandPinky1`),
    soleOffset: 0, footRotation: new Quaternion()
  }));
  const gripClip = clips.find(clip => clip.name === "build_hammer");
  const fingers = (gripClip?.tracks ?? []).flatMap(track => {
    if (!/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[123]\.quaternion$/.test(track.name)) return [];
    const joint = body.getObjectByName(track.name.slice(0, -11));
    if (!joint) return [];
    let index = 0;
    while (index + 1 < track.times.length && track.times[index + 1]! <= .65) index++;
    return [{ joint, rotation: new Quaternion().fromArray(track.values, index * 4) }];
  });
  body.scale.setScalar(WORKER_SCALE);
  body.updateWorldMatrix(true, true);
  const oarGrip = createBoatOarGrip(body);
  const bounds = new Box3().setFromObject(body), footAt = new Vector3();
  for (const limb of limbs) {
    limb.soleOffset = Math.max(.015, limb.foot.getWorldPosition(footAt).y - bounds.min.y);
    limb.foot.getWorldQuaternion(limb.footRotation);
    limb.footRotation.premultiply(body.getWorldQuaternion(new Quaternion()).invert());
  }
  const apply = createTwoBoneArmApplicator(body);
  const localHip = new Vector3(), target = new Vector3(), handAt = new Vector3(), socketAt = new Vector3();
  const pole = new Vector3(), axis = new Vector3(), across = new Vector3();
  const worldRotation = new Quaternion(), parentRotation = new Quaternion(), twist = new Quaternion();
  const handOrientation = new Quaternion();
  const desiredFoot = new Quaternion(), localPoint = new Vector3(), goal = new Vector3();
  let maximumGripError = 0;
  let activeClip: string | undefined;
  const update = (frame: BoatPersonPose) => {
    const parent = body.parent;
    if (!parent) return;
    for (const rest of bones) {
      rest.bone.position.copy(rest.position); rest.bone.quaternion.copy(rest.rotation);
    }
    let clipName: string | undefined;
    if (frame.fisherMotion) {
      if (frame.net === undefined) clipName = "row_single";
      else if (frame.net < .13) clipName = "net_cast";
      else if (frame.net >= .74) clipName = "net_haul";
    }
    const action = clipName ? actions.get(clipName) : undefined;
    if (clipName !== activeClip) {
      mixer.stopAllAction();
      action?.reset().play();
      activeClip = clipName;
    }
    if (action) {
      let seconds = (frame.time ?? 0) % 1.8;
      if (clipName === "row_single" && frame.strokePhase !== undefined) {
        // The authored spine uses sin(phase); the forward-facing fisher rocks
        // with the handle's -cos(phase), on the actual oar clock including its offset.
        const cycle = ((frame.strokePhase / (Math.PI * 2) - .25) % 1 + 1) % 1;
        seconds = cycle * action.getClip().duration;
      }
      if (clipName === "net_cast") seconds = frame.net! / .13 * 2.4;
      else if (clipName === "net_haul") seconds = (frame.net! - .74) / .26 * 4.8;
      mixer.setTime(Math.min(action.getClip().duration - .0001, Math.max(0, seconds)));
    }
    body.position.set(0, 0, 0); body.rotation.set(frame.lean ?? 0, frame.facing, 0, "YXZ");
    body.updateWorldMatrix(true, true);
    localHip.copy(hips.getWorldPosition(target)); parent.worldToLocal(localHip);
    body.position.copy(frame.seat).sub(localHip);
    body.updateWorldMatrix(true, true);
    for (const limb of limbs) {
      const side = limb.side === "Left" ? 1 : -1;
      // The torso faces +z locally; facing is supplied by the vessel's seating layout.
      const stepping = frame.climb !== undefined;
      const step = Math.sin((frame.time ?? 0) * 6 + (side > 0 ? 0 : Math.PI));
      // Keep the skiff's feet close together inside the bilge, with bent knees.
      const footSpread = frame.fisherMotion ? .055 : .09;
      target.set(side * footSpread, stepping ? -.36 + step * .075 : BARGE_DRY_FLOOR_Y + limb.soleOffset - frame.seat.y,
        stepping ? .16 : .31).applyAxisAngle(UP, frame.facing).add(frame.seat);
      parent.localToWorld(target);
      pole.set(side * .05, 0, 1).applyQuaternion(body.getWorldQuaternion(worldRotation));
      apply(limb.thigh, limb.knee, limb.foot, target, pole);
      const desired = desiredFoot.copy(limb.footRotation).premultiply(body.getWorldQuaternion(worldRotation));
      limb.foot.quaternion.copy(limb.foot.parent!.getWorldQuaternion(parentRotation).invert().multiply(desired));
    }
    if (frame.grips || frame.climb !== undefined) for (const finger of fingers) finger.joint.quaternion.copy(finger.rotation);
    maximumGripError = 0;
    for (const [index, limb] of limbs.entries()) {
      const grip = frame.net === undefined ? frame.grips?.[index] : undefined;
      // Passengers rest their palms on their knees; rowing palms meet the real shaft.
      if (grip) localPoint.copy(grip.point);
      else if (frame.net !== undefined) {
        const progress = frame.net;
        const cast = Math.min(1, progress / .13);
        const hauling = Math.max(0, (progress - .74) / .26);
        const pull = hauling ? .5 + .5 * Math.sin(hauling * Math.PI * 6 + index * Math.PI) : cast;
        localPoint.set(.18 + index * .09 + pull * .07, frame.seat.y + .24 + pull * .08,
          frame.seat.z + .13 - pull * .08);
      }
      else {
        const climbing = frame.climb !== undefined;
        localPoint.set(index ? -.1 : .1, climbing ? .25 + Math.sin((frame.time ?? 0) * 6 + index * Math.PI) * .06 :
          SEAT_Y + .11 - frame.seat.y, climbing ? .23 : .3)
          .applyAxisAngle(UP, frame.facing).add(frame.seat);
      }
      goal.copy(localPoint); parent.localToWorld(goal);
      if (grip && frame.fisherMotion) {
        const error = oarGrip.solve(limb.side as "Left" | "Right", goal, grip.axis, parent);
        if (error !== undefined) { maximumGripError = Math.max(maximumGripError, error); continue; }
      }
      if (grip && limb.index && limb.pinky) {
        axis.copy(grip.axis).applyQuaternion(parent.getWorldQuaternion(worldRotation)).normalize();
        across.copy(limb.index.getWorldPosition(target)).sub(limb.pinky.getWorldPosition(handAt)).normalize();
        twist.setFromUnitVectors(across, axis);
        limb.hand.getWorldQuaternion(worldRotation);
        limb.hand.quaternion.copy(limb.hand.parent!.getWorldQuaternion(parentRotation).invert()
          .multiply(twist.multiply(worldRotation)));
      }
      // Palm orientation belongs to the shaft, not to the elbow rotations used to reach it.
      // Keeping it in world space makes the socket-to-wrist offset rigid through the solve.
      limb.hand.getWorldQuaternion(handOrientation);
      for (let pass = 0; pass < 4; pass++) {
        body.updateMatrixWorld(true);
        target.copy(goal).sub(limb.socket.getWorldPosition(socketAt).sub(limb.hand.getWorldPosition(handAt)));
        pole.set(index ? -.3 : .3, -.6, .6).applyQuaternion(body.getWorldQuaternion(worldRotation));
        apply(limb.arm, limb.elbow, limb.hand, target, pole);
        limb.hand.quaternion.copy(limb.hand.parent!.getWorldQuaternion(parentRotation).invert().multiply(handOrientation));
        body.updateMatrixWorld(true);
      }
      if (grip) maximumGripError = Math.max(maximumGripError, limb.socket.getWorldPosition(socketAt).distanceTo(goal));
    }
    body.updateMatrixWorld(true);
  };
  return { update, gripError: () => maximumGripError };
};
