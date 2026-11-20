import { expect } from "vitest";

import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/script";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

/**
 * A finished building of `type` on a flat 64² island, road-connected to the HQ, with 40 settlers, a
 * hammer and `stock` (plus planks, stone and tools); `advance` runs seconds of simulation and `total`
 * counts a ware everywhere it can be (stocks, escrow, carriers and carts). `script`: an optional map script the
 * island runs (EXT-EVENTS event tests).
 */
export const workshopUpgradeFixture = (
  type: number, stock: Readonly<Record<string, number>>, carts = false, script?: MapScript
) => {
  const size = 64;
  const world = { seed: 3, ...(script ? { script } : {}), cellsX: size, cellsZ: size, seaLevel: -1,
    start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: { planks: 20, stone: 200, saw: 1, hammer: 1, tongs: 1, ...stock }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, 30 + width % 2 / 2, 9 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const building = placed.building!;
  Object.assign(building, { construction: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  if (carts) {
    expect(simulation.upgradeRoad(simulation.headquarters.access, building.access)).toBeTruthy();
    simulation.headquarters.handcarts = 1;
  }
  const advance = (seconds: number, until = () => false) => {
    for (let tick = 0; tick < seconds * 20; tick++) { simulation.update(.05); if (until()) return; }
  };
  /** Storages of one pool show the same pooled balance; it is counted once per pool. */
  const inventoryOnce = () => {
    const pools = new Set<number>();
    return (entry: SettlementBuilding) => {
      if (entry.storagePoolId === undefined) return true;
      if (pools.has(entry.storagePoolId)) return false;
      pools.add(entry.storagePoolId);
      return true;
    };
  };
  const carried = (ware: string) =>
    simulation.frames().reduce((sum, actor) => {
      const trip = actor.handcart?.trip;
      if (trip?.ware === ware) return sum + actor.handcart!.cargo + trip.prepaid;
      return sum + (!actor.handcart && actor.ware === ware ? 1 : 0);
    }, 0);
  const total = (ware: string) => {
    const countInventory = inventoryOnce();
    return simulation.buildings().reduce((sum, entry) =>
      sum + (entry.input[ware] ?? 0) + (entry.output[ware] ?? 0) +
      (countInventory(entry) ? entry.inventory[ware] ?? 0 : 0) +
      (entry.workshopUpgrade?.reserved?.[ware] ?? 0), 0) + carried(ware);
  };
  return { advance, building, roads, simulation, total };
};
