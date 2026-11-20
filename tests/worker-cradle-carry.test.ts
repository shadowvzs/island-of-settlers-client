import { BoxGeometry, Group, Mesh, Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import type { CradleTransfer } from "../src/renderers/three/worker-cradle-carry";
import { createFishHandContacts } from "../src/renderers/three/worker-fish-carry";
import { createCradledWareHandContacts } from "../src/renderers/three/worker-stone-carry";
import before from "./fixtures/cradle-carry-before.json";
import { sampleCradle } from "./worker-cradle-samples";

// Generated from the original independent fish/stone consumers before extracting the common iteration.
// Digests cover joint world matrices and ware support contacts rounded to 1e-10, not image appearance.
it.each(before)("preserves $ware $direction progress=$progress carryOnly=$carryOnly", sample => {
  const factory = sample.ware === "fish" ? createFishHandContacts : createCradledWareHandContacts;
  expect(sampleCradle(factory, sample.ware as CradleTransfer["ware"],
    sample.direction as CradleTransfer["direction"], sample.progress, sample.carryOnly)).toBe(sample.digest);
});

it("supports a rotated grain bundle at its actual underside instead of the unrotated bounds", () => {
  const root = new Group(), load = new Group(), shape = new Group();
  shape.name = "ware_geometry";
  shape.rotation.y = Math.PI / 2;
  const geometry = new BoxGeometry(.6, .2, .2);
  shape.add(new Mesh(geometry)); load.add(shape); root.add(load);
  load.position.set(0, .75, .3);
  for (const side of ["Left", "Right"]) {
    const upper = new Object3D(), lower = new Object3D(), hand = new Object3D(), socket = new Object3D();
    upper.name = `${side}Arm`; lower.name = `${side}ForeArm`; hand.name = `${side}Hand`;
    socket.name = `socket_hand_${side === "Left" ? "L" : "R"}`;
    upper.position.set(side === "Left" ? .17 : -.17, .95, 0);
    lower.position.y = -.3; hand.position.y = -.28;
    root.add(upper); upper.add(lower); lower.add(hand); hand.add(socket);
  }
  createCradledWareHandContacts(root)(load,
    { direction: "pickup", progress: 1, target: { x: 0, y: 0, z: 0 }, ware: "grain" }, true);
  for (const side of ["Left", "Right"]) {
    const support = load.worldToLocal(new Vector3().fromArray(load.userData[`stoneSupport${side}`]));
    expect(Math.abs(support.x)).toBeCloseTo(.06);
    expect(support.y).toBeCloseTo(-.106);
    expect(support.z).toBeCloseTo(-.24);
  }
  geometry.dispose();
});
