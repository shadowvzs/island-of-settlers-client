import { Group, Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import {
  CARRIED_UPRIGHT_TOOLS, carriedToolAxis, createWalkingHammerGrip
} from "../src/renderers/three/worker-hammer-grip";

const placedRoot = (heading: number) => {
  const root = new Group();
  root.rotation.y = heading;
  root.updateMatrixWorld(true);
  return root;
};

it.each([0, Math.PI / 2, Math.PI, -2.4])("a travelling hammer leads the walker at heading %s", (heading) => {
  const axis = carriedToolAxis(placedRoot(heading), "hammer", new Vector3());
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  expect(axis.length()).toBeCloseTo(1, 10);
  // Head above the fist but well ahead of it: no upright torch in front of the face.
  expect(axis.y).toBeGreaterThan(.4);
  expect(axis.y).toBeLessThan(.7);
  expect(axis.dot(forward)).toBeGreaterThan(.7);
  expect(Math.abs(axis.x * forward.z - axis.z * forward.x)).toBeLessThan(1e-10);
});

it.each(["pickaxe", "axe", "shovel", undefined])("other carried tools (%s) keep the upright haft", (tool) => {
  const axis = carriedToolAxis(placedRoot(1.2), tool, new Vector3());
  expect(axis.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-10);
});

const gripTool = (tool: string) => {
  const root = placedRoot(.7), hand = new Object3D(), prop = new Object3D();
  hand.position.set(-.2, .55, .1);
  root.add(hand, prop);
  root.updateMatrixWorld(true);
  createWalkingHammerGrip()(prop, root, hand, tool);
  root.updateMatrixWorld(true);
  return new Vector3(0, 1, 0).transformDirection(prop.matrixWorld);
};

it("a travelling shovel keeps a fixed upright haft rather than following the swinging wrist", () => {
  expect(CARRIED_UPRIGHT_TOOLS).toContain("shovel");
});

it("a travelling shovel is turned spade up, never planted ahead of the feet like a crutch", () => {
  // The shovel is authored spade down (-Y); its +Y handle end must point at the ground.
  expect(gripTool("shovel").y).toBeLessThan(-.99);
  expect(gripTool("axe").y).toBeGreaterThan(.99);
});
