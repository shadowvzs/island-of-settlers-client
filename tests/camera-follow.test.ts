import { expect, it } from "vitest";

import { createCameraFollow, type ObservationSubject } from "../src/app/camera-follow";
import { observeShip } from "../src/app/observation-subjects";
import { createCamera } from "../src/render-common/camera-state";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import {
  actorIncarnation,
  renewActorIncarnation
} from "../src/shared/settlement/actor-incarnation";

it("follows one moving subject while preserving zoom/angle and stopping for manual camera changes", () => {
  const camera = createCamera(10, 10, 1),
    follower = createCameraFollow(camera, [64, 64]);
  const target = { identity: {}, label: "Carrier", detail: "Walking", x: 20, y: 0, z: 20 };
  follower.inspect(() => target);
  follower.follow();
  follower.update(0.05);
  expect(camera.centerX).toBeGreaterThan(10);
  expect(camera.zoom).toBe(1);
  expect(camera.yaw).toBe(0);
  camera.centerX = 5;
  follower.update(0.05);
  expect(follower.following()).toBe(false);
  expect(camera.centerX).toBe(5);
});

it("clears a vanished or reused actor even when object and UID remain the same", () => {
  const actor = {},
    camera = createCamera(10, 10, 1),
    follower = createCameraFollow(camera, [64, 64]);
  const resolve = (): ObservationSubject => ({
    identity: actorIncarnation(actor),
    label: "Carrier",
    detail: "Walking",
    x: 20,
    y: 0,
    z: 20
  });
  follower.inspect(resolve);
  follower.follow();
  renewActorIncarnation(actor);
  follower.update(0.05);
  expect(follower.subject()).toBeNull();
  expect(follower.following()).toBe(false);
  let visible = true;
  follower.inspect(() => (visible ? resolve() : null));
  follower.follow();
  visible = false;
  follower.update(0.05);
  expect(follower.following()).toBe(false);
});

it("does no resolution work while inactive and rejects invalid target coordinates", () => {
  const follower = createCameraFollow(createCamera(10, 10, 1), [64, 64]);
  let reads = 0;
  follower.update(0.05);
  expect(reads).toBe(0);
  follower.inspect(() => {
    reads++;
    return { identity: {}, label: "Ship", detail: "At sea", x: NaN, y: 0, z: 2 };
  });
  expect(follower.follow()).toBe(false);
});

it("uses existing ship render positions and ends follow when the ship sails beyond the island", () => {
  const ship: ShipFrame = { cargoCount: 5, id: 3, phase: "sailing", x: 20, y: -1, yaw: 0, z: 20 };
  const follower = createCameraFollow(createCamera(10, 10, 1), [64, 64]);
  follower.inspect(observeShip("3", "Ship 3", () => [ship]));
  follower.follow();
  expect(follower.subject()?.label).toBe("Ship 3");
  ship.phase = "away";
  follower.update(0.05);
  expect(follower.following()).toBe(false);
});

it("keeps both mission ships followable through loading, founding and returning, and stops manually", () => {
  const scout: ShipFrame = { cargoCount: 1, id: 8, phase: "sailing", x: 14, y: -1, yaw: 0, z: 20 };
  const founder: ShipFrame = { cargoCount: 3, id: 9, phase: "loading", x: 20, y: -1, yaw: 0, z: 20 };
  const frames = [scout, founder];
  const camera = createCamera(10, 10, 1);
  const follower = createCameraFollow(camera, [64, 64]);
  follower.inspect(observeShip("8", "Scout ship", () => frames));
  expect(follower.follow()).toBe(true);
  for (const phase of ["sailing", "unloading"] as const) {
    scout.phase = phase;
    follower.update(0.05);
    expect(follower.following(), `scout ${phase}`).toBe(true);
  }
  follower.inspect(observeShip("9", "Founding ship", () => frames));
  expect(follower.follow()).toBe(true);
  for (const phase of ["sailing", "unloading", "founding"] as const) {
    founder.phase = phase;
    follower.update(0.05);
    expect(follower.following(), `founder ${phase}`).toBe(true);
  }
  const x = camera.centerX;
  follower.stop();
  founder.x = 40;
  follower.update(0.05);
  expect(follower.following()).toBe(false);
  expect(camera.centerX).toBe(x);
});
