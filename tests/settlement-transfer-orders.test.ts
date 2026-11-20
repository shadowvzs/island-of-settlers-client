import { expect, it } from "vitest";

import { queueWareTransfer } from "../src/shared/settlement/settlement-transfer-orders";
import type { SettlementTransferOrder } from "../src/shared/settlement/settlement-types";

const fixture = () => ({ buildings: [{ uid: 0 }, { uid: 1 }], nextTransferId: 0,
  transfers: [] as SettlementTransferOrder[] });

it("keeps identical manual requests distinct, including after removal and a full JSON boundary", () => {
  const context = fixture();
  expect(queueWareTransfer(context, 0, 1, "logs", 2)).toBe(true);
  expect(queueWareTransfer(context, 0, 1, "logs", 2)).toBe(true);
  expect(context.transfers.map(order => order.id)).toEqual([0, 1]);
  context.transfers.shift();
  const restored = JSON.parse(JSON.stringify(context)) as typeof context;
  expect(queueWareTransfer(restored, 0, 1, "logs", 2)).toBe(true);
  expect(restored.transfers.map(order => order.id)).toEqual([1, 2]);
  expect(restored.nextTransferId).toBe(3);
});

it("does not consume a queue identity or modify orders when a request is invalid", () => {
  const context = fixture(), before = structuredClone(context);
  for (const amount of [0, -1, NaN, Infinity]) expect(queueWareTransfer(context, 0, 1, "logs", amount)).toBe(false);
  expect(queueWareTransfer(context, 99, 1, "logs", 1)).toBe(false);
  expect(context).toStrictEqual(before);
});

it("accepts only stone manual supplies for a completed Catapult without changing construction deliveries", () => {
  const context = { ...fixture(), buildings: [{ uid: 0 },
    { uid: 1, typeId: 16, construction: 1, required: { planks: 3, stone: 4 } }] };
  const before = structuredClone(context);
  for (const ware of ["coins", "beer", "planks"])
    expect(queueWareTransfer(context, 0, 1, ware)).toBe(false);
  expect(context).toStrictEqual(before);
  expect(queueWareTransfer(context, 0, 1, "stone", 8)).toBe(true);
  context.buildings[1]!.construction = .5;
  expect(queueWareTransfer(context, 0, 1, "planks", 3)).toBe(true);
  expect(queueWareTransfer(context, 0, 1, "coins")).toBe(false);
});
