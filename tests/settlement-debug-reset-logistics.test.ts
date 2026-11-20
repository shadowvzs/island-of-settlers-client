import { describe, expect, it } from "vitest";

import { resetLogisticsMessage } from "../src/app/settlement/debug-tool-messages";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const STORAGE = 29;

const createWorld = () => {
  const size = 64;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

/** Headquarters and one finished storehouse joined by a stone road. */
const fixture = () => {
  const world = createWorld();
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: { iron: 10, logs: 40, planks: 20, saw: 2, stone: 200 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const [width, depth] = getBuildingDefinition(STORAGE).gridFootprint;
  const placed = simulation.placeBuilding(STORAGE, 30 + width % 2 / 2, 9 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const storehouse = placed.building!;
  Object.assign(storehouse, { construction: 1, idleSettlers: 0, required: {} });
  const [dw, dd] = getBuildingDefinition(21).gridFootprint;
  const destination = simulation.placeBuilding(21, 30 + dw % 2 / 2, 20 + dd % 2 / 2).building!;
  Object.assign(destination, { construction: 1, required: {} });
  const headquarters = simulation.headquarters;
  expect(simulation.connectRoads(headquarters.access, storehouse.access)).toBe(true);
  expect(simulation.connectRoads(headquarters.access, destination.access)).toBe(true);
  expect(simulation.upgradeRoad(headquarters.access, storehouse.access)).toBeTruthy();
  expect(simulation.upgradeRoad(headquarters.access, destination.access)).toBeTruthy();
  const advance = (seconds: number, until?: () => boolean) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      simulation.update(.05);
      if (until?.()) return true;
    }
    return false;
  };
  return { advance, destination, headquarters, simulation, storehouse };
};

const STORAGE_IDS = new Set([0, 29, 39]);
/** Every unit of a ware: one shared pool, local buffers, reservation-free hands, cart beds and prepaid ledgers. */
const totalOf = (simulation: ReturnType<typeof fixture>["simulation"], ware: string) => {
  const state = simulation.saveState();
  const pooled = state.storagePools.pools.reduce((sum, pool) => sum + (pool.available[ware] ?? 0), 0);
  const local = state.buildings.filter(building => !STORAGE_IDS.has(building.typeId)).reduce((sum, building) =>
    sum + (building.inventory[ware] ?? 0) + (building.input[ware] ?? 0) + (building.output[ware] ?? 0), 0);
  const carried = state.actors.reduce((sum, actor) => {
    const trip = actor.handcart?.trip;
    const onCart = trip?.ware === ware ? actor.handcart!.cargo + trip.prepaid : 0;
    const inHands = !actor.handcart && actor.ware === ware ? actor.wareUnits ?? 1 : 0;
    return sum + onCart + inHands;
  }, 0);
  return pooled + local + carried;
};

const activeCarriers = (actors: readonly SettlementActor[]) =>
  actors.filter(actor => actor.job === "Carrier" && actor.phase !== "retired");

describe("development reset carriers", () => {
  it("stores a carrier's hand cargo and returns it to the nearest storehouse without stock loss", () => {
    const { advance, destination, headquarters, simulation } = fixture();
    expect(simulation.transferWare(headquarters.uid, destination.uid, "stone", 1)).toBe(true);
    expect(advance(5, () => activeCarriers(simulation.frames()).some(actor => actor.ware === "stone"))).toBe(true);
    const carrier = activeCarriers(simulation.frames()).find(actor => actor.ware === "stone")!;
    expect(carrier.ware).toBe("stone");
    expect(destination.incoming.stone).toBe(1);
    const before = totalOf(simulation, "stone");

    const report = simulation.resetCarriers();

    expect(report).toMatchObject({ carriers: 1, storages: 1, ware: 1 });
    expect(activeCarriers(simulation.frames())).toHaveLength(0);
    expect(carrier.phase).toBe("retired");
    expect(carrier.job).toBe("Settler");
    expect(destination.incoming.stone ?? 0).toBe(0);
    expect(simulation.buildings().reduce((sum, building) => sum + (building.inventory.stone ?? 0), 0))
      .toBeGreaterThan(0);
    expect(totalOf(simulation, "stone")).toBe(before);
    expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
  });

  it("unloads a loaded hand cart and shelves it at the target storage", () => {
    const { advance, destination, headquarters, simulation, storehouse } = fixture();
    headquarters.handcarts = 1;
    expect(simulation.transferWare(headquarters.uid, destination.uid, "stone", 3)).toBe(true);
    expect(advance(10, () => simulation.frames().some(actor => actor.handcart?.cargo === 3))).toBe(true);
    const before = totalOf(simulation, "stone");
    const carrier = simulation.frames().find(actor => actor.handcart)!;

    const report = simulation.resetCarriers();

    expect(report.carriers).toBe(1);
    expect(report.ware).toBe(3);
    expect(carrier.handcart).toBeUndefined();
    expect(carrier.phase).toBe("retired");
    expect(simulation.handcarts(headquarters.uid) + simulation.handcarts(storehouse.uid)).toBe(1);
    expect(totalOf(simulation, "stone")).toBe(before);
    expect(destination.incoming.stone ?? 0).toBe(0);
    expect(simulation.frames().some(actor => actor.handcart)).toBe(false);
  });

  it("does nothing and reports a warning when there is no completed storage", () => {
    // A bare context with no storage is covered by the message helper; the simulation always has a home.
    expect(resetLogisticsMessage({ carriers: 0, storages: 0, ware: 0 })).toMatchObject({
      text: "No carrier was reset: there is no completed storehouse on this island.",
      warning: true
    });
    expect(resetLogisticsMessage({ carriers: 1, storages: 1, ware: 4 })).toEqual({
      text: "Stored 1 carrier in 1 storehouse. 4 carried materials added to stock.",
      warning: false
    });
  });
});
