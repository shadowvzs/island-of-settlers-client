import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { storageDoorLanePoint } from "../src/shared/settlement/settlement-storage-door-lanes";
import type { SettlementOptions } from "../src/shared/settlement/settlement-types";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = (hooks: Partial<SettlementOptions> = {}) => {
  const size = 40;
  const world = { cellsX: size, cellsZ: size, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 1, types: new Uint8Array([PROP.broadleafTree]), scale: new Float32Array([1]),
      x: new Float32Array([17]), z: new Float32Array([12]) }
  } as unknown as WorldData;
  let simulation: SettlementSimulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: { ...STARTER_STOCK }, ...hooks });
  const [width, depth] = getBuildingDefinition(17).gridFootprint;
  const building = simulation.placeBuilding(17, 10 + width / 2, 6 + depth / 2).building!;
  expect(building).toBeDefined();
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  return { simulation, building };
};

describe("visible worker load sequence", () => {
  it("loads a carrier inside headquarters before its first visible step out", () => {
    const { simulation } = fixture();
    let carrier;
    for (let step = 0; step < 500; step++) {
      simulation.update(0.05);
      carrier = simulation.frames().find((actor) => actor.job === "Carrier" && actor.visible);
      if (carrier) break;
    }
    expect(carrier).toBeDefined();
    expect(carrier!.phase).toBe("exitLoaded");
    expect(carrier!.ware).toBe(carrier!.delivery!.ware);
    expect(carrier!.action).toBe("carry");
    // The headquarters' double door sends outgoing feet through its own lane (STORAGE_DOOR_LANE_OFFSET).
    const exit = storageDoorLanePoint(simulation.headquarters, simulation.headquarters.doorThreshold, "out");
    expect(Math.hypot(carrier!.x - exit.x, carrier!.z - exit.z)).toBeLessThan(0.2);
  });

  it("keeps the woodcutter empty handed through chopping and falling, then carries the landed trunk", () => {
    let phase: ReturnType<NonNullable<SettlementOptions["getFelledTreePhase"]>> = "chopping";
    let started = 0;
    const { building, simulation } = fixture({
      onFellTree: () => { started++; return true; },
      getFelledTreePhase: () => phase
    });
    for (let step = 0; step < 6000 && !started; step++) simulation.update(0.05);
    expect(started).toBe(1);
    const woodcutter = simulation.frames().find((actor) => actor.job === "Woodcutter")!;
    expect(woodcutter.phase).toBe("waitTreeFall");
    expect(woodcutter.ware).toBeNull();
    expect(woodcutter.action).toBe("chop");
    phase = "falling";
    for (let step = 0; step < 30; step++) simulation.update(0.05);
    expect(woodcutter.ware).toBeNull();
    expect(woodcutter.action).toBe("idle");
    expect(building.output.logs ?? 0).toBe(0);
    phase = "fallen";
    simulation.update(0.1);
    expect(woodcutter.ware).toBe("logs");
    expect(woodcutter.action).toBe("carry");
    expect(woodcutter.phase).toBe("outputWalk");
    expect(started).toBe(1);
  });
});
