import { type AnimationClip, type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { BOBBER_NAME } from "./worker-fishing-contact";

// The real pole's +Y runs from its butt to its tip. Keep it slightly behind the shoulder.
const rodRotation = new Quaternion().setFromUnitVectors(
  new Vector3(0, 1, 0), new Vector3(.055, 1, -.12).normalize()
);
const gripCenter = new Vector3(0, .035, 0);
const isTravel = (frame: WorkerFrame) => frame.workerTool === "fishingRod" &&
  !frame.carryingWare && !frame.wareTransfer &&
  ["walk", "run", "idle_breathe"].includes(frame.action);

/** Use the original closed tool grip, turning only the wrist to wrap an upright shaft. */
export const createTravelRodHand = (root: Object3D, clips: readonly AnimationClip[]) => {
  const clip = clips.find(candidate => candidate.name === "build_hammer");
  const fingers = (clip?.tracks ?? []).flatMap(track => {
    if (!/^RightHand((Thumb|Index|Middle|Ring|Pinky)[123])?\.quaternion$/.test(track.name)) return [];
    const bone = root.getObjectByName(track.name.slice(0, -11));
    if (!bone) return [];
    let key = 0;
    while (key + 1 < track.times.length && track.times[key + 1]! <= .65) key++;
    return [{ bone, original: new Quaternion(), grip: new Quaternion().fromArray(track.values, key * 4) }];
  });
  const hand = root.getObjectByName("RightHand"), index = root.getObjectByName("RightHandIndex1");
  const pinky = root.getObjectByName("RightHandPinky1");
  const axis = new Vector3(), target = new Vector3(), point = new Vector3();
  const world = new Quaternion(), parent = new Quaternion(), turn = new Quaternion();
  let adjusted = false;
  return {
    reset: () => {
      if (!adjusted) return;
      for (const finger of fingers) finger.bone.quaternion.copy(finger.original);
      adjusted = false;
    },
    apply: (frame: WorkerFrame) => {
      if (!isTravel(frame)) return;
      for (const finger of fingers) {
        finger.original.copy(finger.bone.quaternion);
        finger.bone.quaternion.copy(finger.grip);
      }
      if (hand?.parent && index && pinky) {
        root.updateMatrixWorld(true);
        axis.copy(index.getWorldPosition(point)).sub(pinky.getWorldPosition(target)).normalize();
        target.set(0, 1, 0).applyQuaternion(rodRotation)
          .applyQuaternion(root.getWorldQuaternion(world));
        turn.setFromUnitVectors(axis, target);
        hand.getWorldQuaternion(world);
        hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(turn.multiply(world)));
        root.updateMatrixWorld(true);
      }
      adjusted = true;
    }
  };
};

/** Anchor the wrapped grip at the real right socket; the butt remains below the palm. */
export const createTravelRodPlacement = () => {
  const palm = new Vector3(), offset = new Vector3(), fingers = new Vector3(), point = new Vector3();
  const axis = new Vector3(), correction = new Vector3();
  return (prop: Object3D, root: Object3D, hand: Object3D, worldCurrent = false) => {
    if (!worldCurrent) root.updateWorldMatrix(true, true);
    prop.quaternion.copy(rodRotation);
    offset.copy(gripCenter).applyQuaternion(rodRotation);
    prop.position.copy(root.worldToLocal(hand.getWorldPosition(palm))).sub(offset);
    // As with the pickaxe, put the shaft inside the curled fingers rather than on the palm edge.
    fingers.set(0, 0, 0);
    let count = 0;
    for (const name of ["Index", "Middle", "Ring", "Pinky"]) {
      const finger = root.getObjectByName(`RightHand${name}3`);
      if (!finger) continue;
      fingers.add(root.worldToLocal(finger.getWorldPosition(point)));
      count++;
    }
    if (!count) return;
    axis.set(0, 1, 0).applyQuaternion(rodRotation);
    correction.copy(fingers.divideScalar(count)).sub(palm).multiplyScalar(.5);
    correction.addScaledVector(axis, -correction.dot(axis));
    prop.position.add(correction);
  };
};

const looseLines = new WeakMap<Object3D, Object3D[]>();
const STOWED_ROD_PARTS = ["caught_fish", BOBBER_NAME];
/** Stow the loose cast line during transport; its original clips resume at the fishing site. */
export const setTravelRodLine = (prop: Object3D, travel: boolean) => {
  let lines = looseLines.get(prop);
  if (!lines) {
    lines = [];
    prop.traverse(child => {
      if (child.name.startsWith("fishing_line_") || STOWED_ROD_PARTS.includes(child.name)) lines!.push(child);
    });
    looseLines.set(prop, lines);
  }
  for (const line of lines) line.visible = !travel;
};
