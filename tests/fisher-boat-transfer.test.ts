import { Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";
import { boatTransferStockOffsetWeight, boatTransferTransform } from "../src/renderers/three/worker-boat-transfer";

it("turns a side pickup lengthwise above the head for every heading", () => {
  for (const yaw of [0, .4, Math.PI / 2, Math.PI, 5.7]) {
    const heading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const forward = new Vector3(0, 0, 1).applyQuaternion(heading);
    for (const lift of [0, .25, .5, .75, 1]) {
      const transform = boatTransferTransform(lift);
      const axis = new Vector3(0, 0, 1).applyQuaternion(transform.rotation).applyQuaternion(heading);
      axis.y = 0;
      if (lift === 0) expect(Math.abs(axis.normalize().dot(forward))).toBeLessThan(1e-6);
      if (lift === 1) expect(Math.abs(axis.normalize().dot(forward))).toBeCloseTo(1, 6);
      const reverse = boatTransferTransform(1 - (1 - lift));
      expect(reverse.gripAlong).toBeCloseTo(transform.gripAlong, 8);
      expect(Math.abs(reverse.rotation.dot(transform.rotation))).toBeCloseTo(1, 8);
    }
  }
});

it("keeps a stock handoff offset fixed until the grounded load is released", () => {
  for (const lift of [0, .1, .25, .4, .55]) expect(boatTransferStockOffsetWeight(lift)).toBe(1);
  expect(boatTransferStockOffsetWeight(1)).toBe(0);
  for (const lift of [.6, .75, .9])
    expect(boatTransferStockOffsetWeight(lift)).toBeCloseTo(boatTransferStockOffsetWeight(1 - (1 - lift)), 8);
});

it("keeps the carrier beside the side-lift instead of stepping through the hull", () => {
  for (const lift of [0,.1,.25,.4,.55,.75,1]) {
    expect(boatTransferTransform(lift).workerForward).toBe(0);
  }
});

it("balances the inverted hull over the head rather than holding it by its stern", () => {
  const pose = boatTransferTransform(1);
  expect(Math.abs(pose.center.z)).toBeLessThan(.2);
});
