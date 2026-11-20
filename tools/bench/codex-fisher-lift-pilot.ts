/** Experimental only: not used by the game; see codex-fisher-dense-probe.ts. */
import { Quaternion, Vector3 } from "three";
import { FISHING_SKIFF_LENGTH } from "../../src/render-common/ships/fishing-skiff-dimensions";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const TILT_AXIS = new Vector3(1, 0, 0);
/** Model-space hull end and keel relative to the gunwale origin. */
export const BOAT_TRANSFER_GROUND_PIVOT = new Vector3(0, -.3 * .78 / WORKER_SCALE,
  FISHING_SKIFF_LENGTH / (2 * WORKER_SCALE));
export const BOAT_TRANSFER_SUPPORT = new Vector3(0, 0, 1.1);
const CARRY = new Vector3(0, 1.16, .12);
// Local worker step, in world units; sampled from the clearance and arm-reach search.
const STEP = [
  [0,.2],[0,.2],[0,.1],[0,.1],[0,.1],[0,.1],[0,.1],[0,.1],[0,.1],[0,.1],[0,.1],
  [0,.1],[0,.2],[0,.3],[.2,.5],[.2,.4],[.2,.2],[.1,.1],[0,0],[0,.1],[0,.1]
];

/** Keep a stock handoff anchored while its keel is the pivot; release only after hoisting. */
export const boatTransferStockOffsetWeight = (lift: number) => 1 - smooth((lift - .55) / .45);

/** One trajectory is sampled forward to lift and backward to lower the same lengthwise hull. */
export const boatTransferTransform = (lift: number) => {
  const hoist = smooth(lift / .55), transfer = smooth((lift - .55) / .45);
  const pitch = .95 * hoist + (Math.PI - .95) * transfer;
  const rotation = new Quaternion().setFromAxisAngle(TILT_AXIS, pitch);
  const finish = CARRY.clone().add(BOAT_TRANSFER_GROUND_PIVOT.clone()
    .applyQuaternion(new Quaternion().setFromAxisAngle(TILT_AXIS, Math.PI)));
  const groundContact = BOAT_TRANSFER_SUPPORT.clone().lerp(finish, transfer);
  groundContact.y += .28 * Math.sin(Math.PI * transfer);
  const center = groundContact.clone().sub(BOAT_TRANSFER_GROUND_PIVOT.clone().applyQuaternion(rotation));
  const gripAlong = -.6 + .3 * Math.sin(Math.PI * Math.max(0, Math.min(1, lift)));
  // Approach the grounded end, pass under the raised end, then settle back into the carry stance.
  const stepIndex = clamp(lift) * (STEP.length - 1), stepBase = Math.min(STEP.length - 2, Math.floor(stepIndex));
  const stepBlend = stepIndex - stepBase;
  const step = STEP[stepBase]!.map((value, axis) => value + (STEP[stepBase + 1]![axis]! - value) * stepBlend);
  const workerForward = (lift < .5 ? -.55 + 1.4 * smooth(lift / .5) :
    .85 * (1 - smooth((lift - .5) / .5))) + step[1]! / WORKER_SCALE;
  const workerSide = step[0]! / WORKER_SCALE;
  return {
    rotation,
    center,
    groundContact,
    gripAlong,
    workerForward,
    workerSide,
    gripDepth: 0
  };
};
