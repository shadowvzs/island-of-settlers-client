import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { NO_ISLAND_STORAGE_REASON } from "../src/shared/settlement/constants";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { createAngledBridgeSettlement } from "./helpers/bridge-settlement";

const BRIDGE_ID = 1;

/**
 * The angled river island (the river splits it into two landmasses) with a completed bridge laid
 * straight into the road graph; `placeEast` tries east bank plots for a building type.
 */
const splitIsland = () => {
  const fixture = createAngledBridgeSettlement({ stock: { hammer: 4, logs: 40, planks: 40, stone: 40 } });
  const { pointer, roads, simulation, westAnchor } = fixture;
  const plan = simulation.previewBridge(pointer, "wood", westAnchor).plan!;
  const tiles: RoadSegment[] = plan.segments.map(segment => ({ ...segment, bridge: { ...segment.bridge!, id: BRIDGE_ID } }));
  const addBridge = () => {
    if (!roads.replaceSegments([...roads.segments(), ...tiles])) throw new Error("Bridge refused");
  };
  const placeEast = (typeId: number) => {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    let last: ReturnType<typeof simulation.placeBuilding> | undefined;
    for (let x = 21; x < 29; x += 1) for (let z = 6; z < 26; z += 1) {
      last = simulation.placeBuilding(typeId, x + (width % 2) / 2, z + (depth % 2) / 2);
      if (last.ok) return last;
    }
    return last!;
  };
  return { ...fixture, addBridge, placeEast };
};

const pools = (fixture: ReturnType<typeof splitIsland>) => fixture.simulation.saveState().storagePools.pools;

describe("bridges join the banks' stock pools", () => {
  it("lets the far bank build from home stock only while a finished bridge stands", () => {
    const fixture = splitIsland();
    expect(fixture.placeEast(BuildingType.Woodcutter)).toMatchObject({ ok: false, reason: NO_ISLAND_STORAGE_REASON });
    fixture.addBridge();
    const placed = fixture.placeEast(BuildingType.Woodcutter);
    expect(placed.ok).toBe(true);
    // Remove it again so the next order is the only east bank demand.
    expect(fixture.simulation.demolishBuilding(placed.building!.uid)).toBeTruthy();
    fixture.simulation.removeBridge(BRIDGE_ID);
    fixture.advance(1);
    // Closing (and dismantling) still joins the pools; only the finished removal splits them.
    expect(fixture.placeEast(BuildingType.Woodcutter).ok).toBe(true);
    for (let elapsed = 0; elapsed < 120 && fixture.simulation.bridges().length; elapsed += 0.5)
      fixture.simulation.update(0.5);
    expect(fixture.simulation.bridges()).toEqual([]);
    expect(fixture.placeEast(BuildingType.Woodcutter)).toMatchObject({ ok: false, reason: NO_ISLAND_STORAGE_REASON });
  });

  it("merges two banks' pools when a bridge joins them and splits them by capacity after removal", () => {
    const fixture = splitIsland();
    fixture.addBridge();
    const store = fixture.placeEast(BuildingType.Storehouse);
    if (!store.ok || !store.building) throw new Error(store.reason);
    Object.assign(store.building, { construction: 1, foundationProgress: 1, required: {} });
    fixture.advance(0.1);
    expect(pools(fixture)).toHaveLength(1);
    const home = fixture.simulation.headquarters;
    expect(store.building.storagePoolId).toBe(home.storagePoolId);
    const before = { ...pools(fixture)[0]!.available };
    const capacity = (uid: number) => fixture.simulation.storageSnapshot(uid)!.capacity;
    const total = capacity(home.uid);
    fixture.simulation.removeBridge(BRIDGE_ID);
    for (let elapsed = 0; elapsed < 120 && fixture.simulation.bridges().length; elapsed += 0.5)
      fixture.simulation.update(0.5);
    const after = pools(fixture);
    expect(after).toHaveLength(2);
    expect(store.building.storagePoolId).not.toBe(home.storagePoolId);
    const east = fixture.simulation.storageSnapshot(store.building.uid)!;
    const west = fixture.simulation.storageSnapshot(home.uid)!;
    expect(east.capacity + west.capacity).toBe(total);
    for (const [ware, amount] of Object.entries(before)) {
      // Nothing is lost or duplicated; the far bank gets its capacity share, rounded down.
      expect((east.available[ware] ?? 0) + (west.available[ware] ?? 0), ware).toBe(amount);
      expect(east.available[ware] ?? 0, ware).toBe(Math.floor(amount * east.capacity / total));
    }
    // A save of the split island loads (pool lands follow the save's own bridges).
    const saved = fixture.simulation.saveState();
    expect(fixture.simulation.loadState(saved)).toEqual({ ok: true });
  });

  it("validates a joined save against its own bridges, not the island's current roads", () => {
    const fixture = splitIsland();
    fixture.addBridge();
    const store = fixture.placeEast(BuildingType.Storehouse);
    Object.assign(store.building!, { construction: 1, foundationProgress: 1, required: {} });
    fixture.advance(0.1);
    const joined = JSON.parse(JSON.stringify(fixture.simulation.saveState()));
    const reloaded = splitIsland();
    expect(reloaded.simulation.loadState(joined)).toEqual({ ok: true });
    expect(pools(reloaded)).toHaveLength(1);
    const forged = { ...joined, roads: joined.roads.filter((segment: RoadSegment) => !segment.bridge) };
    expect(reloaded.simulation.loadState(forged).ok).toBe(false);
  });
});
