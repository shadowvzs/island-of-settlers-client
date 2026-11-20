import { expect, it } from "vitest";

import { createCameraFollow } from "../src/app/camera-follow";
import { createShipObservation } from "../src/app/ship-observation";
import { createCamera } from "../src/render-common/camera-state";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";

it("toggles follow for the selected friendly ship without affecting another followed subject", () => {
  const follower = createCameraFollow(createCamera(10, 10, 1), [64, 64]);
  const ship: ShipFrame = { id: 1, phase: "sailing", cargoCount: 2, x: 20, y: -1, z: 20, yaw: 0 };
  let snapshots = 0;
  const controls = createShipObservation({
    follower,
    frames: () => [ship],
    name: () => {
      snapshots++;
      return "Ship";
    },
    follow: (resolve) => {
      follower.inspect(resolve);
      return follower.follow();
    }
  });
  expect(controls.canFollow("1")).toBe(true);
  expect(snapshots).toBe(0);
  controls.toggle("1");
  expect(controls.isFollowing("1")).toBe(true);
  expect(snapshots).toBe(1);
  controls.stop("2");
  expect(follower.following()).toBe(true);
  controls.toggle("1");
  expect(follower.following()).toBe(false);
  ship.phase = "away";
  controls.toggle("1");
  expect(follower.following()).toBe(false);
  ship.phase = "sailing";
  ship.livery = "enemy";
  expect(controls.canFollow("1")).toBe(false);
  expect(snapshots).toBe(1);
});
