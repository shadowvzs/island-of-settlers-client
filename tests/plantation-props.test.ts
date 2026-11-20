import { Group, Object3D } from "three";
import { expect, it } from "vitest";

import { createHeldGrapeBunchMesh } from "../src/render-common/props/drink-crops/grapevine-mesh";
import { plantationPropWeight } from "../src/render-common/workers/plantation-prop-cycle";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import {
  plantationHandPose,
  recordPlantationHands
} from "../src/renderers/three/worker-plantation-contact";

it("picks up and releases props within their clips, repeats deterministically and never creates cargo", () => {
  for (const action of ["lift_honeycomb", "pick_grapes"]) {
    expect(plantationPropWeight(action, 0)).toBe(0);
    expect(plantationPropWeight(action, 2.8 * 0.5)).toBe(1);
    expect(plantationPropWeight(action, 2.8 * 0.9)).toBe(0);
    expect(plantationPropWeight(action, 2.8 * 1.5)).toBeCloseTo(1);
    expect(plantationPropWeight(action, NaN)).toBe(0);
    expect(plantationPropWeight(action, -1)).toBe(0);
  }
  expect(plantationPropWeight("walk", 1.4)).toBe(0);
});

it("uses actual world hand sockets and rejects a previous frame's or field's pose", () => {
  const root = new Group(),
    parent = new Group(),
    left = new Object3D(),
    right = new Object3D();
  parent.position.set(10, 2, 20);
  parent.add(root);
  left.name = "socket_hand_L";
  right.name = "socket_hand_R";
  left.position.set(-0.1, 0.5, 0.3);
  right.position.set(0.1, 0.5, 0.3);
  root.add(left, right);
  const frame = {
    plantationSiteId: 9,
    action: "lift_honeycomb",
    animationTime: 1.4,
    carryingWare: null,
    visible: true
  } as WorkerFrame;
  recordPlantationHands(root, frame);
  expect(plantationHandPose(frame)!.position.toArray()).toEqual([10, 2.5, 20.3]);
  frame.animationTime = 1.5;
  expect(plantationHandPose(frame)).toBeNull();
  recordPlantationHands(root, frame);
  frame.plantationSiteId = 10;
  expect(plantationHandPose(frame)).toBeNull();
  expect(frame.carryingWare).toBeNull();
});

it("authors one cheap grape bunch for each quality instead of copying the whole vineyard", () => {
  for (const detailed of [true, false]) {
    const mesh = createHeldGrapeBunchMesh(detailed);
    expect(mesh.indices.length / 3).toBeLessThan(1000);
    expect([...mesh.positions, ...mesh.colors].every(Number.isFinite)).toBe(true);
    const xs = Array.from(mesh.positions).filter((_, index) => index % 3 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.15);
  }
});
