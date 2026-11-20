import { Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from "three";
import { expect, it } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import {
  addFishingBobber, BOBBER_NAME, FISHING_LINE_WIDTH_SCALE, placeFishingLine
} from "../src/renderers/three/worker-fishing-contact";

const SEGMENTS = 12;
const rodFixture = () => {
  const root = new Group(), prop = new Group();
  const knot = new Object3D(), fish = new Group();
  knot.name = "pole_tip_knot"; knot.position.set(0, 1.2, .8);
  fish.name = "caught_fish";
  prop.add(knot, fish);
  for (let index = 0; index < SEGMENTS; index++) {
    const line = new Mesh(new SphereGeometry(.001), new MeshStandardMaterial());
    line.name = `fishing_line_${index}`;
    prop.add(line);
  }
  root.add(prop);
  addFishingBobber(prop, false);
  return { prop, root };
};
const frame = (action: string, animationTime = 1) => ({ action, animationTime,
  fishingTarget: { x: 0, y: -.5, z: 2.5 } }) as unknown as WorkerFrame;
const lineEnd = (prop: Object3D, index: number, end: 1 | -1) => {
  const segment = prop.getObjectByName(`fishing_line_${index}`)!;
  return new Vector3(0, end * .5, 0).applyMatrix4(segment.matrixWorld);
};

it("arcs a readable line from the rod tip down to a float on the water", () => {
  const { prop, root } = rodFixture();
  placeFishingLine(prop, root, frame("fish_wait"));
  root.updateMatrixWorld(true);
  const bobber = prop.getObjectByName(BOBBER_NAME)!;
  const float = bobber.getWorldPosition(new Vector3());
  expect(bobber.visible).toBe(true);
  expect(float.x).toBeCloseTo(0); expect(float.z).toBeCloseTo(2.5);
  expect(Math.abs(float.y - (-.5 + .01))).toBeLessThanOrEqual(.008);
  expect(lineEnd(prop, 0, -1).distanceTo(new Vector3(0, 1.2, .8))).toBeLessThan(1e-6);
  expect(lineEnd(prop, SEGMENTS - 1, 1).distanceTo(float)).toBeLessThan(1e-6);
  // The slack line hangs below the straight chord between tip and float.
  const middle = lineEnd(prop, SEGMENTS / 2, -1), chord = new Vector3(0, 1.2, .8).lerp(float, .5);
  expect(middle.y).toBeLessThan(chord.y - .05);
  expect(prop.getObjectByName("fishing_line_3")!.scale.x).toBe(FISHING_LINE_WIDTH_SCALE);
});

it("lifts the float out with the catch and hides it away from the water", () => {
  const { prop, root } = rodFixture();
  const bobber = prop.getObjectByName(BOBBER_NAME)!;
  placeFishingLine(prop, root, frame("fish_reel", 3.6));
  expect(bobber.visible).toBe(false);
  placeFishingLine(prop, root, frame("fish_wait"));
  expect(bobber.visible).toBe(true);
  placeFishingLine(prop, root, frame("carry"));
  expect(bobber.visible).toBe(false);
});
