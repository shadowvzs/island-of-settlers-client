import { createHash } from "node:crypto";
import { BoxGeometry, Group, Mesh, Object3D } from "three";

import type { CradleTransfer } from "../src/renderers/three/worker-cradle-carry";

type Contacts = (ware: Object3D, transfer: CradleTransfer, carryOnly?: boolean) => void;
export const sampleCradle = (factory: (root: Object3D) => Contacts, wareName: CradleTransfer["ware"],
  direction: CradleTransfer["direction"], progress: number, carryOnly: boolean) => {
  const root = new Group(), ware = new Group();
  root.position.set(3, .7, -4); root.rotation.set(.05, .8, -.03); root.scale.setScalar(.916);
  for (const side of ["Left", "Right"]) {
    const sign = side === "Left" ? 1 : -1;
    const upper = new Object3D(), lower = new Object3D(), hand = new Object3D(), socket = new Object3D();
    upper.name = `${side}Arm`; lower.name = `${side}ForeArm`; hand.name = `${side}Hand`;
    socket.name = `socket_hand_${side === "Left" ? "L" : "R"}`;
    upper.position.set(sign * .17, .95, 0); lower.position.set(sign * .03, -.3, .02);
    hand.position.set(sign * .02, -.28, .03); socket.position.set(.015, -.025, .035);
    upper.rotation.set(.1, sign * .2, sign * -.1); lower.rotation.z = sign * .2;
    root.add(upper); upper.add(lower); lower.add(hand); hand.add(socket);
  }
  const geometry = new BoxGeometry(.42, .18, .25), shape = new Mesh(geometry);
  shape.name = "ware_geometry"; ware.add(shape);
  ware.position.set(.04, .79, .35); ware.rotation.set(.07, -.2, .03); root.add(ware);
  root.updateMatrixWorld(true);
  factory(root)(ware, { direction, progress, ware: wareName,
    target: { x: 3, y: .8, z: -3 }, yaw: .2 }, carryOnly);
  root.updateMatrixWorld(true);
  const values: number[] = [];
  root.traverse(object => {
    if (/Arm|Hand|socket/.test(object.name)) values.push(...object.matrixWorld.elements);
  });
  for (const side of ["Left", "Right"]) values.push(...(ware.userData[
    `${wareName === "fish" ? "fish" : "stone"}Support${side}`] ?? []));
  geometry.dispose();
  return createHash("sha256").update(JSON.stringify(values.map(value => Math.round(value * 1e10) / 1e10))).digest("hex");
};
