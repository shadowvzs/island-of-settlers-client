import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  remainingRouteLength,
  setCarrierLegCacheEnabled
} from "../src/shared/settlement/settlement-carrier-detours";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const crowded = JSON.parse(
  readFileSync(new URL("./fixtures/settlement-mixed-overcrowded.json", import.meta.url), "utf8")
);
const emptyWorld = (size: number, start: { x: number; z: number }) =>
  ({
    seed: 3,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start,
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  }) as unknown as WorldData;

type Simulation = ReturnType<typeof createSettlementSimulation>;
/** FNV-1a over every actor's position, heading, phase and cargo at every tick. */
const traceHash = (simulation: Simulation, ticks: number) => {
  let hash = 2166136261;
  const mix = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  for (let tick = 0; tick < ticks; tick++) {
    simulation.update(0.05);
    for (const actor of simulation.frames())
      mix(`${actor.uid}:${actor.x}:${actor.z}:${actor.yaw}:${actor.phase}:${actor.ware};`);
  }
  return hash;
};
const overcrowded = () => {
  const world = emptyWorld(64, { x: 25, z: 20 });
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
  expect(simulation.loadState(crowded)).toEqual({ ok: true });
  return simulation;
};
const sustained = () => {
  const world = emptyWorld(64, { x: 6, z: 6 });
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    world, roads, initialSettlers: 100, resourceTargets: () => [],
    initialStock: { logs: 100, planks: 100, stone: 100, iron: 100, grain: 100, hammer: 6, axe: 2,
      saw: 2, tongs: 2 },
    canWorkerEnterPlot: (building, point) => isBuildingCourtyardPointWalkable(building.typeId,
      building.x, building.z, building.rotation, point, building.output, building.input),
    stockContact: (building, kind, ware, slot) => {
      const own = kind === "input" ? building.input : building.output;
      const other = kind === "input" ? building.output : building.input;
      const contact = getBuildingStockContact(building.typeId, kind, ware, slot, building.x,
        building.z, building.rotation, building.y, own, other);
      return contact && {
        ware, slot, yaw: contact.wareYaw,
        stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
        approach: { x: contact.approach[0], y: contact.approach[1], z: contact.approach[2] },
        scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] }
      };
    }
  });
  for (const [id, x, z] of [[33, 20, 12], [25, 28, 12], [31, 20, 23], [17, 28, 23]] as const) {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    const placed = simulation.placeBuilding(id, x + (width % 2) / 2, z + (depth % 2) / 2);
    expect(placed.ok, placed.reason).toBe(true);
    placed.building!.construction = 1;
    placed.building!.required = {};
    expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  }
  return simulation;
};
const compare = (create: () => Simulation, ticks: number) => {
  setCarrierLegCacheEnabled(false);
  const reference = create();
  const expected = traceHash(reference, ticks);
  const uncached = { ...reference.workCounters() };
  setCarrierLegCacheEnabled(true);
  const cached = create();
  expect(traceHash(cached, ticks)).toBe(expected);
  return { cached: cached.workCounters(), uncached };
};

afterEach(() => setCarrierLegCacheEnabled(true));

it("keeps the overcrowded storage trace identical while skipping most carrier leg proofs", () => {
  const { cached, uncached } = compare(overcrowded, 1200);
  expect(uncached.carrierSegmentSkips).toBe(0);
  // In this jam a leg restarts at every sidestep or queue step (2026-10-13: 8655 -> 2958 proofs,
  // below the 3734 the cache needed before queue following removed most detour checks).
  expect(cached.carrierSegmentChecks).toBeLessThanOrEqual(uncached.carrierSegmentChecks * 0.4);
}, 240000);

it("keeps the sustained three-workshop trace identical with the carrier leg proof cache", () => {
  const { cached, uncached } = compare(sustained, 2400);
  expect(cached.carrierSegmentChecks).toBeLessThanOrEqual(uncached.carrierSegmentChecks * 0.2);
}, 240000);

it("measures remaining route length in O(1) from cached suffix sums", () => {
  const path = [{ x: 1, z: 0 }, { x: 1, z: 3 }, { x: 5, z: 3 }];
  const actor = { x: 0, z: 0, path, pathIndex: 0 } as SettlementActor;
  expect(remainingRouteLength(actor)).toBeCloseTo(1 + 3 + 4);
  actor.pathIndex = 1;
  actor.x = 1;
  actor.z = 1;
  expect(remainingRouteLength(actor)).toBeCloseTo(2 + 4);
  actor.pathIndex = 3;
  expect(remainingRouteLength(actor)).toBe(0);
});
