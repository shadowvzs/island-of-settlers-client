import { describe, expect, it } from "vitest";

import { productionTimeScale } from "../src/shared/settlement/production-timing";
import { startForesterPickup, updateForester } from "../src/shared/settlement/settlement-forester-work";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { workerCycleRate } from "../src/shared/settlement/workshop-upgrades";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const worldFixture = (size = 48) => ({
  seed: 7, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
  heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
  slopeClass: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
  buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
    scale: new Float32Array() }, mineZones: [], oreAmount: new Uint8Array(size ** 2),
  mineZone: new Uint16Array(size ** 2)
}) as unknown as WorldData;

const nurseryCycle = (typeId: number, upgraded: boolean, success: boolean, restore = false) => {
  const world = worldFixture();
  let planted = 0, serialized = false;
  const context = { options: { world, roads: { route: () => null },
    findWorkerPath: (_from: unknown, to: unknown) => [to],
    onPlantTree: () => { planted++; return success; } }, buildings: [], actors: [],
    occupied: new Uint8Array(world.cellsX ** 2), reservations: new Set(["plant:1"]),
    nextBuilding: 0, resourceAmounts: new Map()
  } as unknown as SettlementContext;
  // Both nurseries share this existing entrance; the helper receives authoritative building type.
  let building = makeBuilding(context, 20, 20, 20);
  Object.assign(building, { typeId, construction: 1, worker: 0, workshopUpgrade: upgraded ? { level: 1 } : undefined });
  let actor = { uid: 0, home: 0, job: "Forester", tool: "shovel", building: building.uid,
    x: building.access.x, z: building.access.z, y: 0, visible: true, yaw: 0, ware: null,
    action: "idle", phase: "inside", timer: 0, path: [], pathIndex: 0, animationTime: 0,
    preparedTarget: { id: 1, kind: "plant", x: 26.5, z: 26.5 }
  } as SettlementActor;
  context.buildings.push(building); context.actors.push(actor);
  startForesterPickup(context, actor, building);
  const phases: Record<string, number> = {};
  for (let tick = 0; tick < 6000 && actor.phase.startsWith("forester"); tick++) {
    const phase = actor.phase;
    phases[phase] = (phases[phase] ?? 0) + .01;
    // The simulation loop scales the worker's in-place time the same way.
    updateForester(context, actor, building, .01 * workerCycleRate(context, actor));
    if (restore && !serialized && actor.phase === "foresterPlant" && actor.timer < 4) {
      const saved = JSON.parse(JSON.stringify({ actor, building }));
      actor = saved.actor; building = saved.building;
      context.actors[0] = actor; context.buildings[0] = building; serialized = true;
    }
  }
  expect(actor.phase).toBe("outputWalk");
  expect(planted).toBe(1); expect(context.reservations.size).toBe(0);
  expect(building.nurserySeedlingTaken).toBe(false);
  expect(actor.foresterSeedling).toBeUndefined();
  return { phases, serialized };
};

describe("upgraded nursery in-place work runs 10% faster (2026-10-19)", () => {
  it.each([20, 41])("plays nursery %i pickup and planting 10%% faster with unchanged walks and planting count", typeId => {
    const base = nurseryCycle(typeId, false, true).phases;
    const upgraded = nurseryCycle(typeId, true, true).phases;
    // Halved production times and the hardwood tier (BAL-01) scale both runs.
    const scale = productionTimeScale(typeId);
    expect(base.foresterPlant).toBeCloseTo(8 * scale, 1);
    expect(upgraded.foresterPlant).toBeCloseTo(8 * scale / 1.1, 1);
    expect(upgraded.foresterPickup).toBeCloseTo(scale / 1.1, 1);
    for (const phase of ["foresterPickupWalk", "foresterPlantWalk"])
      expect(upgraded[phase]).toBeCloseTo(base[phase]!, 2);
  });
  it("returns a failed sapling faster without creating another tree or losing its nursery stock", () => {
    const base = nurseryCycle(20, false, false).phases;
    const upgraded = nurseryCycle(20, true, false).phases;
    const scale = productionTimeScale(20);
    expect(base.foresterReturn).toBeCloseTo(scale, 1);
    expect(upgraded.foresterReturn).toBeCloseTo(scale / 1.1, 1);
    expect(upgraded.foresterReturnWalk).toBeCloseTo(base.foresterReturnWalk!, 2);
  });
  it("retains exact nursery progress when its existing actor/building state is serialized mid-plant", () => {
    const resumed = nurseryCycle(41, true, true, true);
    expect(resumed.serialized).toBe(true);
    expect(resumed.phases).toEqual(nurseryCycle(41, true, true).phases);
  });
});
