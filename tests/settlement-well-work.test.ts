import { STARTER_STOCK } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { getRomanBuildingGridMetrics } from "../src/render-common/buildings/building-grid-metrics";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { sampleWellWorkCycle, WELL_BUCKET_HANDOFF, WELL_CYCLE_SECONDS } from "../src/render-common/buildings/well-work-cycle";
import { WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { wellBucketPickupContact, wellWorkstation } from "../src/shared/settlement/settlement-well-work";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it.each([0, 1, 2, 3])("well rotation %s keeps the worker off the road and all six pickup approaches", rotation => {
  const building = { x: 10.5, y: 0, z: 10, rotation } as SettlementBuilding;
  const station = wellWorkstation(building);
  expect(isBuildingCourtyardPointWalkable(35, building.x, building.z, rotation, station.point)).toBe(true);
  for (let slot = 0; slot < 6; slot++) {
    const contact = getBuildingStockContact(35, "output", "water", slot, building.x, building.z, rotation)!;
    expect(contact).not.toBeNull();
    expect(Math.hypot(contact.approach[0] - station.point.x,
      contact.approach[2] - station.point.z)).toBeGreaterThan(WORKER_RADIUS * 2 + .02);
    expect(isBuildingCourtyardPointWalkable(35, building.x, building.z, rotation,
      { x: contact.approach[0], z: contact.approach[2] })).toBe(true);
  }
    expect(getBuildingDefinition(35).gridFootprint).toEqual([2, 2]);
  expect(getRomanBuildingGridMetrics(getBuildingDefinition(35)).scale).toBeCloseTo(.8745794398886244, 12);
});

it("lowers an empty bucket, fills at depth and reverses the crank to raise it", () => {
  const lowered = sampleWellWorkCycle(2), filled = sampleWellWorkCycle(12);
  expect(lowered.height).toBeCloseTo(-.69);
  expect(lowered.filled).toBe(false);
  expect(filled.filled).toBe(true);
  expect(sampleWellWorkCycle(1.5).angle).toBeLessThan(sampleWellWorkCycle(1.25).angle);
  expect(sampleWellWorkCycle(12.5).angle).toBeGreaterThan(sampleWellWorkCycle(12.25).angle);
  expect(sampleWellWorkCycle(13).height).toBeCloseTo(-.24);
  expect(sampleWellWorkCycle(WELL_CYCLE_SECONDS)).toEqual(sampleWellWorkCycle(0));
  expect(sampleWellWorkCycle(WELL_CYCLE_SECONDS, true)).toMatchObject({
    height: -.24, angle: 0, filled: true
  });
});

it("performs real outdoor well work and lets shared-storage carriers clear buckets without blocking", () => {
  const size = 40;
  const world = { cellsX: size, cellsZ: size, seaLevel: -1, seed: 1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), scale: new Float32Array(),
      x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: SettlementSimulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: { ...STARTER_STOCK },
    stockContact: (building, kind, ware, slot) => {
      const contact = getBuildingStockContact(building.typeId, kind, ware, slot,
        building.x, building.z, building.rotation, building.y);
      if (!contact) return null;
      return { slot, ware, approach: { x: contact.approach[0], y: contact.approach[1], z: contact.approach[2] },
        stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
        yaw: contact.wareYaw,
        scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] } };
    }
  });
  const well = simulation.placeBuilding(35, 12, 9).building!;
  expect(well).toBeDefined();
  well.construction = 1; well.required = {};
  expect(simulation.connectRoads(simulation.headquarters.access, well.access)).toBe(true);
  let workingSamples = 0;
  const phases = new Set<string>();
  let previousOutput = 0, previousPhase = "";
  const advance = (seconds: number) => {
    for (let step = 0; step < seconds * 20; step++) {
      simulation.update(.05);
      const actor = simulation.frames().find(entry => entry.job === "Well worker");
      if (actor) phases.add(actor.phase);
      const output = well.output.water ?? 0;
      if (output > previousOutput) expect(previousPhase).toBe("outputPutdown");
      previousOutput = output;
      previousPhase = actor?.phase ?? "";
      if (actor?.phase === "wellBucketWalk") {
        expect(actor.ware).toBeNull();
        expect(well.workTime).toBe(WELL_CYCLE_SECONDS);
        expect(well.wellBucketTaken).toBe(false);
      }
      if (actor?.phase === "wellBucketPickup") {
        const transfer = actor.wareTransfer!;
        expect(transfer.direction).toBe("pickup");
        expect(transfer.target).toEqual(wellBucketPickupContact(well).stock);
        expect(well.workTime).toBe(WELL_CYCLE_SECONDS);
        expect(well.wellBucketTaken).toBe(transfer.progress >= WELL_BUCKET_HANDOFF);
      }
      if (actor?.phase === "wellOutputWalk") {
        expect(actor.ware).toBe("water");
        expect(well.wellBucketTaken).toBe(true);
      }
      if (actor?.phase === "wellWork") {
        workingSamples++;
        const station = wellWorkstation(well);
        expect(Math.hypot(actor.x - station.point.x, actor.z - station.point.z)).toBeLessThan(.001);
        expect(actor.yaw).toBeCloseTo(station.yaw);
        expect(actor.ware).toBeNull();
        expect(actor.wellWork!.elapsed).toBe(well.workTime);
        expect(well.working).toBe(true);
        expect(well.wellBucketTaken).toBe(false);
      }
      expect(well.output.water ?? 0).toBeLessThanOrEqual(6);
    }
  };
  advance(180);
  expect(workingSamples).toBeGreaterThan(100);
  for (const phase of ["wellBucketWalk", "wellBucketPickup", "wellOutputWalk", "outputPutdown"])
    expect(phases.has(phase)).toBe(true);
  // Shared island storage always accepts local water; obsolete per-door overrides are ignored.
  expect(well.cycle).toBeGreaterThanOrEqual(6);
  advance(100);
  expect(simulation.headquarters.inventory.water).toBeGreaterThan(STARTER_STOCK.water ?? 0);
});
