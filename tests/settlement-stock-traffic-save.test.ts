import { expect, it } from "vitest";

import { ownsStockCourt, restoreStockTraffic, saveStockTraffic } from "../src/shared/settlement/settlement-stock-traffic";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { validateStockTraffic } from "../src/shared/settlement/settlement-stock-traffic-save";

const actors = [{ uid: 0, stockBuilding: 0, phase: "pickupStockWalk" }, { uid: 1, stockBuilding: 0, phase: "deliveryStockWalk" }];
const buildings = [{ uid: 0 }];
const receipt = () => ({ clock: 20, owners: [{ building: 0, actor: 0,
  watch: { elapsed: 1.5, point: { x: 2, z: 3 }, goal: { x: 3, z: 3 }, yielded: false } }],
actors: [{ actor: 1, phase: "deliveryStockWalk", cooldown: 21, queued: { building: 0, phase: "deliveryStockWalk", since: 15 },
  entry: { rival: 0, since: 18 } }] });

it("preserves valid zero-UID home courts, FIFO ages and watcher timing", () => {
  expect(validateStockTraffic(receipt(), actors, buildings)).toBeNull();
  expect(validateStockTraffic(undefined, actors, buildings)).toBeNull();
});
it.each(["owner", "rival", "court", "task", "future", "clock", "duplicate"])("rejects malformed %s receipts", kind => {
  const saved = receipt();
  if (kind === "owner") saved.owners[0]!.actor = 90;
  if (kind === "rival") saved.actors[0]!.entry.rival = 90;
  if (kind === "court") saved.owners[0]!.building = 90;
  if (kind === "task") saved.actors[0]!.phase = "wrong-task";
  if (kind === "future") saved.actors[0]!.queued.since = 21;
  if (kind === "clock") saved.clock = -1;
  if (kind === "duplicate") saved.owners.push(saved.owners[0]!);
  expect(validateStockTraffic(saved, actors, buildings)).toBe("Invalid stock-court traffic receipts");
});

it("retains an inactive miller's court lease that becomes valid again when work turns to output walking", () => {
  const worker = { uid: 0, job: "Miller", phase: "work", stockBuilding: 0, visible: false, x: 2, z: 2 };
  const site = { uid: 0, x: 2, z: 2, width: 4, depth: 4 };
  const live = { actors: [worker], buildings: [site] } as unknown as SettlementContext;
  restoreStockTraffic(live, { clock: 0, owners: [{ building: 0, actor: 0 }], actors: [] });
  const captured = saveStockTraffic(live);
  expect(captured.owners).toHaveLength(1);
  const person = structuredClone(worker), cold = { actors: [person], buildings: [site] } as unknown as SettlementContext;
  restoreStockTraffic(cold, captured);
  worker.phase = "outputWalk"; person.phase = "outputWalk";
  expect(ownsStockCourt(live, live.actors[0]!)).toBe(true);
  expect(ownsStockCourt(cold, cold.actors[0]!)).toBe(true);
});
