import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { createMilitaryOrders as CreateMilitaryOrders } from "../src/shared/settlement/military-orders";
import type { createSettlementCombat } from "../src/shared/settlement/settlement-combat";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";

vi.mock("../src/shared/settlement/military-order-target", () => ({
  orderTargetCandidates: (_context: unknown, point: unknown) => [point]
}));
vi.mock("../src/shared/settlement/settlement-navigation", () => ({
  withMilitaryNavigationCache: (_context: unknown, action: () => unknown) => action()
}));

let createMilitaryOrders: typeof CreateMilitaryOrders;
// isolate:false shares the module cache: load the subject fresh so it sees this file's mocks,
// then drop the mocks and the mocked graph so later files of the worker get the real modules.
beforeAll(async () => {
  vi.resetModules();
  ({ createMilitaryOrders } = await import("../src/shared/settlement/military-orders"));
});
afterAll(() => {
  vi.doUnmock("../src/shared/settlement/military-order-target");
  vi.doUnmock("../src/shared/settlement/settlement-navigation");
  vi.resetModules();
});

const fixture = () => {
  const soldiers = new Map<number, SettlementSoldier>([1, 2, 3, 4].map(actor => [actor, {
    actor, building: actor === 3 ? 8 : -3, stationed: actor === 3, rank: 0,
    combat: { faction: 0, type: "shield", hp: 20, cooldown: 0 }
  }]));
  const context = { buildings: [{ uid: 8, militaryFaction: 1, x: 10, z: 10, width: 2, depth: 2,
    access: { x: 10, z: 12 } }], actors: [1, 2, 3, 4].map(uid => ({ uid, x: 1, z: 1,
    phase: uid === 3 ? "garrison" : "militaryField" })) } as unknown as SettlementContext;
  const march = vi.fn((ids: readonly number[]) => [...ids]);
  const siege = vi.fn((ids: readonly number[], uid: number, accepted?: number[]) => {
    for (const id of ids) soldiers.get(id)!.combat!.siege = uid;
    accepted?.push(...ids); return true;
  });
  const combat = { doors: () => [{ building: 8, faction: context.buildings[0]!.militaryFaction }],
    siege, march } as unknown as ReturnType<typeof createSettlementCombat>;
  const orders = createMilitaryOrders(context, soldiers, combat);
  const capture = () => {
    context.buildings[0]!.militaryFaction = 0;
    for (const soldier of soldiers.values()) soldier.combat!.siege = undefined;
    orders.update();
  };
  return { capture, context, march, orders, siege, soldiers };
};

it("regroups only banner participants after capture, preserving unrelated troops and garrisons", () => {
  const { capture, march, orders, soldiers } = fixture();
  orders.plantRally({ x: 10, z: 10 }); orders.gather([1, 2]);
  // One participant is the capturer and must remain stationed in the newly owned fort.
  soldiers.get(1)!.stationed = true;
  capture();
  expect(march.mock.calls.map(call => call[0])).toEqual([[2]]);
  expect(orders.rally()).toEqual({ x: 10, z: 12 });
  expect(soldiers.get(1)!.stationed).toBe(true);
  expect(soldiers.get(3)!.stationed).toBe(true);
});

it("retains capture participants across save/restore and honors a subsequent return order", () => {
  const { capture, march, orders } = fixture();
  orders.plantRally({ x: 10, z: 10 }); orders.gather([1, 2]);
  const saved = orders.save();
  expect(saved?.participants).toEqual([1, 2]);
  orders.restore(saved); orders.forgetRallyParticipants([1]); capture();
  expect(march.mock.calls.map(call => call[0])).toEqual([[2]]);
});

it("infers historical banner members from siege markers without gathering the whole army", () => {
  const { capture, march, orders, soldiers } = fixture();
  soldiers.get(2)!.combat!.siege = 8;
  orders.restore({ x: 10, z: 12, building: 8 }); capture();
  expect(march.mock.calls.map(call => call[0])).toEqual([[2]]);
});

it("keeps rejected and partially rejected march participants eligible for capture regrouping", () => {
  const { capture, march, orders } = fixture();
  orders.plantRally({ x: 10, z: 10 }); orders.gather([1, 2]);
  march.mockImplementationOnce(() => []);
  expect(orders.command([1, 2], { x: 25, z: 25 })).toBe(false);
  expect(orders.save()?.participants).toEqual([1, 2]);
  march.mockImplementationOnce(() => [1]);
  expect(orders.command([1, 2], { x: 25, z: 25 })).toBe(true);
  expect(orders.save()?.participants).toEqual([2]);
  march.mockClear(); capture();
  expect(march.mock.calls.map(call => call[0])).toEqual([[2]]);
});

it("omits dead or changed-faction participants from persisted banner membership", () => {
  const { orders, soldiers } = fixture();
  orders.plantRally({ x: 10, z: 10 }); orders.gather([1, 2]);
  soldiers.get(1)!.combat!.hp = 0;
  soldiers.get(2)!.combat!.faction = 1;
  expect(orders.save()?.participants).toEqual([]);
});


it("retains rejected siege members even when another member accepts the same target", () => {
  const { orders, siege } = fixture();
  orders.plantRally({ x: 10, z: 10 }); orders.gather([1, 2]);
  siege.mockImplementationOnce(() => false);
  expect(orders.siege([1, 2], 8)).toBe(false);
  expect(orders.save()?.participants).toEqual([1, 2]);
  siege.mockImplementationOnce((_ids, _uid, accepted) => { accepted?.push(1); return true; });
  expect(orders.siege([1, 2], 8)).toBe(true);
  expect(orders.save()?.participants).toEqual([2]);
});
