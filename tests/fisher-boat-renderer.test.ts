import { Group, InstancedMesh } from "three";
import { expect, it, vi } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createThreeFishingBoats } from "../src/renderers/three/settlement/three-fishing-boats";

it("removes hauled fish on a state switch and detaches the whole skiff on disposal", () => {
  const scene = new Group(), boats = createThreeFishingBoats(false);
  scene.add(boats.group);
  const frame = { id: 1, person: 1, crewed: true, rowing: false, net: .85, x: 0, y: 0, z: 0, yaw: 0 };
  boats.update([frame], 0);
  const fish = boats.group.getObjectByName("fishing_skiff_catch") as InstancedMesh;
  expect(fish.count).toBe(4);
  boats.update([{ ...frame, crewed: false, net: undefined }], 1);
  expect(fish.count).toBe(0);
  expect(fish.visible).toBe(false);
  boats.update([{ ...frame, crewed: false, net: undefined,
    handling: { kind: "launch", progress: .5 } }], 1);
  const handling = boats.handlingPose(frame.person);
  expect(handling?.hands).toHaveLength(2);
  expect(handling!.hands[0].distanceTo(handling!.hands[1])).toBeCloseTo(.3);
  boats.update([{ ...frame, crewed: false, net: undefined }], 1);
  expect(boats.handlingPose(frame.person)).toBeUndefined();
  boats.dispose();
  expect(boats.group.parent).toBeNull();
});

it("keeps the shore worker's appearance when the rower takes over and clears it for another worker", () => {
  const update = vi.fn();
  const people = { create: () => ({ update, dispose: () => {}, handWorld: () => undefined }) };
  const boats = createThreeFishingBoats(false, people as unknown as Parameters<typeof createThreeFishingBoats>[1]);
  const frame = { id: 1, person: 42, crewed: false, rowing: false, x: 0, y: 0, z: 0, yaw: 0,
    handling: { kind: "launch" as const, progress: .5 } };
  const worker = { actorId: 42, nation: "roman", variant: "roman-man-grey" };
  boats.update([frame], 0, false, [worker as WorkerFrame]);
  expect(update.mock.lastCall?.[0].appearance).toEqual({ nation: "roman", variant: "roman-man-grey" });
  boats.update([{ ...frame, crewed: true, handling: undefined }], 1);
  expect(update.mock.lastCall?.[0].appearance).toEqual({ nation: "roman", variant: "roman-man-grey" });
  boats.update([{ ...frame, person: 43 }], 2);
  expect(update.mock.lastCall?.[0].appearance).toBeUndefined();
  boats.dispose();
});

it("seats the fisher toward the bow and keeps each hand on its own side's oar through boarding", () => {
  const update = vi.fn();
  const people = { create: () => ({ update, dispose: () => {}, handWorld: () => undefined }) };
  const boats = createThreeFishingBoats(false, people as unknown as Parameters<typeof createThreeFishingBoats>[1]);
  const frame = { id: 1, person: 42, crewed: true, rowing: true, x: 0, y: 0, z: 0, yaw: .7 };
  for (const time of [0, .45, .9, 1.35]) {
    boats.update([frame], time);
    const seated = update.mock.lastCall![0];
    expect(seated.facing).toBe(0);
    expect(seated.grips[0].point.x).toBeGreaterThan(0);
    expect(seated.grips[1].point.x).toBeLessThan(0);
    expect(seated.grips[0].point.z).toBeGreaterThan(seated.seat.z);
    expect(seated.grips[1].point.z).toBeGreaterThan(seated.seat.z);
  }
  boats.update([{ ...frame, crewed: false, rowing: false, handling: { kind: "launch", progress: .8 } }], 0);
  expect(boats.handlingPose(42)!.boarding.facing).toBe(frame.yaw);
  boats.dispose();
});

it("starts a yard lift at the exact visible hull pose across nations and headings", async () => {
  const { Vector3 } = await import("three");
  const { fisheryYardSkiffAnchor } = await import("../src/render-common/ships/fishing-skiff-yard");
  const { yardBoatWorldPose } = await import("../src/renderers/three/worker-boat-transfer");
  const { FISHING_SKIFF_RIM_HEIGHT } = await import("../src/render-common/ships/fishing-skiff-stow");
  const boats = createThreeFishingBoats(false);
  for (const nation of ["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"] as const)
    for (const rotation of [0, 1, 2, 3]) {
      const anchor = { ...fisheryYardSkiffAnchor(nation, { x: 10, z: 10, rotation }), y: 1.25 };
      boats.update([{ ...anchor, id: 1, person: 1, nation, stowed: true, crewed: false, rowing: false }], 0);
      boats.group.updateMatrixWorld(true);
      const root = boats.group.getObjectByName(`fishing_skiff_${nation}`)!;
      const hull = root.children.find(node => (node as import("three").Mesh).isMesh) as import("three").Mesh;
      const pose = yardBoatWorldPose(anchor), positions = hull.geometry.attributes.position!;
      for (let index = 0; index < positions.count; index += 7) {
        const vertex = new Vector3().fromBufferAttribute(positions, index);
        const expected = vertex.clone().applyMatrix4(hull.matrixWorld);
        const held = vertex.multiply(hull.scale).sub(new Vector3(0, FISHING_SKIFF_RIM_HEIGHT, 0))
          .applyQuaternion(pose.rotation).add(pose.center);
        expect(held.distanceTo(expected)).toBeLessThan(1e-6);
      }
    }
  boats.dispose();
});

it("starts a dropped-hull lift at its visible pose with the keel on the ground", async () => {
  const { Quaternion, Vector3 } = await import("three");
  const { groundSkiffPickup } = await import("../src/render-common/ships/fishing-skiff-yard");
  const { FISHING_SKIFF_KEEL_DEPTH } = await import("../src/render-common/ships/fishing-skiff-dimensions");
  const { FISHING_SKIFF_RIM_HEIGHT } = await import("../src/render-common/ships/fishing-skiff-stow");
  const { WORKER_SCALE } = await import("../src/render-common/workers/worker-dimensions");
  const { boatTransferTransform } = await import("../src/renderers/three/worker-boat-transfer");
  const boats = createThreeFishingBoats(false), groundY = 1.25;
  for (const nation of ["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"] as const)
    for (const yaw of [0, .7, Math.PI / 2, Math.PI]) {
      const frame = { x: 10, y: groundY + FISHING_SKIFF_KEEL_DEPTH, z: 10, yaw, nation,
        id: 1, person: 1, crewed: false, rowing: false };
      boats.update([frame], 0); boats.group.updateMatrixWorld(true);
      const root = boats.group.getObjectByName(`fishing_skiff_${nation}`)!;
      const hull = root.children.find(node => (node as import("three").Mesh).isMesh) as import("three").Mesh;
      const pickup = groundSkiffPickup(frame), pose = boatTransferTransform(0);
      const heading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pickup.yaw);
      const positions = hull.geometry.attributes.position!;
      for (let index = 0; index < positions.count; index += 7) {
        const vertex = new Vector3().fromBufferAttribute(positions, index);
        const expected = vertex.clone().applyMatrix4(hull.matrixWorld);
        const held = vertex.multiply(hull.scale).sub(new Vector3(0, FISHING_SKIFF_RIM_HEIGHT, 0))
          .applyQuaternion(pose.rotation).add(pose.center.clone().multiplyScalar(WORKER_SCALE))
          .applyQuaternion(heading).add(new Vector3(pickup.x, groundY, pickup.z));
        expect(held.distanceTo(expected)).toBeLessThan(1e-6);
      }
    }
  boats.dispose();
});
