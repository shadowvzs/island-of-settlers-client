import { describe, expect, it } from "vitest";

import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSoldierBuildingIndex } from "../src/shared/settlement/settlement-military-soldier-index";

const soldier = (actor: number, building: number): SettlementSoldier =>
  ({ actor, building, rank: 0, stationed: building >= 0 });

const filled = (soldiers: SettlementSoldier[]) =>
  createSoldierBuildingIndex(new Map(soldiers.map((entry) => [entry.actor, entry])));

describe("soldier building index", () => {
  it("groups every soldier by its building in map order", () => {
    const first = soldier(1, 10), second = soldier(2, 20), third = soldier(3, 10);
    const index = filled([first, second, third]);
    index.rebuild();
    expect(index.of(10)).toEqual([first, third]);
    expect(index.of(20)).toEqual([second]);
    expect(index.of(30)).toEqual([]);
  });

  it("keeps the bucket arrays across rebuilds", () => {
    const index = filled([soldier(1, 10)]);
    index.rebuild();
    const bucket = index.of(10);
    index.rebuild();
    expect(index.of(10)).toBe(bucket);
    expect(bucket).toHaveLength(1);
  });

  it("drops soldiers that left the soldier map on rebuild", () => {
    const soldiers = new Map<number, SettlementSoldier>([[1, soldier(1, 10)]]);
    const index = createSoldierBuildingIndex(soldiers);
    index.rebuild();
    soldiers.delete(1);
    index.rebuild();
    expect(index.of(10)).toEqual([]);
  });

  it("moves a soldier between buckets during a pass", () => {
    const entry = soldier(1, 10);
    const index = filled([entry]);
    index.rebuild();
    entry.building = -2;
    index.move(entry, 10);
    expect(index.of(10)).toEqual([]);
    expect(index.of(-2)).toEqual([entry]);
  });

  it("adds a newly created soldier without a previous building", () => {
    const entry = soldier(7, 30);
    const index = filled([]);
    index.rebuild();
    index.move(entry);
    expect(index.of(30)).toEqual([entry]);
  });

  it("replaces the old object when a soldier is recreated at the same uid", () => {
    const old = soldier(1, -1);
    const index = filled([old]);
    index.rebuild();
    const moved = soldier(1, 10);
    index.move(moved, -1);
    expect(index.of(-1)).toEqual([]);
    expect(index.of(10)).toEqual([moved]);
  });

  it("does nothing when the building did not change", () => {
    const entry = soldier(1, 10);
    const index = filled([entry]);
    index.rebuild();
    index.move(entry, 10);
    expect(index.of(10)).toEqual([entry]);
  });
});
