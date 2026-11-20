import { expect, it } from "vitest";

import {
  claimNextDelivery, reconcileNextDelivery, releaseNextDelivery, takeNextDelivery
} from "../src/shared/settlement/settlement-land-transport-claims";
import type {
  SettlementActor, SettlementBuilding, SettlementContext
} from "../src/shared/settlement/settlement-types";

const fixture = () => {
  let tick = 0;
  const source = { uid: 1, typeId: 33, construction: 1, input: {}, output: { planks: 1 },
    inventory: {}, incoming: {}, accepts: {} } as unknown as SettlementBuilding;
  const target = { uid: 2, typeId: 29, construction: 1, input: {}, output: {},
    inventory: {}, incoming: {}, accepts: {} } as unknown as SettlementBuilding;
  const actor = (uid: number) => ({ uid, home: 0, job: "Carrier", phase: "deliveryTransfer",
    visible: true, ware: "logs", delivery: { source: 0, destination: 1, ware: "logs" },
    path: [], pathIndex: 0 } as unknown as SettlementActor);
  const first = actor(1), second = actor(2);
  const context = { actors: [first, second], buildings: [source, target],
    clock: { tick: () => tick }, transfers: [{ id: 0, source: 1, destination: 2, ware: "planks", count: 1 }] } as
    unknown as SettlementContext;
  const request = { source: 1, destination: 2, ware: "planks", units: 1, capacity: 1,
    mode: "carrier" as const, transferId: 0 };
  return { context, first, request, second, source, target, setTick: (value: number) => { tick = value; } };
};

it("claims the one next job once without paying, replacing cargo or double-booking stock", () => {
  const { context, first, request, second, source, target } = fixture();
  source.output.planks = 2;
  expect(claimNextDelivery(context, first, request)).toBe(true);
  expect(claimNextDelivery(context, second, request)).toBe(false);
  expect(source.output.planks).toBe(2);
  expect(first.ware).toBe("logs");
  expect(first.delivery!.ware).toBe("logs");
  expect(target.incoming.planks).toBe(1);
  releaseNextDelivery(context, first);
  releaseNextDelivery(context, first);
  expect(target.incoming.planks).toBe(0);
  expect(source.output.planks).toBe(2);
});

it("releases cancelled or expired next intentions without touching the current delivery", () => {
  for (const cause of ["cancel", "expire", "source"] as const) {
    const { context, first, request, setTick, source, target } = fixture();
    expect(claimNextDelivery(context, first, request)).toBe(true);
    if (cause === "cancel") context.transfers = [];
    if (cause === "expire") setTick(first.nextDelivery!.leaseDeadlineTick);
    if (cause === "source") context.buildings = [target];
    reconcileNextDelivery(context, first);
    expect(first.nextDelivery).toBeUndefined();
    expect(target.incoming.planks).toBe(0);
    expect(source.output.planks).toBe(1);
    expect(first.ware).toBe("logs");
    expect(first.delivery!.destination).toBe(1);
  }
});

it("revalidates missing source wares before handover without inventing a prepaid refund", () => {
  const { context, first, request, source, target } = fixture();
  expect(claimNextDelivery(context, first, request)).toBe(true);
  source.output.planks = 0;
  expect(takeNextDelivery(context, first, source.uid)).toBeUndefined();
  expect(target.incoming.planks).toBe(0);
  expect(source.inventory.planks).toBeUndefined();
  expect(first.ware).toBe("logs");
});
