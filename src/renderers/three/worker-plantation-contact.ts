import { type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

interface HandPose {
  action: WorkerFrame["action"];
  position: Vector3;
  rotation: Quaternion;
  time: number;
  site: number;
}
// Weak keys follow render-frame lifetime; no world/entity IDs or scene objects are retained globally.
const poses = new WeakMap<WorkerFrame, HandPose>();
const sockets = new WeakMap<Object3D, { left: Object3D; right: Object3D }>();
export const recordPlantationHands = (root: Object3D, frame: WorkerFrame) => {
  if (
    frame.plantationSiteId === undefined ||
    frame.visible === false ||
    (frame.action !== "lift_honeycomb" && frame.action !== "pick_grapes")
  )
    return;
  let hands = sockets.get(root);
  if (!hands) {
    const left = root.getObjectByName("socket_hand_L"),
      right = root.getObjectByName("socket_hand_R");
    if (!left || !right) return;
    hands = { left, right };
    sockets.set(root, hands);
  }
  const { left, right } = hands;
  let pose = poses.get(frame);
  if (!pose) {
    pose = {
      action: frame.action,
      position: new Vector3(),
      rotation: new Quaternion(),
      site: frame.plantationSiteId,
      time: 0
    };
    poses.set(frame, pose);
  }
  left.getWorldPosition(pose.position);
  if (frame.action === "lift_honeycomb") {
    right.getWorldPosition(hand);
    pose.position.add(hand).multiplyScalar(0.5);
  }
  root.getWorldQuaternion(pose.rotation);
  pose.action = frame.action;
  pose.site = frame.plantationSiteId;
  pose.time = frame.animationTime;
};
const hand = new Vector3();
export const plantationHandPose = (frame: WorkerFrame) => {
  const pose = poses.get(frame);
  if (
    frame.visible === false ||
    !pose ||
    pose.action !== frame.action ||
    pose.site !== frame.plantationSiteId ||
    pose.time !== frame.animationTime
  )
    return null;
  return pose;
};
