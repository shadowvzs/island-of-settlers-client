import { expect, it } from "vitest";

import { validateNextDelivery, validateTransferOrderClaims } from "../src/shared/settlement/transport-reuse-save";

const ids = new Set([0, 1, 2]);
const fixture = () => ({ uid: 0, job: "Carrier", ware: "cloth", home: 1,
  delivery: { source: 1, destination: 0, ware: "cloth" },
  nextDelivery: { source: 0, destination: 2, ware: "logs", units: 1, mode: "carrier",
    transferId: 0, leaseStartedTick: 0, leaseDeadlineTick: 6000 } });

it("retains an unload-linked next-job intent through JSON without treating current cargo as next cargo", () => {
  const actor = fixture(), before = structuredClone(actor);
  expect(validateNextDelivery(JSON.parse(JSON.stringify(actor)), ids, 0)).toBeNull();
  expect(validateNextDelivery(actor, ids, 6001)).toBeNull(); // Expired leases are released by the owner on restore.
  expect(actor).toStrictEqual(before);
});

it("rejects disconnected or material-bearing next claims and conflicting actor ownership", () => {
  for (const change of [{ source: 1 }, { destination: 99 }, { units: 2 }, { mode: "handcart", capacity: 6 },
    { trade: "paid-private-aid" }, { cargo: { logs: 1 } }, { leaseStartedTick: 1 }, { leaseDeadlineTick: 0 },
    { upgrade: true, sourceInput: true }]) {
    const actor = fixture();
    expect(validateNextDelivery({ ...actor, nextDelivery: { ...actor.nextDelivery, ...change } }, ids, 0)).toBeTruthy();
  }
  for (const change of [{ job: "Farmer" }, { navalOrder: 0 }, { navigationReturnCargo: true }])
    expect(validateNextDelivery({ ...fixture(), ...change }, ids, 0)).toBeTruthy();
});

it("keeps the next cart manifest separate and bound to the present unload destination", () => {
  const actor = fixture();
  const cart = { ...actor, delivery: undefined, handcart: { owner: 1, cargo: 3,
    trip: { source: 1, destination: 0, ware: "cloth", planned: 4, loaded: 4, delivered: 1, prepaid: 0 } },
  nextDelivery: { ...actor.nextDelivery, mode: "handcart", capacity: 6, units: 4 } };
  expect(validateNextDelivery(cart, ids, 0)).toBeNull();
  expect(validateNextDelivery({ ...cart, nextDelivery: { ...cart.nextDelivery, units: 7 } }, ids, 0)).toBeTruthy();
});

it("binds claims to a unique live manual order and refuses overclaiming identical requests", () => {
  const order = { id: 0, source: 0, destination: 2, ware: "logs", count: 1 };
  const actor = fixture();
  expect(validateTransferOrderClaims([order], [actor], 1)).toBeNull();
  expect(validateTransferOrderClaims([order], [actor, { ...actor, uid: 1 }], 1)).toBeTruthy();
  expect(validateTransferOrderClaims([], [actor], 1)).toBeTruthy();
  expect(validateTransferOrderClaims([order, { ...order }], [], 1)).toBeTruthy();
  expect(validateTransferOrderClaims([order], [], 0)).toBeTruthy();
  expect(validateTransferOrderClaims([order, { ...order, id: 1 }],
    [actor, { ...actor, uid: 1, nextDelivery: { ...actor.nextDelivery, transferId: 1 } }], 2)).toBeNull();
});
