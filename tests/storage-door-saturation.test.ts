import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { canReserveStorageDelivery } from "../src/shared/settlement/settlement-door-traffic";
import { scheduleDeliveries } from "../src/shared/settlement/settlement-logistics";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 48;
/** A sawmill with one plank output, the HQ nearby and a storehouse farther away, all on roads. */
const fixture = () => {
  const world = {
    blocking: new Uint8Array(SIZE ** 2), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large), cellsX: SIZE,
    cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    oreAmount: new Uint8Array(SIZE ** 2), props: { count: 0, types: new Uint8Array() },
    walkCost: new Uint8Array(SIZE ** 2).fill(10)
  } as unknown as WorldData;
  const context = {
    accumulator: 0, actors: [], buildings: [], nextActor: 1, nextBuilding: 0, occupied: new Uint8Array(SIZE ** 2),
    options: { consumeResource: () => true, roads: null, world }, reservations: new Set<string>(),
    resourceAmounts: new Map(), scheduling: 0, settlers: 1, transfers: []
  } as unknown as SettlementContext;
  const place = (typeId: number, x: number, z: number) => {
    const building = makeBuilding(context, typeId, x, z, 0);
    building.construction = 1;
    building.inventory = {};
    context.buildings.push(building);
    return building;
  };
  const hq = place(0, 12, 12), sawmill = place(33, 20, 20), store = place(29, 36, 34);
  for (const entry of context.buildings)
    for (let z = entry.z - entry.depth / 2; z < entry.z + entry.depth / 2; z++)
      for (let x = entry.x - entry.width / 2; x < entry.x + entry.width / 2; x++)
        context.occupied[Math.floor(z) * SIZE + Math.floor(x)] = 1;
  context.options.roads = createRoadNetwork(world, {
    isBlocked: (x, z) => context.occupied[Math.floor(z) * SIZE + Math.floor(x)] === 1
  });
  expect(context.options.roads.addRoad(hq.access, sawmill.access)).toBe(true);
  expect(context.options.roads.addRoad(sawmill.access, store.access)).toBe(true);
  sawmill.output.planks = 1;
  hq.idleSettlers = 1;
  return { context, hq, sawmill, store };
};
/** Commits every waiting place of the storage door to deliveries already on their way. */
const saturate = (context: SettlementContext, storage: SettlementBuilding) => {
  while (canReserveStorageDelivery(context, storage))
    context.actors.push({ delivery: { destination: storage.uid, reserved: true, source: -1, ware: "logs" },
      phase: "inside", uid: -context.actors.length - 1, visible: false } as unknown as SettlementActor);
};

it("delivers workshop output to the nearest storage while its door can take another crew", () => {
  const { context, hq, store } = fixture();
  scheduleDeliveries(context);
  expect(hq.incoming.planks).toBe(1);
  expect(store.incoming.planks ?? 0).toBe(0);
});

it("sends workshop output to the next storage when the nearest door is saturated", () => {
  const { context, hq, store } = fixture();
  saturate(context, hq);
  scheduleDeliveries(context);
  expect(hq.incoming.planks ?? 0).toBe(0);
  expect(store.incoming.planks).toBe(1);
});
