import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import { deckPassengerPoses } from "../src/render-common/ships/ship-deck-passengers";
import { deckLookoutSlot } from "../src/render-common/ships/ship-deck-people";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import { shipDeckWorldPose } from "../src/render-common/ships/ship-motion";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { WorldData } from "../src/shared/world/world-data";

const world = (land?: { x: number; z: number }) => {
  const cellsX = 40, cellsZ = 40, heights = new Float32Array((cellsX + 1) * (cellsZ + 1)).fill(-2);
  if (land) heights[land.z * (cellsX + 1) + land.x] = 1;
  return { cellsX, cellsZ, heights, seaLevel: 0 } as unknown as WorldData;
};
const ship = (patch: Partial<ShipFrame> = {}) => ({
  cargoCount: 0, deckPassengers: 1, id: 1, passengers: [7], phase: "sailing",
  x: 20.5, y: -1, yaw: 0, z: 20.5, ...patch
}) as ShipFrame;

it("keeps a passenger on the drawn hull as the ship moves and bobs", () => {
  const still = deckPassengerPoses([ship()], world(), 3).get(7)!;
  const moved = deckPassengerPoses([ship({ x: 24.5 })], world(), 3).get(7)!;
  expect(moved.x - still.x).toBeCloseTo(4, 8);
  expect(moved.z).toBeCloseTo(still.z, 8);
  expect(still.y).toBeGreaterThan(-1);
});

it("faces the scout at the coast with the spyglass during an observation stop", () => {
  const shipFrame = ship({ exploration: { returning: false }, observing: true,
    observationSeconds: 2.5, phase: "unloading" });
  const observed = deckPassengerPoses([shipFrame], world({ x: 25, z: 20 }), 0).get(7)!;
  expect(observed.observing).toBe(true);
  expect(observed.observationSeconds).toBe(2.5);
  expect(observed.observingYaw).toBeCloseTo(Math.PI / 2, 8);
  // The single scout moves to the clear bow lookout while observing.
  const lookout = deckLookoutSlot();
  const pose = shipDeckWorldPose(shipFrame, lookout, 0);
  expect(observed.x).toBeCloseTo(pose.x, 8);
  expect(observed.z).toBeCloseTo(pose.z, 8);
});

it("leaves crates and other passengers without an observing pose untouched", () => {
  expect(deckPassengerPoses([ship({ passengers: [] })], world(), 0).size).toBe(0);
  const normal = deckPassengerPoses([ship()], world(), 0).get(7)!;
  expect(normal.observing).toBe(false);
  expect(normal.observingYaw).toBe(0);
});

it("poses the deck passenger exactly and plays the spyglass scan toward the island", () => {
  const template = { action: "idle_breathe", animationTime: 0, gaitPhase: 0, heading: 0,
    nation: "roman", runBlend: 0, selected: false, target: null, variant: "roman-man-white",
    visible: true, x: 0, y: 0, z: 0 } as WorkerFrame;
  const render = createSettlementRenderFrames([template]);
  const actor = { action: "idle", animationTime: 0, building: 1, home: 1, job: "Scout",
    path: [], pathIndex: 0, phase: "navalAboard", timer: 0, uid: 7, visible: true,
    ware: null, x: 0, y: 0, yaw: 0, z: 0 } as Parameters<typeof render.updateWorkers>[0][number];
  const pose = { observing: true, observationSeconds: 1.5, observingYaw: Math.PI / 2,
    x: 10, y: 2, yaw: 0, z: 12 };
  render.updateWorkers([actor], .05, [], 1, undefined, null, new Map([[7, pose]]));
  const frame = render.workers.find(candidate => candidate.actorId === 7)!;
  expect(frame).toMatchObject({ action: "spyglass_scan", animationTime: 1.5, heading: Math.PI / 2,
    x: 10, y: 2, z: 12 });
});
