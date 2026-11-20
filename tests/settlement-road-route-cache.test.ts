import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRoadNetwork, type RoadWorld,snapRoadPoint } from "../src/shared/settlement/road-network";
import { findRoadPath } from "../src/shared/settlement/road-pathfinding";
import { createSettlementFieldCycles } from "../src/shared/settlement/settlement-field-cycles";
import { createOccupancyChanges } from "../src/shared/settlement/settlement-occupancy-changes";
import { bumpNavigationRevision, createSettlementReservations } from "../src/shared/settlement/settlement-reservations";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { explainWorldNavigationChange } from "../src/shared/world/navigation-change-log";
import { BLOCKING, BUILD, type WorldData } from "../src/shared/world/world-data";

const roadWorld = (size = 16): RoadWorld => ({
  cellsX: size,
  cellsZ: size,
  heights: new Float32Array((size + 1) ** 2),
  blocking: new Uint8Array(size ** 2)
});
/** A straight road along z=4 and a longer loop through z=6 between the same two junctions. */
const buildLoop = (roads: ReturnType<typeof createRoadNetwork>) => {
  roads.addRoad({ x: 2, z: 4 }, { x: 9, z: 4 });
  roads.addRoad({ x: 2, z: 4 }, { x: 2, z: 6 });
  roads.addRoad({ x: 2, z: 6 }, { x: 9, z: 6 });
  roads.addRoad({ x: 9, z: 6 }, { x: 9, z: 4 });
};
const from = { x: 2, z: 4 },
  to = { x: 9, z: 4 };

describe("road route cache", () => {
  it("verifies cache hits by default inside vitest", () => {
    expect(import.meta.env.DEV).toBe(true);
  });

  it("returns a fresh array for every caller and counts hits and misses", () => {
    const roads = createRoadNetwork(roadWorld());
    buildLoop(roads);
    const first = roads.route(from, to)!;
    const second = roads.route(from, to)!;
    expect(second.points).not.toBe(first.points);
    expect(second.points).toEqual(first.points);
    expect(second.length).toBe(7);
    expect(roads.routeStats()).toEqual({ calls: 2, hits: 1, misses: 1 });
  });

  it("follows the occupancy revision and never memoizes an unrevisioned blocker", () => {
    const blocked = new Set<number>();
    let revision = 0;
    const isBlocked = (x: number, z: number) => blocked.has(Math.floor(z) * 16 + Math.floor(x));
    const revisioned = createRoadNetwork(roadWorld(), { isBlocked, occupancyRevision: () => revision });
    const live = createRoadNetwork(roadWorld(), { isBlocked });
    buildLoop(revisioned);
    buildLoop(live);
    expect(revisioned.route(from, to)?.length).toBe(7);
    blocked.add(3 * 16 + 5);
    revision++;
    expect(revisioned.route(from, to)?.length).toBe(11);
    expect(live.route(from, to)?.length).toBe(11);
    expect(live.route(from, to)?.length).toBe(11);
    expect(live.routeStats().hits).toBe(0);
  });

  it("throws in the verifier when an occupancy change skipped its revision", () => {
    let blockedCell = -1;
    const roads = createRoadNetwork(roadWorld(), {
      isBlocked: (x, z) => Math.floor(z) * 16 + Math.floor(x) === blockedCell,
      occupancyRevision: () => 0,
      verifyRouteCache: 1
    });
    buildLoop(roads);
    roads.route(from, to);
    blockedCell = 3 * 16 + 5;
    expect(() => roads.route(from, to)).toThrow(/Stale road route cache/);
  });

  it("re-routes when a field is reserved or sown beside the road", () => {
    const world = { ...roadWorld(), walkCost: new Uint8Array(256).fill(10),
      buildClass: new Uint8Array(256).fill(4) } as unknown as WorldData;
    const context = { options: { world, findWorkerPath: (_from: unknown, point: unknown) => [point] },
      buildings: [], occupied: new Uint8Array(256), navigationRevision: 0 } as unknown as SettlementContext;
    context.reservations = createSettlementReservations(context);
    const cycles = createSettlementFieldCycles(context);
    const roads = createRoadNetwork(world, {
      isBlocked: (x, z) => cycles.isOccupied(x, z),
      occupancyRevision: () => context.navigationRevision ?? 0
    });
    buildLoop(roads);
    expect(roads.route(from, to)?.length).toBe(7);
    context.reservations.add(`field:${3 * 16 + 5}`);
    expect(roads.route(from, to)?.length).toBe(11);
    context.reservations.delete(`field:${3 * 16 + 5}`);
    expect(roads.route(from, to)?.length).toBe(7);
    const farm = { uid: 1, typeId: 5, input: {}, x: 6, z: 2, access: { x: 6, z: 2 } } as SettlementBuilding;
    expect(cycles.complete(farm, { kind: "field", id: 3 * 16 + 6, x: 6.5, z: 3.5 }).success).toBe(true);
    expect(roads.route(from, to)?.length).toBe(11);
  });

  it("keeps its routes across a field change away from the road and re-routes beside it (A04b)", () => {
    const world = { ...roadWorld(), walkCost: new Uint8Array(256).fill(10),
      buildClass: new Uint8Array(256).fill(4) } as unknown as WorldData;
    const context = { options: { world, findWorkerPath: (_from: unknown, point: unknown) => [point] },
      buildings: [], occupied: new Uint8Array(256), navigationRevision: 0 } as unknown as SettlementContext;
    context.reservations = createSettlementReservations(context);
    const cycles = createSettlementFieldCycles(context);
    context.fieldCycles = cycles;
    const isBlocked = (x: number, z: number) =>
      context.occupied[Math.floor(z) * 16 + Math.floor(x)] === 1 || cycles.isOccupied(x, z);
    const roads = createRoadNetwork(world, { isBlocked, verifyRouteCache: 1 });
    roads.trackOccupancy(() => context.navigationRevision ?? 0, createOccupancyChanges(context));
    buildLoop(roads);
    expect(roads.route(from, to)?.length).toBe(7);
    context.reservations.add(`field:${12 * 16 + 12}`);
    expect(roads.route(from, to)?.length).toBe(7);
    expect(roads.routeStats()).toMatchObject({ hits: 1, misses: 1 });
    context.reservations.add(`field:${3 * 16 + 5}`);
    expect(roads.route(from, to)?.length).toBe(11);
    context.reservations.delete(`field:${3 * 16 + 5}`);
    expect(roads.route(from, to)?.length).toBe(7);
    // An `occupied` write without its own revision step is still found beside a later field change.
    context.occupied[3 * 16 + 5] = 1;
    context.reservations.add(`field:${13 * 16 + 13}`);
    expect(roads.route(from, to)?.length).toBe(11);
    context.occupied[3 * 16 + 5] = 0;
    bumpNavigationRevision(context);
    expect(roads.route(from, to)?.length).toBe(7);
    expect(roads.routeStats().misses).toBe(5);
  });

  it("reads the first cell of the next row for a sample on the east border", () => {
    const occupied = new Uint8Array(256);
    let revision = 0;
    const cells: number[] = [];
    const roads = createRoadNetwork(roadWorld(), {
      isBlocked: (x, z) => occupied[Math.floor(z) * 16 + Math.floor(x)] === 1, verifyRouteCache: 1
    });
    roads.trackOccupancy(() => revision, { changedCells: () => cells.splice(0), mark: () => undefined });
    // The last step ends on the border: its end samples (x = 16, z ≈ 4.5) read cell 4 * 16 + 16.
    const border = Array.from({ length: 4 }, (_, step) =>
      ({ start: { x: 14 + step / 2, z: 4.5 }, end: { x: 14.5 + step / 2, z: 4.5 }, tier: "dirt" as const }));
    expect(roads.replaceSegments(border)).toBe(true);
    expect(roads.route({ x: 14, z: 4.5 }, { x: 16, z: 4.5 })?.length).toBe(2);
    occupied[5 * 16] = 1;
    cells.push(5 * 16);
    revision++;
    expect(roads.route({ x: 14, z: 4.5 }, { x: 16, z: 4.5 })).toBeNull();
  });

  it("keeps its routes across an explained blocking change away from the road and re-routes beside it", () => {
    const world = { ...roadWorld(), buildRevision: 0 };
    const roads = createRoadNetwork(world);
    buildLoop(roads);
    const change = (x: number, z: number, blocking: number) =>
      explainWorldNavigationChange(world, { maxX: x, maxZ: z, minX: x, minZ: z }, () => {
        world.blocking[z * 16 + x] = blocking;
        world.buildRevision++;
      });
    expect(roads.route(from, to)?.length).toBe(7);
    change(12, 12, BLOCKING.prop);
    expect(roads.route(from, to)?.length).toBe(7);
    expect(roads.routeStats()).toMatchObject({ hits: 1, misses: 1 });
    change(5, 3, BLOCKING.prop);
    expect(roads.route(from, to)?.length).toBe(11);
    expect(roads.routeStats()).toMatchObject({ hits: 1, misses: 2 });
    change(5, 3, BLOCKING.free);
    expect(roads.route(from, to)?.length).toBe(7);
  });

  it("reports an exhausted search apart from a proven dead end", () => {
    const line = (node: number, visit: (next: number, cost: number) => void) => visit(node + 1, 1);
    expect(findRoadPath(0, 10, line, () => 0, 4).status).toBe("search-limit");
    expect(findRoadPath(0, 10, () => undefined, () => 0).status).toBe("no-path");
    expect(findRoadPath(0, 3, line, () => 0)).toEqual({ status: "found", cost: 3, path: [0, 1, 2, 3] });
  });

  it("runs one A* per distinct pair and revision in the overcrowded fixture", () => {
    const size = 64;
    const world = { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 25, z: 20 },
      heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
      props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
        scale: new Float32Array() } } as unknown as WorldData;
    let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
    const saved = JSON.parse(readFileSync(new URL("./fixtures/settlement-mixed-overcrowded.json",
      import.meta.url), "utf8"));
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const distinct = new Set<string>();
    const route = roads.route;
    const results: unknown[] = [];
    roads.route = (start, end) => {
      const a = snapRoadPoint(start), b = snapRoadPoint(end);
      if (a.x !== b.x || a.z !== b.z) distinct.add(`${a.x},${a.z}>${b.x},${b.z}@${roads.revision}`);
      const result = route(start, end);
      if (result) results.push(result.points);
      return result;
    };
    const stoneRoute = roads.stoneRoute;
    roads.stoneRoute = (start, end) => {
      const a = snapRoadPoint(start), b = snapRoadPoint(end);
      if (a.x !== b.x || a.z !== b.z) distinct.add(`stone ${a.x},${a.z}>${b.x},${b.z}@${roads.revision}`);
      return stoneRoute(start, end);
    };
    const routeMetrics = roads.routeMetrics;
    roads.routeMetrics = (start, end) => {
      const a = snapRoadPoint(start), b = snapRoadPoint(end);
      if (a.x !== b.x || a.z !== b.z) distinct.add(`metrics ${a.x},${a.z}>${b.x},${b.z}@${roads.revision}`);
      return routeMetrics(start, end);
    };
    const before = roads.routeStats();
    for (let tick = 0; tick < 2400; tick++) simulation.update(0.05);
    const stats = roads.routeStats();
    expect(stats.calls - before.calls).toBeGreaterThan(1000);
    expect(stats.misses - before.misses).toBeLessThanOrEqual(Math.ceil(distinct.size * 1.1));
    expect(new Set(results).size).toBe(results.length);
  }, 120000);
});
