import { describe, expect, it } from "vitest";

import { createMilitaryOrderQueues } from "../src/shared/settlement/military-order-queue";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const actor = (uid: number): SettlementActor => ({
  uid, x: 1, y: 0, z: 1, yaw: 0, visible: true, job: "Soldier", action: "idle",
  ware: null, phase: "militaryField", building: -2, home: -2, path: [], pathIndex: 0, timer: 0, animationTime: 0
});
const soldier = (uid: number): SettlementSoldier => ({
  actor: uid, building: -2, rank: 0, stationed: false,
  combat: { type: "shield", faction: 0, hp: 100, cooldown: 0 }
});
const setup = () => {
  const bodies = [actor(1), actor(2)], soldiers = new Map([[1, soldier(1)], [2, soldier(2)]]);
  const context = { actors: bodies, buildings: [] } as unknown as SettlementContext;
  let completed = 0;
  const orders = {
    commandAccepted: () => [1, 2],
    targetAccepted: () => ({ ok: false as const, reason: "noTroops" as const }),
    siegeAccepted: () => {
      for (const uid of [1, 2]) soldiers.get(uid)!.combat!.siege = 7;
      return [1, 2];
    },
    garrisonAccepted: () => {
      for (const uid of [1, 2]) soldiers.get(uid)!.building = 7;
      return [1, 2];
    },
    returnAccepted: () => {
      for (const uid of [1, 2]) soldiers.get(uid)!.combat!.returnToStorage = true;
      return [1, 2];
    },
    boardAccepted: () => [1, 2]
  };
  const combat = {
    actorById: (uid: number) => bodies[uid - 1], chaseRefusal: () => null, marchPending: () => false
  };
  const queues = createMilitaryOrderQueues(context, soldiers, orders, combat);
  return { bodies, combat, context, orders, queues, soldiers, done: () => completed++ };
};

describe("Shift queue phase 2 step kinds", () => {
  it("completes a siege step when the siege assignment clears", () => {
    const { queues, soldiers } = setup();
    expect(queues.queue([1, 2], { kind: "siege", building: 7, x: 0, z: 0 })).toMatchObject({ ok: true });
    queues.update(.05);
    expect(queues.snapshot()).toHaveLength(1);
    for (const entry of soldiers.values()) entry.combat!.siege = undefined;
    queues.update(.05);
    expect(queues.snapshot()).toEqual([]);
  });

  it("completes a garrison step when the soldiers are stationed", () => {
    const { queues, soldiers } = setup();
    expect(queues.queue([1, 2], { kind: "garrison", building: 7, x: 0, z: 0 })).toMatchObject({ ok: true });
    queues.update(.05);
    expect(queues.snapshot()).toHaveLength(1);
    for (const entry of soldiers.values()) entry.stationed = true;
    queues.update(.05);
    expect(queues.snapshot()).toEqual([]);
  });

  it("completes a store step when the return flag clears", () => {
    const { queues, soldiers } = setup();
    expect(queues.queue([1, 2], { kind: "store", building: 0, x: 0, z: 0 })).toMatchObject({ ok: true });
    queues.update(.05);
    expect(queues.snapshot()).toHaveLength(1);
    for (const entry of soldiers.values()) entry.combat!.returnToStorage = undefined;
    queues.update(.05);
    expect(queues.snapshot()).toEqual([]);
  });

  it("completes a board step when the soldiers have a naval order", () => {
    const { bodies, queues } = setup();
    expect(queues.queue([1, 2], { kind: "board", ship: 4, x: 0, z: 0 })).toMatchObject({ ok: true });
    queues.update(.05);
    expect(queues.snapshot()).toHaveLength(1);
    for (const body of bodies) body.navalOrder = 4;
    queues.update(.05);
    expect(queues.snapshot()).toEqual([]);
  });
});
