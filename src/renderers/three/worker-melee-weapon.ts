import { Box3, Matrix4, type Object3D,Quaternion, Vector3 } from "three";

import { type MeleePose, weaponDirection, weaponEdge } from "./worker-melee-tracks";

interface WeaponAxes { blade: Vector3; edge: Vector3 }

/**
 * The prop's own axes, measured once from its geometry: the blade (or haft) is its longest
 * extent and points away from the grip at the origin; the edge (axe head) is the next longest,
 * towards the side the head sticks out.
 */
const measureAxes = (prop: Object3D): WeaponAxes => {
  const cached = prop.userData.meleeAxes as WeaponAxes | undefined;
  if (cached) return cached;
  const saved = prop.quaternion.clone();
  prop.quaternion.identity(); prop.updateMatrixWorld(true);
  // Measure in the weapon's own space. Transforming just two corners of a world-axis box
  // makes the result depend on the wrist pose, especially for a broad curved khopesh.
  const box = new Box3(), part = new Box3(), relative = new Matrix4();
  const toLocal = new Matrix4().copy(prop.matrixWorld).invert();
  prop.traverse(object => {
    const geometry = (object as Object3D & { geometry?: import("three").BufferGeometry }).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    relative.multiplyMatrices(toLocal, object.matrixWorld);
    box.union(part.copy(geometry.boundingBox).applyMatrix4(relative));
  });
  const { max, min } = box;
  prop.quaternion.copy(saved);
  const size = [Math.abs(max.x - min.x), Math.abs(max.y - min.y), Math.abs(max.z - min.z)];
  const order = [0, 1, 2].sort((a, b) => size[b]! - size[a]!);
  const axis = (index: number, sign: number) =>
    new Vector3().setComponent(index, 1).multiplyScalar(sign || 1);
  const far = (index: number) => Math.abs(max.getComponent(index)) >= Math.abs(min.getComponent(index)) ? 1 : -1;
  const centre = (index: number) => Math.sign(min.getComponent(index) + max.getComponent(index));
  const axes = { blade: axis(order[0]!, far(order[0]!)), edge: axis(order[1]!, centre(order[1]!)) };
  prop.userData.meleeAxes = axes;
  return axes;
};

const local = new Matrix4(), target = new Matrix4(), rotation = new Quaternion(), parentRotation = new Quaternion();
const blade = new Vector3(), edge = new Vector3(), side = new Vector3(), across = new Vector3();

/**
 * Turns a held melee weapon so its blade points along the pose's weapon direction and its edge
 * (axe head) leads the cut, whatever the wrist orientation. Directions are in the soldier's
 * model space; the prop stays parented to the hand. `worldCurrent` skips the forced world update
 * when the caller already wrote the baked bone matrices this frame (C06b far props).
 */
export const orientMeleeWeapon = (
  prop: Object3D, soldier: Object3D, pose: MeleePose, reverseEdge = false, worldCurrent = false
) => {
  if (!prop.parent) return;
  const axes = measureAxes(prop);
  blade.fromArray(weaponDirection(pose.pitch, pose.yaw));
  edge.fromArray(weaponEdge(pose)).addScaledVector(blade, -edge.dot(blade)).normalize();
  if (reverseEdge) edge.negate();
  side.crossVectors(axes.blade, axes.edge);
  local.makeBasis(axes.blade, axes.edge, side);
  across.crossVectors(blade, edge);
  target.makeBasis(blade, edge, across);
  // Model-space rotation = target basis * inverse(local basis); then into the hand's frame.
  rotation.setFromRotationMatrix(target.multiply(local.transpose()));
  if (!worldCurrent) soldier.updateMatrixWorld(true);
  rotation.premultiply(soldier.getWorldQuaternion(parentRotation));
  prop.quaternion.copy(prop.parent.getWorldQuaternion(parentRotation).invert().multiply(rotation));
};

const lowerHand = new Vector3(), upperHand = new Vector3(), actual = new Vector3(), intended = new Vector3();
/**
 * A two-handed grip runs the weapon through both hands as the arm IK actually placed them (an
 * arm at full stretch falls short of its target), so neither hand floats beside the haft: the
 * axis goes from the lower (left) hand through the grip (right) one, or on a spear from the rear
 * (right) hand through the front (left) one. Falls back to the pose when the hands are too close
 * or crossed.
 */
export const alignTwoHandedGrip = (
  pose: MeleePose, soldier: Object3D, left: Object3D, right: Object3D, worldCurrent = false
): MeleePose => {
  if (!worldCurrent) soldier.updateMatrixWorld(true);
  soldier.worldToLocal(left.getWorldPosition(lowerHand));
  soldier.worldToLocal(right.getWorldPosition(upperHand));
  actual.subVectors(upperHand, lowerHand).multiplyScalar((pose.leftAlong ?? -1) > 0 ? -1 : 1);
  if (actual.length() < .05) return pose;
  actual.normalize();
  if (actual.dot(intended.fromArray(weaponDirection(pose.pitch, pose.yaw))) < .5) return pose;
  return { ...pose, pitch: Math.acos(Math.max(-1, Math.min(1, actual.y))), yaw: Math.atan2(actual.x, actual.z) };
};

interface ShieldAxes { face: Vector3; up: Vector3 }
/** Shield axes from its geometry: the thin axis is the face normal (towards the plate), the longest is up. */
const measureShield = (shield: Object3D): ShieldAxes => {
  const cached = shield.userData.shieldAxes as ShieldAxes | undefined;
  if (cached) return cached;
  // A world AABB has already lost the shield's axes: inverse-transforming its min/max
  // can swap face and width at diagonal headings. Measure child boxes in shield space,
  // including all their corners, without changing the hand pose or baked world matrices.
  const box = new Box3(), part = new Box3();
  const visit = (object: Object3D, relative: Matrix4) => {
    const geometry = (object as Object3D & { geometry?: import("three").BufferGeometry }).geometry;
    if (geometry) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(part.copy(geometry.boundingBox).applyMatrix4(relative));
    }
    for (const child of object.children) {
      if (child.matrixAutoUpdate) child.updateMatrix();
      visit(child, relative.clone().multiply(child.matrix));
    }
  };
  visit(shield, new Matrix4());
  const { min, max } = box;
  const size = [0, 1, 2].map(index => Math.abs(max.getComponent(index) - min.getComponent(index)));
  const order = [0, 1, 2].sort((a, b) => size[a]! - size[b]!);
  const centre = min.getComponent(order[0]!) + max.getComponent(order[0]!);
  const axes = {
    face: new Vector3().setComponent(order[0]!, Math.sign(centre) || 1),
    up: new Vector3().setComponent(order[2]!, 1)
  };
  shield.userData.shieldAxes = axes;
  return axes;
};

const shieldFront = new Vector3(), shieldUp = new Vector3(0, 1, 0), shieldWorld = new Quaternion();
/**
 * The shield faces the enemy (the soldier's front, tilted up a little when blocking) with its
 * long axis upright, whatever the wrist does. `threatYaw` turns it towards the actual attacker.
 */
export const orientShield = (
  shield: Object3D, soldier: Object3D, blocking: boolean, threatYaw?: number, worldCurrent = false
) => {
  if (!shield.parent) return;
  const axes = measureShield(shield);
  if (threatYaw === undefined) shieldFront.set(0, blocking ? .3 : .05, 1);
  else {
    // World bearing -> the soldier's local frame; the tilt keeps the boss towards the blow.
    shieldFront.set(Math.sin(threatYaw), 0, Math.cos(threatYaw))
      .applyQuaternion(soldier.getWorldQuaternion(shieldWorld).invert());
    shieldFront.y = blocking ? .3 : .05;
  }
  shieldFront.normalize();
  edge.copy(shieldUp).addScaledVector(shieldFront, -shieldUp.dot(shieldFront)).normalize();
  side.crossVectors(axes.face, axes.up);
  local.makeBasis(axes.face, axes.up, side);
  across.crossVectors(shieldFront, edge);
  target.makeBasis(shieldFront, edge, across);
  rotation.setFromRotationMatrix(target.multiply(local.transpose()));
  if (!worldCurrent) soldier.updateMatrixWorld(true);
  rotation.premultiply(soldier.getWorldQuaternion(parentRotation));
  shield.quaternion.copy(shield.parent.getWorldQuaternion(parentRotation).invert().multiply(rotation));
};
