import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { Group, Mesh, type MeshStandardMaterial, type Object3D,Quaternion, Vector3 } from "three";

import type { BuildingPart, BuildingSurface } from "../../render-common/buildings/building-recipe";
import { addRomanSeedling, addRomanSeedlingRootBall } from "../../render-common/buildings/roman-resource-workshops";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createRomanPartGeometry } from "./buildings/roman-building";

/** The carried sapling is the same authored trunk, branches and leaves as the right nursery. */
export const createForesterSeedling = (materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean) => {
  const root = new Group();
  root.name = "forester_nursery_seedling";
  root.userData.sharedWareMaterials = true;
  const part: Parameters<typeof addRomanSeedling>[0] = (surface, position, size, stage = 3, shape = "box", rotation = [0, 0, 0], tint) => {
    const part = { surface, position, size, stage, shape, rotation, tint } as BuildingPart;
    const mesh = new Mesh(createRomanPartGeometry(part, detailed), materials[surface]);
    mesh.castShadow = detailed;
    root.add(mesh);
  };
  addRomanSeedling(part, 0, -.09, 0, detailed);
  addRomanSeedlingRootBall(part, -.09, detailed);
  return root;
};
const handPoint = new Vector3(), target = new Vector3(), rotation = new Quaternion();
export const placeForesterSeedling = (prop: Object3D, worker: Object3D, hand: Object3D, frame: WorkerFrame) => {
  const seedling = frame.foresterSeedling!;
  worker.updateMatrixWorld(true);
  hand.getWorldPosition(handPoint);
  const progress = seedling.progress;
  const travel = progress === undefined ? 1 : Math.max(0, Math.min(1, (progress - .5) * 2));
  target.set(seedling.target.x, seedling.target.y + (seedling.planting === undefined ? 0 : .09 * seedling.scale), seedling.target.z);
  if (progress !== undefined) handPoint.lerp(target, 1 - travel);
  else if (seedling.planting !== undefined) handPoint.lerp(target, seedling.planting);
  prop.position.copy(worker.worldToLocal(handPoint));
  prop.quaternion.copy(worker.getWorldQuaternion(rotation).invert());
  prop.scale.setScalar(seedling.scale / worker.getWorldScale(target).x);
  prop.visible = progress === undefined || progress >= .5;
};

const resets = new WeakMap<Object3D, () => void>();
export const resetForesterHand = (root: Object3D) => resets.get(root)?.();
export const createForesterHandContact = (root: Object3D) => {
  const upper = root.getObjectByName("LeftArm"), lower = root.getObjectByName("LeftForeArm");
  const hand = root.getObjectByName("LeftHand"), socket = root.getObjectByName("socket_hand_L");
  const upperPose = new Quaternion(), lowerPose = new Quaternion(), parent = new Quaternion();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion();
  const target = new Vector3(), offset = new Vector3(), shoulder = new Vector3();
  const elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  let adjusted = false;
  resets.set(root, () => {
    if (!adjusted) return;
    upper?.quaternion.copy(upperPose); lower?.quaternion.copy(lowerPose); adjusted = false;
  });
  return (prop: Object3D) => {
    if (!upper?.parent || !lower?.parent || !hand || !socket) return;
    upperPose.copy(upper.quaternion); lowerPose.copy(lower.quaternion); adjusted = true;
    for (let pass = 0; pass < 5; pass++) {
      root.updateMatrixWorld(true);
      prop.getWorldPosition(target);
      offset.copy(socket.getWorldPosition(offset)).sub(hand.getWorldPosition(end)); target.sub(offset);
      upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
      pole.set(-.5, -.8, -.3).applyQuaternion(root.getWorldQuaternion(parent));
      const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
        middle: lower.getWorldPosition(elbow), end: hand.getWorldPosition(end) }, target, pole);
      upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
        .multiply(solution.rootDelta.multiply(upperWorld)));
      root.updateMatrixWorld(true);
      lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
        .multiply(solution.middleDelta.multiply(lowerWorld)));
    }
  };
};
