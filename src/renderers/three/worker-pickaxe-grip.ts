import { Matrix4, type Object3D,Quaternion, Vector3 } from "three";

// Rotate the curved cross-head into the authored hammer swing's Y/Z plane.
const spikeTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
export const orientWorkingPickaxe = (pickaxe: Object3D) => pickaxe.quaternion.multiply(spikeTurn);
const shaft = new Vector3(), forward = new Vector3(), side = new Vector3(), matrix = new Matrix4();
const palm = new Vector3(), grip = new Vector3(), point = new Vector3(), correction = new Vector3();
const fistTurn = new Quaternion();
/** Forward/back beside the arm, keeping the upright shaft and palm contact exactly fixed. */
export const orientCarriedPickaxe = (pickaxe: Object3D, root?: Object3D, worldCurrent = false) => {
  shaft.set(0,1,0).applyQuaternion(pickaxe.quaternion);
  forward.set(0,0,1).addScaledVector(shaft,-shaft.z).normalize();
  side.crossVectors(forward,shaft).normalize();
  pickaxe.quaternion.setFromRotationMatrix(matrix.makeBasis(forward,shaft,side));
  if (root) centerToolShaftInHand(pickaxe, root, worldCurrent);
};

/** Move the haft into the curled fingers without changing its swing direction. */
const centerToolShaftInHand = (pickaxe: Object3D, root: Object3D, worldCurrent = false) => {
  shaft.set(0, 1, 0).applyQuaternion(pickaxe.quaternion);
  const socket = root.getObjectByName("hand_R");
  if (!socket) return;
  if (!worldCurrent) root.updateMatrixWorld(true);
  root.worldToLocal(socket.getWorldPosition(palm));
  grip.set(0,0,0);
  let count = 0;
  for (const name of ["Index", "Middle", "Ring", "Pinky"]) {
    const finger = root.getObjectByName(`RightHand${name}3`);
    if (!finger) continue;
    grip.add(root.worldToLocal(finger.getWorldPosition(point)));
    count++;
  }
  if (!count) return;
  // Centre the shaft inside the real curled fingers rather than on the outer palm socket.
  correction.copy(grip.divideScalar(count)).sub(palm).multiplyScalar(.5);
  correction.addScaledVector(shaft,-correction.dot(shaft));
  pickaxe.position.add(correction);
};

const FINGERS = ["Index", "Middle", "Ring", "Pinky"];
const fingerTips = FINGERS.map(() => new Vector3());

/** The curled finger tips (distal joints) of the right hand, in the worker root's space. */
const readFingerTips = (root: Object3D) => {
  for (const [position, finger] of FINGERS.entries()) {
    const bone = root.getObjectByName(`RightHand${finger}3`);
    if (!bone) return false;
    root.worldToLocal(bone.getWorldPosition(fingerTips[position]!));
  }
  return true;
};

/**
 * A closed fist cannot pivot a haft: turn the shaft onto the curled finger row (pinky to
 * index) and seat it so the finger tips wrap its surface on the palm side, keeping the grip
 * height on the shaft. `shaftRadius` is in the worker root's units.
 */
export const gripToolShaftInFist = (tool: Object3D, root: Object3D, shaftRadius: number, worldCurrent = false) => {
  const hand = root.getObjectByName("hand_R");
  if (!worldCurrent) root.updateMatrixWorld(true);
  if (!hand || !readFingerTips(root)) return;
  grip.set(0, 0, 0);
  for (const tip of fingerTips) grip.add(tip);
  grip.divideScalar(fingerTips.length);
  shaft.set(0, 1, 0).applyQuaternion(tool.quaternion);
  const gripHeight = point.copy(grip).sub(tool.position).dot(shaft);
  const fingerRow = forward.subVectors(fingerTips[0]!, fingerTips[3]!).normalize();
  tool.quaternion.premultiply(fistTurn.setFromUnitVectors(shaft, fingerRow));
  const palmSide = root.worldToLocal(hand.getWorldPosition(palm)).sub(grip);
  palmSide.addScaledVector(fingerRow, -palmSide.dot(fingerRow)).normalize();
  tool.position.copy(grip).addScaledVector(palmSide, shaftRadius).addScaledVector(fingerRow, -gripHeight);
};
