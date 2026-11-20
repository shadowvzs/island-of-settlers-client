import assert from "node:assert/strict";
import { expect, it } from "vitest";

import { sailArc, type ShipPose, swingAbout } from "../src/shared/settlement/settlement-ship-kinematics";
import { createShipMotionTemplates } from "../src/shared/settlement/settlement-ship-motion-templates";
import { createShipTrigMemo } from "../src/shared/settlement/settlement-ship-trigonometry";

it("retains independent intermediate poses and the exact cached end across later samples and moves", () => {
  const templates = createShipMotionTemplates();
  const calculate = (origin: ShipPose, index: number) => sailArc(origin, (index + 1) / 4, .1 * (index + 1));
  const pose = { x: 7.25, z: -2.5, yaw: -.217 };
  const move = templates(pose, 0, 4, calculate);
  const held = [move.sampleAt(0), move.sampleAt(1), move.sampleAt(2), move.sampleAt(3)];
  const snapshots = held.map(point => ({ ...point }));
  assert.strictEqual(held[3], move.end);
  assert.strictEqual(move.sampleAt(3), move.end);
  assert.notStrictEqual(move.sampleAt(0), held[0]);
  // A consumer may retain or mutate an earlier sample; later sampling must not alias it.
  move.sampleAt(0).x = 1e9;
  for (let index = 0; index < 4; index++) move.sampleAt(index);
  const other = templates({ x: -9, z: 21, yaw: pose.yaw }, 0, 4, calculate);
  for (let index = 0; index < 4; index++) other.sampleAt(index);
  assert.deepStrictEqual(held, snapshots);
  assert.notStrictEqual(other.end, move.end);
  assert.strictEqual(move.sampleAt(3), move.end);
});

it("keeps every original arc and swing sample exactly, including zero signs and last-sample rounding", () => {
  const templates = createShipMotionTemplates(), trig = createShipTrigMemo();
  const positions = [{ x: 0, z: 0 }, { x: -0, z: -0 }, { x: -0, z: 0 },
    { x: -64.25, z: 127.125 }, { x: 1e-280, z: -1e-280 },
    { x: 65535.999999, z: -120.1 }, { x: -(2 ** 45), z: 2 ** 45 }];
  const headings = [-0, 0, ...Array.from({ length: 17 }, (_, index) => index * Math.PI / 8 + 1e-12), Math.PI];
  for (const yaw of headings) for (const position of positions) {
    const pose = { ...position, yaw };
    let moveId = 0;
    for (const direction of [1, -1]) for (const curvature of [0, 1 / 3, -1 / 3]) {
      const count = Math.ceil((1 + 4.4 * Math.abs(curvature)) / .2);
      const calculate = (origin: ShipPose, index: number) => {
        const distance = (index + 1) / count;
        return sailArc(origin, direction * distance, distance * curvature * direction, trig);
      };
      const cached = templates(pose, moveId++, count, calculate);
      const distance = count / count;
      const end = sailArc(pose, direction * distance, distance * curvature * direction, trig);
      assert.deepStrictEqual(cached.end, end);
      assert.strictEqual(cached.sampleAt(count - 1), cached.end);
      for (let index = 0; index < count; index++) assert.deepStrictEqual(cached.sampleAt(index), calculate(pose, index));
    }
    for (const pivot of [0, 4.4, -4.4]) for (const turn of [Math.PI / 8, -Math.PI / 8]) {
      const count = Math.ceil((Math.abs(pivot) + 4.4) * Math.abs(turn) / .2);
      const calculate = (origin: ShipPose, index: number) => swingAbout(origin, pivot, turn * (index + 1) / count, trig);
      const cached = templates(pose, moveId++, count, calculate);
      assert.deepStrictEqual(cached.end, swingAbout(pose, pivot, turn * count / count, trig));
      for (let index = 0; index < count; index++) assert.deepStrictEqual(cached.sampleAt(index), calculate(pose, index));
    }
  }
});

it("only computes requested samples, reuses geometry across positions and replaces a changed sample count", () => {
  const templates = createShipMotionTemplates();
  let calls = 0;
  const calculate = (origin: ShipPose, index: number) => { calls++; return sailArc(origin, index + 1, .1); };
  const first = templates({ x: 10, z: 20, yaw: .3 }, 0, 4, calculate);
  expect(calls).toBe(1);
  first.sampleAt(0);
  expect(calls).toBe(2);
  const elsewhere = templates({ x: -5, z: 30, yaw: .3 }, 0, 4, calculate);
  expect(calls).toBe(2);
  assert.deepStrictEqual(elsewhere.sampleAt(0), sailArc({ x: -5, z: 30, yaw: .3 }, 1, .1));
  expect(calls).toBe(2);
  templates({ x: -5, z: 30, yaw: .3 }, 0, 3, calculate);
  expect(calls).toBe(3);
  assert.deepStrictEqual(first.sampleAt(0), sailArc({ x: 10, z: 20, yaw: .3 }, 1, .1));
});
