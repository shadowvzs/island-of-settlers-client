import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** Real recruitment, outdoor work, crop growth, harvest, output trip and rest at fixed ticks. */
const measure = (type: number, upgraded: boolean) => {
  const size = 40;
  const world = { seed: 7, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), scale: new Float32Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, playerNation: "roman", initialStock: { ...STARTER_STOCK, grain: 0, grapes: 0 } });
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, Math.floor(14 - width / 2) + width / 2,
    Math.floor(12 - depth / 2) + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const building = placed.building!;
  Object.assign(building, { construction: 1, required: {}, workshopUpgrade: upgraded ? { level: 1 } : undefined });
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  const job = type === 37 ? "Farmer" : "Winegrower", ware = type === 37 ? "grain" : "grapes";
  const spans: Array<{ phase: string; start: number; seconds: number }> = [];
  const planted = new Map<number, number>(), ripened = new Map<number, number>();
  let firstHarvest = -1, deposited = -1, finished = -1, clipSamples = 0;
  for (let tick = 0; tick < 16000 && finished < 0; tick++) {
    const time = tick * .05;
    const actor = simulation.frames().find(candidate => candidate.job === job);
    let phase = actor?.phase ?? "recruitment";
    if (actor?.phase === "work") phase = `work:${actor.fieldWork ?? "plant"}`;
    const last = spans.at(-1);
    if (last?.phase === phase) last.seconds += .05;
    else spans.push({ phase, seconds: .05, start: time });
    const previous = actor && { phase: actor.phase, action: actor.action, animationTime: actor.animationTime, timer: actor.timer };
    simulation.update(.05);
    if (actor && previous?.phase === "work" && actor.phase === "work" && actor.action === previous.action) {
      const expectedStep = .1 * (upgraded ? 1.1 : 1);
      expect(actor.timer).toBeCloseTo(previous.timer - expectedStep, 8);
      expect(actor.animationTime).toBeCloseTo(previous.animationTime + expectedStep, 8);
      if (actor.fieldWork === "harvest") {
        const field = simulation.fieldFrames().find(site => site.id === actor.target?.id);
        expect(field?.harvest).toBeCloseTo(1 - actor.timer / 24, 8);
      }
      clipSamples++;
    }
    for (const field of simulation.fieldFrames()) {
      if (!planted.has(field.id)) planted.set(field.id, time + .05);
      if (field.state === "ripe" && !ripened.has(field.id)) ripened.set(field.id, time + .05);
    }
    if (actor?.phase === "work" && actor.fieldWork === "harvest" && firstHarvest < 0) firstHarvest = time + .05;
    const count = (building.output[ware] ?? 0) + (simulation.headquarters.inventory[ware] ?? 0);
    if (count > 0 && deposited < 0) deposited = time + .05;
    if (deposited >= 0 && previous?.phase === "rest" && actor?.phase !== "rest") finished = time + .05;
  }
  expect(firstHarvest).toBeGreaterThan(0);
  expect(deposited).toBeGreaterThan(firstHarvest);
  expect(finished).toBeGreaterThan(deposited);
  expect(clipSamples).toBeGreaterThan(50);
  const growth = [...ripened].map(([id, time]) => time - planted.get(id)!);
  expect(growth.length).toBeGreaterThan(0);
  for (const seconds of growth) expect(seconds).toBeCloseTo(type === 37 ? 120 : 150, 1);
  return { deposited, finished, firstHarvest, growth: growth[0], spans };
};

describe("BAL-01 separate production and crop clocks", () => {
  it.each([37, 5])("building %i completes planting, unscaled growth, harvest, delivery and rest", type => {
    const base = measure(type, false), upgraded = measure(type, true);
    const first = (run: typeof base, phase: string) => run.spans.find(span => span.phase === phase)!.seconds;
    const planting = type === 37 ? "work:sow" : "work:plant";
    expect(first(base, planting)).toBeCloseTo(type === 37 ? 1.8 : 12, 1);
    expect(first(base, "work:harvest")).toBeCloseTo(12, 1);
    expect(first(base, "rest")).toBeCloseTo(1, 1);
    expect(first(upgraded, planting)).toBeCloseTo(first(base, planting) / 1.1, 1);
    expect(first(upgraded, "work:harvest")).toBeCloseTo(12 / 1.1, 1);
    expect(first(upgraded, "rest")).toBeCloseTo(1 / 1.1, 1);
    // Same initial path, same walking clock despite different production upgrade levels.
    for (const phase of ["assigned", "outbound"])
      expect(first(upgraded, phase)).toBeCloseTo(first(base, phase), 8);
    console.info(JSON.stringify({ base, type, upgraded }));
  });
});
