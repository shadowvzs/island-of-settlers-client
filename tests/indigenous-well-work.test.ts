import { STARTER_STOCK } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { sampleWellWorkCycle, WELL_CYCLE_SECONDS, wellCrankHandTarget } from "../src/render-common/buildings/well-work-cycle";
import { WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { wellWorkstation } from "../src/shared/settlement/settlement-well-work";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (rotation = 0, playerNation: "indigenous" | "roman" = "indigenous") => {
  const size = 40;
  const world = { cellsX: size, cellsZ: size, seaLevel: -1, seed: 1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), scale: new Float32Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: SettlementSimulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, playerNation, initialSettlers: 1, initialStock: { ...STARTER_STOCK, cloth: 20 },
    stockContact: (building, kind, ware, slot) => {
      const contact = getBuildingStockContact(building.typeId, kind, ware, slot,
        building.x, building.z, building.rotation, building.y);
      if (!contact) return null;
      return { slot, ware, approach: { x: contact.approach[0], y: contact.approach[1], z: contact.approach[2] },
        stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] }, yaw: contact.wareYaw,
        scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] } };
    }
  });
  const result = simulation.placeBuilding(35, 12, 9, rotation);
  expect(result.ok, result.reason).toBe(true);
  const well = result.building!; well.construction = 1; well.required = {};
  expect(simulation.connectRoads(simulation.headquarters.access, well.access)).toBe(true);
  return { simulation, well };
};

it("retains the ordinary 14-second crank cycle while lowering the bucket into the open boulder shaft", () => {
  expect(WELL_CYCLE_SECONDS).toBe(14);
  expect(1.04 + sampleWellWorkCycle(2).height).toBeLessThan(.53);
  expect(1.04 + sampleWellWorkCycle(13).height).toBeGreaterThan(.53);
  expect(sampleWellWorkCycle(12).filled).toBe(true);
});

it.each([0, 1, 2, 3])("rotation %s reaches the regular crank, draws water and hands off one real bucket", rotation => {
  const { simulation, well } = fixture(rotation);
  for (let level = 2; level <= 5; level++) expect(simulation.debugRaiseBuildingLevel(well.uid).ok).toBe(true);
  const definition = getBuildingDefinition(35), { scale } = getRomanBuildingWorldSizing(definition);
  const recipe = leveledBuildingRecipe(definition, "indigenous", true, 5);
  expect(recipe.parts.some(part => part.occupationRoof === "gable" && part.surface === "cloth-water"))
    .toBe(true);
  const lamp = recipe.parts.find(part => part.surface === "amber")!;
  const angle = rotation * Math.PI / 2;
  const lampX = well.x + (lamp.position[0] * Math.cos(angle) + lamp.position[2] * Math.sin(angle)) * scale;
  const lampZ = well.z + (-lamp.position[0] * Math.sin(angle) + lamp.position[2] * Math.cos(angle)) * scale;
  const phases = new Set<string>(); let work = 0;
  for (let tick = 0; tick < 12_000 && (well.output.water ?? 0) < 6; tick++) {
    simulation.update(.05);
    const actor = simulation.frames().find(entry => entry.job === "Well worker");
    if (!actor) continue;
    expect(Math.hypot(actor.x - lampX, actor.z - lampZ), `${actor.phase}: actual body clears upgraded lamp`)
      .toBeGreaterThan(WORKER_RADIUS + .07 * scale);
    phases.add(actor.phase);
    if (actor.phase === "wellWork") {
      work++;
      const station = wellWorkstation(well, "indigenous");
      expect(actor.wellWork?.style).toBeUndefined();
      expect(actor.timer + actor.wellWork!.elapsed).toBeCloseTo(14, 8);
      expect(Math.hypot(actor.x - station.point.x, actor.z - station.point.z)).toBeLessThan(.001);
      const target = wellCrankHandTarget(actor.wellWork!);
      expect(target.every(Number.isFinite)).toBe(true);
    }
  }

  expect(work).toBeGreaterThan(10);
  expect(phases.has("wellBucketPickup"), JSON.stringify([...phases])).toBe(true);
  expect(phases.has("wellOutputWalk")).toBe(true);
  expect(well.output.water).toBe(6);
});

it.each([false, true])("preserves an in-progress well's goods and remaining work when reloading (legacy=%s)", legacy => {
  const { simulation, well } = fixture(2);
  for (let tick = 0; tick < 4000; tick++) {
    simulation.update(.05);
    if (simulation.frames().some(actor => actor.phase === "wellWork" && actor.timer < 8)) break;
  }
  const saved = simulation.saveState();
  const actor = saved.actors.find(entry => entry.phase === "wellWork")!;
  expect(actor).toBeDefined();
  const remaining = actor.timer;
  const goods = JSON.stringify(saved.buildings.map(entry => ({ input: entry.input, output: entry.output,
    inventory: entry.inventory, cycle: entry.cycle })));
  if (legacy) {
    const old = wellWorkstation(well, "roman");
    const x = -.18 * old.frame.scale, z = .25 * old.frame.scale;
    const angle = well.rotation * Math.PI / 2;
    actor.x = well.x + x * Math.cos(angle) + z * Math.sin(angle);
    actor.z = well.z - x * Math.sin(angle) + z * Math.cos(angle);
    actor.wellWork = { ...old.frame, elapsed: 14 - remaining, style: "hand-rope" };
  }
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const restored = simulation.saveState();
  expect(JSON.stringify(restored.buildings.map(entry => ({ input: entry.input, output: entry.output,
    inventory: entry.inventory, cycle: entry.cycle })))).toBe(goods);
  const worker = restored.actors.find(entry => entry.uid === actor.uid)!;
  expect(worker.timer).toBe(remaining);
  expect(worker.wellWork?.style).toBeUndefined();
  const liveWell = simulation.buildings().find(entry => entry.uid === well.uid)!;
  const station = wellWorkstation(liveWell, "indigenous");
  expect(Math.hypot(worker.x - station.point.x, worker.z - station.point.z)).toBeLessThan(.001);
  for (let tick = 0; tick < 4000 && (liveWell.output.water ?? 0) < 1; tick++) simulation.update(.05);
  expect(liveWell.output.water).toBe(1);
  expect(liveWell.cycle).toBe(1);
});
