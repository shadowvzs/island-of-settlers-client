import { describe, expect, it } from "vitest";

import { isRoadDecorationItemId, ROAD_DECORATION_ITEM_DEFINITIONS, type RoadDecorationItemId }
  from "../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationSaveProblem } from "../src/shared/settlement/road-decoration-save";
import { createRoadDecorationState, type RoadDecorationOrder } from "../src/shared/settlement/road-decoration-state";

const ITEM: RoadDecorationItemId = "roadDecoration:indigenous-flower-pot:native";
const edge = (x: number) => ({ start: { x, z: 4 }, end: { x, z: 4.5 }, tier: "stone" as const });
const order = (x: number): RoadDecorationOrder => ({ item: ITEM, position: { x: x + 1, z: 4.25 }, yaw: 0 });
const fixture = () => {
  let roads = [edge(5), edge(20)], ground = 0;
  const inventory: Record<string, number> = { [ITEM]: 2 };
  const owner = createRoadDecorationState(() => ({ nation: "roman", roads, heightAt: () => ground,
    isOwned: () => true, canDecorateRoad: () => true, isFree: () => true }));
  const consume = (item: RoadDecorationItemId) => {
    if (!inventory[item]) return false;
    inventory[item]!--; return true;
  };
  const receive = (items: Readonly<Record<string, number>>) => {
    for (const [item, count] of Object.entries(items)) inventory[item] = (inventory[item] ?? 0) + count;
    return true;
  };
  const owned = () => inventory[ITEM]! + owner.save().placed.length + owner.returns().length;
  return { owner, inventory, consume, receive, owned,
    roads: (next: typeof roads) => { roads = next; }, ground: (height: number) => { ground = height; } };
};

describe("registered road-decoration custody domain", () => {
  it("releases the accepted decoration SKUs at fixed low prices and rejects illegal finish combinations", () => {
    expect(Object.values(ROAD_DECORATION_ITEM_DEFINITIONS).filter(item => item.shopAvailable)).toHaveLength(265);
    expect(Object.values(ROAD_DECORATION_ITEM_DEFINITIONS).every(item => item.price === 5)).toBe(true);
    expect(isRoadDecorationItemId("roadDecoration:roman-rusticated-arch:marble")).toBe(true);
    expect(isRoadDecorationItemId("roadDecoration:indigenous-flower-pot:marble")).toBe(false);
  });

  it("preview/refusal is read-only and a successful placement consumes exactly one owned SKU", () => {
    const { consume, inventory, owned, owner } = fixture(), initial = owner.save();
    expect(owner.plan(order(5)).ok).toBe(true); expect(owner.save()).toEqual(initial); expect(inventory[ITEM]).toBe(2);
    expect(owner.place(order(5), () => false)).toEqual({ ok: false, reason: "decoration-item-required" });
    expect(owner.save()).toEqual(initial);
    expect(owner.place(order(5), consume)).toEqual({ ok: true, uid: 1 });
    expect(inventory[ITEM]).toBe(1); expect(owned()).toBe(2);
    expect(owner.place(order(5), consume).ok).toBe(false); expect(inventory[ITEM]).toBe(1);
  });

  it("Pick Up, duplicate pickup and retried return claims conserve held+placed+pending units", () => {
    const { consume, inventory, owned, owner, receive } = fixture();
    owner.place(order(5), consume);
    expect(owner.pickUp(1)).toEqual({ ok: true, returned: 1 });
    expect(owner.pickUp(1)).toEqual({ ok: true, returned: 0 }); expect(owned()).toBe(2);
    const ids = owner.returns().map(row => row.id);
    expect(owner.claimReturns(ids, () => false).ok).toBe(false); expect(inventory[ITEM]).toBe(1);
    expect(owner.claimReturns(ids, receive)).toEqual({ ok: true, returned: 1 });
    expect(owner.claimReturns(ids, receive)).toEqual({ ok: true, returned: 0 });
    expect(inventory[ITEM]).toBe(2); expect(owned()).toBe(2);
  });

  it("indexes relevant road/spatial mutations and performs zero validation on unchanged frame queries", () => {
    const { consume, ground, owned, owner, roads } = fixture();
    owner.place(order(5), consume); owner.place(order(20), consume);
    const validations = owner.counters().validations, frames = owner.frames();
    for (let tick = 0; tick < 200; tick++) { expect(owner.frames()).toBe(frames); owner.flushDirty(); }
    expect(owner.counters().validations).toBe(validations);
    roads([edge(20)]); owner.markBounds({ min: [5, -1, 3], max: [7, 3, 5] });
    owner.markBounds({ min: [5, -1, 3], max: [7, 3, 5] });
    expect(owner.flushDirty(1)).toEqual({ checked: 1, remaining: 0 });
    expect(owner.returns()).toHaveLength(0); expect(owned()).toBe(2);
    ground(.2);
    owner.markBounds({ min: [19, -.1, 3], max: [22, 2, 5] });
    expect(owner.flushDirty(1).checked).toBe(1);
    expect(owner.frames().find(row => row.position[0] === 21)!.position[1]).toBe(.2);
  });

  it("round-trips exact custody, rejects malformed saves before mutation and returns newly invalid support once", () => {
    const first = fixture(); first.owner.place(order(5), first.consume);
    const saved = first.owner.save(); expect(roadDecorationSaveProblem(saved)).toBeNull();
    const second = fixture(); second.owner.load(saved); expect(second.owner.save()).toEqual(saved);
    const bad = structuredClone(saved); bad.placed.push(bad.placed[0]!);
    expect(roadDecorationSaveProblem(bad)).toBe("Invalid placed road decoration");
    expect(() => second.owner.load(bad)).toThrow("Invalid placed road decoration");
    expect(second.owner.save()).toEqual(saved);
    second.roads([]); second.owner.load(saved);
    expect(second.owner.frames()).toHaveLength(1); expect(second.owner.returns()).toHaveLength(0);
    second.ground(Number.NaN); second.owner.load(saved);
    expect(second.owner.frames()).toHaveLength(0); expect(second.owner.returns()).toHaveLength(1);
    const restored = second.owner.save(); second.owner.load(restored);
    expect(second.owner.save()).toEqual(restored);
  });
});
