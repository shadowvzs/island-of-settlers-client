import { expect, it } from "vitest";

import { createMilitaryMountPoints } from "../src/shared/settlement/military-mount-points";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** Battle AI plan Phase 2: riders leaving one door mount at a fan of distinct places. */
const SIZE = 40;
const world = { seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 5.5, z: 5.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
} as unknown as WorldData;

const rider = (uid: number) => ({ uid, x: 20.5, z: 21.5, mounted: true, phase: "militaryLeaving",
  visible: true } as SettlementActor);

it("gives riders leaving one door distinct mounting places at least 2.2 tiles apart, released after 3 s", () => {
  const riders = [1, 2, 3, 4, 5, 6].map(rider);
  const context = { options: { world }, actors: riders, buildings: [], occupied: new Uint8Array(SIZE * SIZE),
    reservations: new Set() } as unknown as SettlementContext;
  const door = { access: { x: 20.5, z: 22.5 }, workerApproach: { x: 20.5, z: 21.5 } } as SettlementBuilding;
  const mounts = createMilitaryMountPoints(context);
  const points = riders.map(actor => mounts.choose(actor, door, door.access)?.point);
  expect(points.every(Boolean)).toBe(true);
  for (const [index, point] of points.entries()) for (const other of points.slice(index + 1))
    expect(Math.hypot(point!.x - other!.x, point!.z - other!.z)).toBeGreaterThanOrEqual(2.2 - 1e-9);
  // The first place lies straight out of the door, the fan opens from there.
  expect(points[0]!.z).toBeGreaterThan(door.access.z);
  mounts.update(3);
  expect(mounts.choose(rider(7), door, door.access)?.point).toEqual(points[0]);
});
