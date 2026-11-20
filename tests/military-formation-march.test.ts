import { describe, expect, it } from "vitest";

import {
  assignFormationSlots, assignGroupFormation, type FormationKind,
groupMarchPaces} from "../src/shared/settlement/military-formation";
import { militaryGroundPath } from "../src/shared/settlement/military-routing";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { searchGroundPath } from "../src/shared/settlement/settlement-navigation";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const flatWorld = (size: number) => ({ seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
  heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
  walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

const simulationOn = (world: WorldData) => {
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20, canWorkerEnterPlot: () => true });
  return simulation;
};

describe("military group marches", () => {
  it("gives the soldiers furthest ahead the front row and keeps each row's left-to-right order", () => {
    const starts = [{ x: 10, z: 0 }, { x: 10, z: 2 }, { x: 12, z: 0 }, { x: 12, z: 2 }];
    // Marching west (−x): the soldiers at x = 10 lead, so they take the front (west) row.
    const slots = assignFormationSlots(starts, { x: 0, z: 1 }, 2, () => true) as SettlementPoint[];
    expect(slots[0]!.x).toBeLessThan(slots[2]!.x);
    expect(slots[1]!.x).toBeLessThan(slots[3]!.x);
    expect(slots[0]!.z).toBeLessThan(slots[1]!.z);
    expect(slots[2]!.z).toBeLessThan(slots[3]!.z);
  });

  it("gathers a mixed group tightly: foot block, archers behind, riders on both flanks", () => {
    const kinds = [...Array(24).fill("foot"), ...Array(8).fill("archer"), ...Array(8).fill("rider")] as FormationKind[];
    // Marching north (+z) from the south.
    const starts = kinds.map((_, index) => ({ x: 20 + (index % 8), z: Math.floor(index / 8) }));
    const destination = { x: 24, z: 30 };
    const slots = assignGroupFormation(starts, kinds, destination, () => true) as SettlementPoint[];
    const ofKind = (kind: FormationKind) => slots.filter((_, index) => kinds[index] === kind);
    const radius = (points: readonly SettlementPoint[]) =>
      Math.max(...points.map(point => Math.hypot(point.x - destination.x, point.z - destination.z)));
    expect(radius(ofKind("foot"))).toBeLessThan(2);
    expect(radius(slots)).toBeLessThan(6);
    const front = Math.min(...ofKind("foot").map(point => point.z));
    expect(Math.max(...ofKind("archer").map(point => point.z))).toBeLessThan(front);
    const riders = ofKind("rider");
    expect(riders.some(point => point.x < 22) && riders.some(point => point.x > 26)).toBe(true);
    for (const [index, point] of slots.entries()) for (const other of slots.slice(index + 1))
      expect(Math.hypot(point.x - other.x, point.z - other.z)).toBeGreaterThan(.45);
  });

  it("paces a group so the whole block arrives together", () => {
    const paces = groupMarchPaces([
      { goal: { x: 20, z: 0 }, speed: 3.6, start: { x: 0, z: 0 } },
      { goal: { x: 10, z: 0 }, speed: 1.4, start: { x: 0, z: 0 } },
      { goal: { x: .1, z: 0 }, speed: 1.4, start: { x: 0, z: 0 } }
    ]);
    expect(paces[0]).toBeCloseTo(1.4);
    expect(paces[1]).toBeCloseTo(.7);
    expect(paces[2]).toBeCloseTo(1.4 * .4);
  });
});

describe("long military routes", () => {
  /** Three water walls with gaps at alternating ends: the route winds about 400 tiles across 220. */
  const serpentine = () => {
    const world = flatWorld(220);
    for (const [wallX, open] of [[60, "south"], [110, "north"], [160, "south"]] as const)
      for (let z = 0; z < 220; z++) {
        if (open === "south" ? z >= 200 : z < 20) continue;
        for (let x = wallX; x < wallX + 3; x++) world.walkCost[z * 220 + x] = 0;
      }
    return world;
  };

  it("finds a 130+ tile route the fine search alone cannot, for foot and mounted soldiers", () => {
    const world = serpentine();
    const context = { options: { world }, occupied: new Uint8Array(220 * 220), buildings: [], actors: [] } as
      unknown as SettlementContext;
    const from = { x: 20.5, z: 100.5 }, to = { x: 200.5, z: 100.5 };
    expect(searchGroundPath(context, from, to).status).toBe("budget-exhausted");
    for (const mounted of [false, true]) {
      const path = militaryGroundPath(context, from, to, mounted);
      expect(path?.at(-1)).toEqual(to);
      expect(path!.every(point => world.walkCost[Math.floor(point.z) * 220 + Math.floor(point.x)]! > 0)).toBe(true);
    }
  });

  it("refuses a far order across water no corridor crosses", () => {
    const world = flatWorld(220);
    for (let z = 0; z < 220; z++) for (let x = 100; x < 103; x++) world.walkCost[z * 220 + x] = 0;
    const simulation = simulationOn(world);
    const ids = [simulation.spawnMilitaryOpponent({ x: 20, z: 100 }, "cavalry", 0, 1)!,
      simulation.spawnMilitaryOpponent({ x: 22, z: 100 }, "shield", 0, 1)!];
    expect(simulation.commandMilitaryOpponent(ids, { x: 200, z: 100 }, 1, "move")).toBe(false);
    expect(simulation.commandMilitaryOpponent(ids, { x: 80, z: 160 }, 1, "move")).toBe(true);
  });

  it("marches an ordered group across the island and arrives", () => {
    const simulation = simulationOn(serpentine());
    const ids = [simulation.spawnMilitaryOpponent({ x: 20, z: 100 }, "cavalry", 0, 1)!,
      simulation.spawnMilitaryOpponent({ x: 22, z: 100 }, "shield", 0, 1)!];
    const started = performance.now();
    expect(simulation.commandMilitaryOpponent(ids, { x: 200, z: 100 }, 1, "move")).toBe(true);
    // Idle cost ~95–110 ms (2026-10-19, same as HEAD); full-suite load reaches ~270 ms. The guard catches
    // a whole-route stall like the old 931 ms call-out, not scheduler noise.
    expect(performance.now() - started).toBeLessThan(400);
    for (let tick = 0; tick < 20 * 600; tick++) simulation.update(.05);
    for (const id of ids) {
      const actor = simulation.frames().find(entry => entry.uid === id)!;
      expect(Math.hypot(actor.x - 200, actor.z - 100)).toBeLessThan(3);
    }
  });
});
