import { expect, it } from "vitest";

import { captureStorageTraffic, resumeStorageTraffic } from "../src/shared/settlement/settlement-door-traffic-persistence";
import { validateStorageTraffic } from "../src/shared/settlement/settlement-door-traffic-save";
import { createTransientMap } from "../src/shared/settlement/settlement-transient-state";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const actor = (): SettlementActor => ({ uid: 0, job: "Carrier", phase: "deliver", home: 0, building: 0,
  x: 3, y: 0, z: 4, yaw: 0, visible: true, action: "walk", ware: "logs", path: [], pathIndex: 0,
  timer: 0, animationTime: 0 });
const caches = (): Parameters<typeof captureStorageTraffic>[1] => ({
  clocks: createTransientMap(), parkingBudgets: createTransientMap(), arrivalSerial: createTransientMap(),
  owners: createTransientMap(), ownerIdentities: new WeakMap(), queueIdentities: new WeakMap(),
  waiting: new WeakMap(), parkingPaths: new WeakMap(), staged: new WeakSet(),
  numericQueueCaches: { registeredAt: new WeakMap(), deferred: new WeakMap(), deferredRetries: new WeakMap(),
    failedEntries: new WeakMap(), retries: new WeakMap(), queueCursor: new WeakMap() }, watchStorageTurn: () => undefined
});
it("retains the presence of a recycled actor's stale identity until its next real queue registration", () => {
  const person = actor(), first = { actors: [person], buildings: [] } as unknown as SettlementContext;
  const live = caches(); live.queueIdentities.set(person, {});
  const receipt = captureStorageTraffic(first, live);
  expect(receipt.actors).toHaveLength(1);
  expect(receipt.actors[0]!.identityCurrent).toBe(false);
  const restored = { actors: [structuredClone(person)], buildings: [] } as unknown as SettlementContext;
  const cold = caches(); resumeStorageTraffic(restored, cold, receipt);
  expect(captureStorageTraffic(restored, cold)).toEqual(receipt);
});
const valid = () => ({ clock: 10, parkingBudget: 4, arrivalSerial: 4, watchOrder: ["door:0"],
  owners: [{ building: 0, actor: 0, identityCurrent: true }],
  actors: [{ actor: 0, phase: "deliver", home: 0, identityCurrent: true, identityKnown: true, staged: true,
    registeredAt: 2, waiting: { x: 3, z: 4 }, parkingPath: [{ x: 4, z: 4 }] }], departures: [] });
it("accepts valid zero-UID storage leases, exact queue clocks and selected parking routes", () => {
  expect(validateStorageTraffic(valid(), [actor()], [{ uid: 0, typeId: 0 }])).toBeNull();
  expect(validateStorageTraffic(undefined, [actor()], [{ uid: 0, typeId: 0 }])).toBeNull();
});
it("ignores door receipts for actors removed before restore", () => {
  const restored = { actors: [], buildings: [{ uid: 0, typeId: 0 }] } as unknown as SettlementContext;
  const cold = caches();
  expect(() => resumeStorageTraffic(restored, cold, valid())).not.toThrow();
  expect(captureStorageTraffic(restored, cold).actors).toEqual([]);
});
it.each(["owner", "task", "future", "budget", "duplicate", "path"])("rejects forged storage %s state", kind => {
  const receipt = valid();
  if (kind === "owner") receipt.owners[0]!.actor = 90;
  if (kind === "task") receipt.actors[0]!.phase = "work";
  if (kind === "future") receipt.actors[0]!.registeredAt = 11;
  if (kind === "budget") receipt.parkingBudget = 5;
  if (kind === "duplicate") receipt.watchOrder.push("door:0");
  if (kind === "path") receipt.actors[0]!.parkingPath[0]!.x = NaN;
  expect(validateStorageTraffic(receipt, [actor()], [{ uid: 0, typeId: 0 }])).toBe("Invalid storage-door traffic receipts");
});
