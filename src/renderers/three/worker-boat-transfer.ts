import { Quaternion, Vector3 } from "three";

import { FISHING_SKIFF_KEEL_DEPTH } from "../../render-common/ships/fishing-skiff-dimensions";
import { FISHING_SKIFF_RIM_HEIGHT, FISHING_SKIFF_STOW_OFFSET, FISHING_SKIFF_STOW_ROTATION } from "../../render-common/ships/fishing-skiff-stow";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import { boatLiftClearanceOffset } from "./worker-boat-lift-path";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const LONG_AXIS = new Vector3(0, 0, 1);
export const BOAT_CARRY_FORWARD = .12;

/** Match the existing stock handoff while the grounded load starts moving. */
export const boatTransferStockOffsetWeight = (lift: number) => 1 - smooth((lift - .55) / .45);

/** Solo side lift: raise the near gunwale, roll overhead, then align lengthwise.
 * The body stays beside the hull instead of walking through its floor. */
export const boatTransferTransform = (lift: number) => {
  const share = smooth(lift), yaw = Math.PI / 2 * (1 - smooth((lift - .55) / .45));
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    .multiply(new Quaternion().setFromAxisAngle(LONG_AXIS, -Math.PI * share));
  const center = new Vector3(0, (FISHING_SKIFF_RIM_HEIGHT + FISHING_SKIFF_KEEL_DEPTH) / WORKER_SCALE, .6 / WORKER_SCALE)
    .lerp(new Vector3(0, 1.16, BOAT_CARRY_FORWARD), share);
  center.z = .6 / WORKER_SCALE + (BOAT_CARRY_FORWARD - .6 / WORKER_SCALE) * smooth(lift / .5);
  center.y += .18 / WORKER_SCALE * Math.sin(Math.PI * share);
  center.add(boatLiftClearanceOffset(lift));
  return { rotation, center,
    gripAlong: -.12, workerForward: 0, gripDepth: 0 };
};

/** Exact held-hull origin at the wall, including its rim-relative geometry origin. */
export const yardBoatWorldPose = (anchor: { x: number; y: number; z: number; yaw: number }) => {
  const heading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), anchor.yaw);
  const rotation = heading.clone().multiply(FISHING_SKIFF_STOW_ROTATION);
  const center = new Vector3(anchor.x, anchor.y, anchor.z)
    .add(FISHING_SKIFF_STOW_OFFSET.clone().applyQuaternion(heading))
    .add(new Vector3(0, FISHING_SKIFF_RIM_HEIGHT, 0).applyQuaternion(rotation));
  return { center, rotation };
};

export const yardBoatRotationShare = (lift: number) => clamp(smooth((lift - .1) / .8) + .05 * smooth((lift - .59) / .025) * (1 - smooth((lift - .72) / .08)));

/** Lift the same side-stowed hull away from the wall and over the worker's head. */
export const yardBoatLiftTransform = (lift: number,
  start: { center: Vector3; rotation: Quaternion }, finish: Vector3,
  finishRotation = new Quaternion().setFromAxisAngle(LONG_AXIS, Math.PI)) => {
  const share = smooth(lift);
  const horizontal = smooth((lift - .45) / .55);
  const center = start.center.clone().lerp(finish, horizontal);
  center.y = start.center.y + (finish.y - start.center.y) * share;
  center.y += .12 * Math.sin(Math.PI * share);
  const rotation = start.rotation.clone().slerp(
    finishRotation, yardBoatRotationShare(lift));
  return { center, rotation };
};


/** Face the stored gunwale, then turn lengthwise as the hull clears the wall. */
export const yardBoatWorkerHeading = (yardYaw: number, lift: number) =>
  yardYaw + Math.PI - Math.PI / 2 * smooth((lift - .4) / .6);


/** Keep the knees bent while the far end pivots; stand as the hull clears overhead. */
export const boatTransferBodyPhase = (lift: number) => {
  const phase = clamp(lift);
  return phase <= .55 ? phase * .28 / .55 : .28 + (phase - .55) * .72 / .45;
};
