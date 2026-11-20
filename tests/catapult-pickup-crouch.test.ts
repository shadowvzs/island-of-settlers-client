import { Vector3 } from "three";
import { expect, it } from "vitest";

import { CATAPULT_CARRY_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { catapultPickupCrouch } from "../src/renderers/three/catapult-pickup-crouch";
import { smoothstep01 } from "../src/shared/world/noise";

it("adds physical mid-lift shoulder reach without deepening the original maximum floor crouch", () => {
  for (let step = 0; step <= 100; step++) {
    const progress = step / 100;
    const reach = smoothstep01(progress / .3) * (1 - smoothstep01((progress - .4) / .55));
    const crouch = catapultPickupCrouch(reach, progress, true);
    expect(crouch).toBeGreaterThanOrEqual(.4 * reach);
    expect(crouch).toBeLessThanOrEqual(.4);
    if (progress <= .4 || progress >= .95) expect(crouch).toBe(.4 * reach);
    expect(catapultPickupCrouch(reach, progress, false)).toBe(.4 * reach);
  }
  // The actual failed native sample is about p=.625, with a 23.694mm anatomical reach deficit.
  const progress = .625, reach = 1 - smoothstep01((progress - .4) / .55);
  expect(catapultPickupCrouch(reach, progress, true) - .4 * reach).toBeGreaterThan(.03);
});

it("keeps the late-lift chest endpoint reachable for the recorded shortest left-arm rig", () => {
  const shoulder = new Vector3(60.78204884099863, 5.6458264197037344, 74.0812753649002);
  const desiredWrist = new Vector3(60.88329788907907, 5.472998512955454, 74.28491687070029);
  const armLength = .2750510291065473;
  expect(shoulder.distanceTo(desiredWrist)).toBeGreaterThan(armLength + .01);
  desiredWrist.y += (CATAPULT_CARRY_HEIGHT - .86) * WORKER_SCALE;
  expect(shoulder.distanceTo(desiredWrist)).toBeLessThan(armLength * .99);
});

it("makes the recorded native mid-lift wrist target anatomically reachable without extending arm bones", () => {
  const shoulder = new Vector3(60.83787799998725, 5.406581549692247, 74.24513757180182);
  const desiredWrist = new Vector3(60.900389240756766, 5.138366723371689, 74.36090472827166);
  const armLength = .13398953530814162 + .14106149390009767;
  expect(shoulder.distanceTo(desiredWrist)).toBeGreaterThan(armLength + .023);
  const progress = .625, reach = 1 - smoothstep01((progress - .4) / .55);
  shoulder.y -= catapultPickupCrouch(reach, progress, true) - .4 * reach;
  expect(shoulder.distanceTo(desiredWrist)).toBeLessThan(armLength * .99);
});
