import { expect, it } from "vitest";

import type { ExplorationPose } from "../src/render-common/exploration/exploration-frame";
import { clampExplorationPose } from "../src/renderers/three/exploration/three-camera";

const rigPose = (changes: Partial<ExplorationPose> = {}): ExplorationPose => ({
  eyeBaseY: 2,
  eyeHeight: .9,
  fov: 65 * Math.PI / 180,
  mode: "eye",
  pitch: 0,
  x: 5,
  y: 2.9,
  yaw: 0,
  z: 5.1,
  ...changes
});

it("keeps the existing rig eye over its support on slopes despite the forward camera offset", () => {
  const pose = rigPose();
  const camera = clampExplorationPose(pose, { groundHeight: () => 2.2 });
  expect(camera.y).toBeCloseTo(pose.y);
  expect(camera.eyeBaseY).toBe(2);
  expect(camera.eyeHeight).toBe(.9);
  expect(camera.fov).toBeCloseTo(pose.fov);
});

it("preserves an existing rider or deck-supported body's actual support above the terrain", () => {
  const camera = clampExplorationPose(rigPose({ eyeBaseY: 3, y: 3.9 }), { groundHeight: () => 0 });
  expect(camera.y).toBeCloseTo(3.9);
});

it("retains the local terrain clearance when an eye offset meets higher ground", () => {
  const camera = clampExplorationPose(rigPose(), { groundHeight: () => 2.8 });
  expect(camera.y).toBeCloseTo(3.2);
});

it.each([undefined, NaN, Infinity, -Infinity])("keeps ordinary ground-relative eyes for invalid base %s", eyeBaseY => {
  const camera = clampExplorationPose(rigPose({ eyeBaseY }), { groundHeight: () => 2.2 });
  expect(camera.y).toBeCloseTo(3.1);
  expect(camera.eyeBaseY).toBeUndefined();
});
