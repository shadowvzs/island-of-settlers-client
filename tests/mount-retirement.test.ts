import { expect, it } from "vitest";

import {
  createMountRetirementGrace,
  MOUNT_RETIREMENT_FRAMES
} from "../src/renderers/three/mount-retirement";

it("retires a missing mounted instance only after the 180-frame grace period", () => {
  const grace = createMountRetirementGrace();
  expect(MOUNT_RETIREMENT_FRAMES).toBe(180);
  for (let frame = 0; frame < MOUNT_RETIREMENT_FRAMES; frame++)
    expect(grace.missing(7)).toBe(false);
  expect(grace.missing(7)).toBe(true);
  // The retired id can be reused by a new actor without inheriting the old age.
  expect(grace.missing(7)).toBe(false);
});

it("resets the grace when the mount is drawn again", () => {
  const grace = createMountRetirementGrace(2);
  expect(grace.missing(3)).toBe(false);
  expect(grace.missing(3)).toBe(false);
  grace.seen(3);
  expect(grace.missing(3)).toBe(false);
  expect(grace.missing(3)).toBe(false);
  expect(grace.missing(3)).toBe(true);
});
