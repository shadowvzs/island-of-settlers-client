import { Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Vector3 } from "three";
import { expect, it } from "vitest";

import { buildTwoHanded } from "../src/renderers/three/military-equipment-two-handed";
import type { MeleePose } from "../src/renderers/three/worker-melee-tracks";
import { alignTwoHandedGrip, orientMeleeWeapon } from "../src/renderers/three/worker-melee-weapon";
import actual from "./fixtures/commander-guard-i-matrices.json";

it.each([false, true])("shows the full upward-facing beard at the actual captured eye, detailed=%s", detailed => {
  const body = new Group(), prop = new Group();
  new Matrix4().fromArray(actual.rootMatrix).decompose(body.position, body.quaternion, body.scale);
  body.add(prop);
  prop.position.fromArray(actual.propLocal.position);
  prop.userData.meleeAxes = { blade: new Vector3(0, 1, 0), edge: new Vector3(1, 0, 0) };
  const axe = new Mesh(buildTwoHanded("viking", detailed), new MeshBasicMaterial()); prop.add(axe);
  body.updateMatrixWorld(true);
  const palms = actual.palms.map(palm => {
    const contact = new Object3D(); body.add(contact);
    contact.position.copy(body.worldToLocal(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(palm.matrix))));
    return contact;
  });
  const pose: MeleePose = { bend: 0, leftAlong: -.15, leftHand: [0, 0, 0], pitch: 1.65,
    rightHand: [0, 0, 0], shield: false, sweep: false, twist: 0, yaw: -.78 };
  const aligned = alignTwoHandedGrip(pose, body, palms[0]!, palms[1]!);
  const camera = new PerspectiveCamera(65, 1440 / 900, .1, 1000);
  camera.position.set(actual.camera.x, actual.camera.y, actual.camera.z);
  camera.lookAt(actual.camera.x + Math.sin(actual.camera.yaw), actual.camera.y,
    actual.camera.z + Math.cos(actual.camera.yaw));
  camera.updateMatrixWorld(true);
  const headBounds = () => {
    body.updateMatrixWorld(true);
    const position = axe.geometry.getAttribute("position"), surface = axe.geometry.getAttribute("equipmentSurface");
    const points: Vector3[] = [];
    for (let index = 0; index < position.count; index++) {
      if (surface.getX(index) < .3) continue;
      points.push(new Vector3().fromBufferAttribute(position, index).applyMatrix4(axe.matrixWorld).project(camera));
    }
    return { maxY: Math.max(...points.map(point => (1 - point.y) * 450)),
      minY: Math.min(...points.map(point => (1 - point.y) * 450)),
      maxX: Math.max(...points.map(point => (point.x + 1) * 720)),
      minX: Math.min(...points.map(point => (point.x + 1) * 720)) };
  };
  const shaft = () => ({ axis: new Vector3(0, 1, 0).transformDirection(prop.matrixWorld),
    origin: prop.getWorldPosition(new Vector3()) });
  const palmClearances = (axis: Vector3, origin: Vector3) => palms.map(palm => {
    const radial = palm.getWorldPosition(new Vector3()).sub(origin);
    return radial.addScaledVector(axis, -radial.dot(axis)).length();
  });
  orientMeleeWeapon(prop, body, aligned);
  const downward = headBounds(), before = shaft();
  const contacts = palmClearances(before.axis, before.origin);
  expect(downward.maxY).toBeGreaterThan(900);
  orientMeleeWeapon(prop, body, aligned, true);
  const upward = headBounds(), after = shaft();
  expect(upward.minX).toBeGreaterThan(0); expect(upward.maxX).toBeLessThan(1440);
  expect(upward.minY).toBeGreaterThan(0); expect(upward.maxY).toBeLessThan(900);
  expect(before.origin.distanceTo(after.origin)).toBeLessThan(1e-10);
  expect(before.axis.distanceTo(after.axis)).toBeLessThan(1e-10);
  palmClearances(after.axis, after.origin).forEach((distance, index) => {
    expect(distance).toBeLessThan(.01);
    expect(Math.abs(distance - contacts[index]!)).toBeLessThan(1e-10);
  });
  axe.geometry.dispose(); axe.material.dispose();
});
