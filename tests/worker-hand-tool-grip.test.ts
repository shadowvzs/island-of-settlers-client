import { Bone, Group, Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import { createHandBlendTracker } from "../src/renderers/three/worker-hand-blend";
import { gripToolShaftInFist } from "../src/renderers/three/worker-pickaxe-grip";

const FINGERS = ["Index", "Middle", "Ring", "Pinky"];

/** A scaled, turned worker root with a right hand whose finger tips form a row along +X. */
const createHand = () => {
  const root = new Group();
  root.scale.setScalar(.5);
  root.rotation.y = .7;
  const hand = new Bone();
  hand.name = "hand_R";
  hand.position.set(.3, 1, .1);
  root.add(hand);
  FINGERS.forEach((finger, index) => {
    const tip = new Bone();
    tip.name = `RightHand${finger}3`;
    tip.position.set(.06 - index * .04, 0, .05);
    hand.add(tip);
  });
  root.updateMatrixWorld(true);
  return { hand, root };
};

const toolAxis = (tool: Object3D) => new Vector3(0, 1, 0).applyQuaternion(tool.quaternion);

it("a pose blend carries a baked hand tool along with the blended hand", () => {
  const { hand, root } = createHand();
  const tracker = createHandBlendTracker(root);
  const tool = new Object3D();
  tool.position.set(.32, 1.02, .15);
  root.add(tool);
  const offset = tool.position.clone().sub(hand.position);
  tracker.before();
  hand.position.x += .1;
  hand.rotation.z = .4;
  tracker.after(true);
  tracker.follow(tool, "build_hammer");
  const followed = offset.applyAxisAngle(new Vector3(0, 0, 1), .4).add(hand.position);
  expect(tool.position.distanceTo(followed)).toBeLessThan(1e-9);
  expect(toolAxis(tool).angleTo(new Vector3(0, 1, 0))).toBeCloseTo(.4, 9);
});

it("without a running blend, or for other actions, the tool keeps its baked placement", () => {
  const { root } = createHand();
  const tracker = createHandBlendTracker(root);
  const tool = new Object3D();
  tool.position.set(.1, .2, .3);
  tracker.before();
  tracker.after(false);
  tracker.follow(tool, "build_hammer");
  tracker.after(true);
  tracker.follow(tool, "walk");
  expect(tool.position.toArray()).toEqual([.1, .2, .3]);
});

it("the fist grip lays the haft along the finger row, touching the finger tips", () => {
  const { hand, root } = createHand();
  const tool = new Object3D();
  tool.position.set(.2, .9, .3);
  tool.rotation.set(.5, 0, .3);
  root.add(tool);
  const radius = .013;
  gripToolShaftInFist(tool, root, radius);
  const axis = toolAxis(tool);
  expect(axis.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9);
  for (const finger of FINGERS) {
    const tip = root.worldToLocal(root.getObjectByName(`RightHand${finger}3`)!.getWorldPosition(new Vector3()));
    const fromShaft = tip.sub(tool.position);
    const distance = fromShaft.addScaledVector(axis, -fromShaft.dot(axis)).length();
    expect(distance).toBeCloseTo(radius, 9);
  }
  // The haft sits on the palm side of the finger tips.
  expect(tool.position.z).toBeLessThan(hand.position.z + .05);
});
