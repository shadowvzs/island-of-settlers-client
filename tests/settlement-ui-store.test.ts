import { describe, expect, it, vi } from "vitest";

import { isShallowEqual } from "../src/app/components/ui-store";
import { readSelection } from "../src/app/components/use-store-selector";
import { createSettlementUiStore, isSnapshotUnchanged } from "../src/app/settlement-ui/ui-store";

describe("settlement UI store", () => {
  it("publishes a new snapshot per update and never changes earlier ones", () => {
    const store = createSettlementUiStore();
    const initial = store.getSnapshot();
    expect(initial).toEqual({ roadMode: null, selectedBuilding: null });
    expect(store.update({ population: 4, resources: { logs: 3 } })).toBe(true);
    const ticked = store.getSnapshot();
    expect(ticked).not.toBe(initial);
    expect(initial).toEqual({ roadMode: null, selectedBuilding: null });
    expect(ticked).toEqual({ population: 4, resources: { logs: 3 }, roadMode: null, selectedBuilding: null });
  });

  it("merges partial status, selection and road mode updates into a new object", () => {
    const store = createSettlementUiStore();
    const resources = { logs: 3 };
    store.update({ population: 4, resources });
    const before = store.getSnapshot();
    store.update({ status: "Placed", statusRevision: 1 });
    store.update({ roadMode: "dirt", selectedBuilding: null, surveyJob: null });
    const after = store.getSnapshot();
    expect(after).toMatchObject({ population: 4, roadMode: "dirt", status: "Placed", statusRevision: 1 });
    expect(after.resources).toBe(resources);
    expect(before.status).toBeUndefined();
  });

  it("notifies only when a value changes", () => {
    const store = createSettlementUiStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const buildings = [{ id: "1", type: 0 }];
    expect(store.update({ buildings, status: "" })).toBe(true);
    expect(store.update({ buildings, status: "" })).toBe(false);
    expect(store.update({})).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update({ status: "Later" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("compares partial keys by reference", () => {
    const snapshot = { resources: { logs: 1 }, status: "a" };
    expect(isSnapshotUnchanged(snapshot, { status: "a" })).toBe(true);
    expect(isSnapshotUnchanged(snapshot, { resources: { logs: 1 } })).toBe(false);
    expect(isSnapshotUnchanged(snapshot, { population: undefined })).toBe(true);
  });
});

describe("store selection", () => {
  const select = (snapshot: { count: number; other: number }) => ({ count: snapshot.count });

  it("keeps the selection reference while the selected values are equal", () => {
    const first = readSelection(null, { count: 1, other: 1 }, select, isShallowEqual, true);
    const second = readSelection(first, { count: 1, other: 2 }, select, isShallowEqual, true);
    expect(second.selection).toBe(first.selection);
    const third = readSelection(second, { count: 2, other: 2 }, select, isShallowEqual, true);
    expect(third.selection).toEqual({ count: 2 });
  });

  it("computes nothing while inactive and catches up when active again", () => {
    const spy = vi.fn(select);
    const first = readSelection(null, { count: 1, other: 1 }, spy, isShallowEqual, true);
    const hidden = readSelection(first, { count: 5, other: 1 }, spy, isShallowEqual, false);
    expect(hidden).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(readSelection(hidden, { count: 5, other: 1 }, spy, isShallowEqual, true).selection).toEqual({ count: 5 });
  });

  it("compares shallowly by key and item", () => {
    expect(isShallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(isShallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isShallowEqual([1, 2], [1, 2])).toBe(true);
    expect(isShallowEqual({ a: {} }, { a: {} })).toBe(false);
    expect(isShallowEqual(undefined, {})).toBe(false);
    expect(isShallowEqual(undefined, undefined)).toBe(true);
  });
});
