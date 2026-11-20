import { expect, it } from "vitest";

import {
  canPromiseUnloadingHandcart, canPromiseWalkingCarrier, canReuseReturningHandcart, canReuseWalkingCarrier
} from "../src/shared/settlement/settlement-land-transport-reuse";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const carrier = (extra: Partial<SettlementActor> = {}) => ({
  uid: 7, home: 0, building: 2, job: "Carrier", phase: "home", visible: true, ware: null,
  ...extra
} as SettlementActor);

it("reuses empty returns and excludes cargo, mandatory duties and ordinary production workers", () => {
  expect(canReuseWalkingCarrier(carrier())).toBe(true);
  for (const extra of [
    { job: "Woodcutter" }, { visible: false }, { phase: "enterHome" }, { ware: "logs" },
    { navigationReturnCargo: true }, { navalOrder: 1 },
    { tool: "axe" }, { consumed: { planks: 1 } }, { demolitionReturning: true },
    { delivery: { source: 1, destination: 2, ware: "logs" } }
  ]) expect(canReuseWalkingCarrier(carrier(extra))).toBe(false);
});

it("claims an unloading person only for the actual next source and keeps its current cargo", () => {
  const actor = carrier({ phase: "deliveryTransfer", ware: "logs",
    delivery: { source: 0, destination: 2, ware: "logs" } });
  const before = structuredClone(actor);
  expect(canPromiseWalkingCarrier(actor, 2)).toBe(true);
  expect(canPromiseWalkingCarrier(actor, 3)).toBe(false);
  expect(canReuseWalkingCarrier(actor)).toBe(false);
  expect(actor).toEqual(before);
});

it("distinguishes an empty returning cart from an unloading or loaded cart", () => {
  const actor = carrier({ phase: "cartReturn", handcart: { cargo: 0, owner: 0, state: "hitched" } });
  expect(canReuseReturningHandcart(actor)).toBe(true);
  expect(canReuseWalkingCarrier(actor)).toBe(false);
  actor.handcart!.trip = { source: 0, destination: 2, ware: "logs", planned: 2, loaded: 2,
    delivered: 0, prepaid: 0 };
  actor.handcart!.cargo = 2;
  actor.phase = "cartUnloading";
  const before = structuredClone(actor);
  expect(canReuseReturningHandcart(actor)).toBe(false);
  expect(canPromiseUnloadingHandcart(actor, 2)).toBe(true);
  expect(canPromiseUnloadingHandcart(actor, 3)).toBe(false);
  expect(actor).toEqual(before);
});
