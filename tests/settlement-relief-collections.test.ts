import { describe, expect, it } from "vitest";

import { demolishSettlementBuilding } from "../src/shared/settlement/settlement-demolition";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createReliefCollections, validateReliefCollectionSave } from
  "../src/shared/settlement/settlement-relief-collections";
import type { SettlementBuilding, SettlementContext } from
  "../src/shared/settlement/settlement-types";

const building = (uid: number, fish: number, component: number, typeId = 39) => ({
  uid, typeId, construction: 1, inventory: { fish }, access: { x: component, z: uid }
}) as unknown as SettlementBuilding;
const fixture = (buildings: SettlementBuilding[]) => {
  const context = { buildings, actors: [], naval: {}, options: { world: { seed: 3 }, roads: {
    route: (a: { x: number }, b: { x: number }) => a.x === b.x ? [a, b] : null
  } } } as unknown as SettlementContext;
  const collections = createReliefCollections(context);
  context.relief = collections;
  return { context, collections };
};
const request = { version: 1 as const, questId: "2026-10-28-0", ware: "fish", amount: 4 };

describe("durable physical relief custody", () => {
  it("refuses normal demolition while held/staged aid or its serving harbour remains paid", () => {
    const { collections, context } = fixture([building(2, 4, 1, 29), building(4, 0, 1)]);
    collections.request(request);
    const paid = collections.save();
    expect(demolishSettlementBuilding(context, 2)).toMatchObject({ ok: false, reason: expect.stringContaining("paid relief") });
    expect(demolishSettlementBuilding(context, 4).ok).toBe(false);
    expect(collections.save()).toEqual(paid);
    const settled = collections.save()!;
    settled.jobs[0]!.escrow.held = [];
    settled.jobs[0]!.loaded = 4; settled.jobs[0]!.escrow.goods = {}; settled.jobs[0]!.escrow.staged = {};
    collections.restore(settled);
    expect(collections.protectsBuilding(2)).toBe(false);
    expect(collections.protectsBuilding(4)).toBe(true);
    settled.jobs[0]!.departed = true;
    collections.restore(settled);
    expect(collections.protectsBuilding(4)).toBe(false);
  });
  it("restores zero-tick paid HQ source UID0 and a colony's home harbour UID0", () => {
    const source = fixture([building(0, 4, 1, 0), building(4, 0, 1)]).collections;
    expect(source.request(request).ok).toBe(true);
    const paid = source.save()!;
    expect(paid.jobs[0]!.escrow.held).toEqual([{ uid: 0, goods: { fish: 4 } }]);
    expect(validateReliefCollectionSave(JSON.parse(JSON.stringify(paid)))).toBeNull();
    const colony = fixture([building(0, 4, 1)]).collections;
    expect(colony.request(request)).toEqual({ ok: true, harbourUid: 0 });
    expect(validateReliefCollectionSave(colony.save())).toBeNull();
  });
  it("chooses the sufficiently stocked remote landmass without pooling stock across water", () => {
    const home = building(1, 3, 1), remote = building(2, 7, 2), remoteStore = building(3, 5, 2, 0);
    const { collections } = fixture([home, remote, remoteStore]);
    expect(collections.candidates("fish")).toEqual([{ harbourUid: 2, available: 12 }, { harbourUid: 1, available: 3 }]);
    expect(collections.request(request)).toEqual({ ok: true, harbourUid: 2 });
    expect(home.inventory.fish).toBe(3);
    expect(remote.inventory.fish).toBe(3);
    expect(remoteStore.inventory.fish).toBe(5);
    expect(collections.request({ ...request, amount: 5 }).ok).toBe(false);
    expect(collections.request(request).ok).toBe(true);
    expect(remote.inventory.fish).toBe(3);
    const short = fixture([building(1, 3, 1), building(2, 3, 2)]).collections;
    expect(short.request(request).ok).toBe(false);
  });

  it("blocks deleted held storage instead of inventing staged wares or dereferencing the missing source", () => {
    const source = building(1, 4, 1, 0), harbour = building(2, 0, 1);
    const { collections, context } = fixture([source, harbour]);
    expect(collections.request(request).ok).toBe(true);
    context.buildings.splice(0, 1);
    expect(() => collections.schedule()).not.toThrow();
    expect(collections.statuses()[0]!.blocker).toMatch(/storage is no longer available/);
    expect(collections.save()!.jobs[0]!.escrow.staged).toEqual({});
    expect(collections.save()!.jobs[0]!.loaded).toBe(0);
  });

  it("prunes only unlisted departed jobs without remaining ships or escrow", () => {
    const { collections } = fixture([building(1, 4, 1)]);
    collections.request(request);
    const saved = collections.save()!, job = saved.jobs[0]!;
    job.loaded = 4; job.departed = true; job.escrow.goods = {}; job.escrow.staged = {};
    collections.restore(saved);
    expect(collections.prune([request.questId])).toEqual([]);
    expect(collections.prune([])).toEqual([request.questId]);
    expect(collections.save()).toBeUndefined();
  });

  it("rejects unsupported versions, mismatched cargo, visible departed ships and stale carriers", () => {
    const { collections } = fixture([building(1, 4, 1)]);
    collections.request(request);
    const saved = collections.save()!;
    expect(validateReliefCollectionSave(saved)).toBeNull();
    expect(validateReliefCollectionSave({ ...saved, version: 2 })).toMatch(/version/);
    const job = saved.jobs[0]!;
    job.shipId = 3; job.loaded = 4; job.escrow.goods = {}; job.escrow.staged = {};
    const ship = { id: 3, visitor: { relief: { questId: request.questId } }, cargo: { fish: 3 } } as unknown as NavalShip;
    expect(validateReliefCollectionSave(saved, [ship])).toMatch(/cargo/);
    ship.cargo.fish = 4; job.departed = true;
    expect(validateReliefCollectionSave(saved, [ship])).toMatch(/live ship/);
  });
});
