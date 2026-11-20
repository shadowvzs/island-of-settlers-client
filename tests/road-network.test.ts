import { ROAD_SPEED } from "@shared/catalog/balance";
import { expect, it, vi } from "vitest";

import { ROAD_STONE_COST } from "../src/shared/balance/economy";
import { createRoadNetwork, type RoadWorld } from "../src/shared/settlement/road-network";
import { BLOCKING } from "../src/shared/world/world-data";

const world = (): RoadWorld => ({
  cellsX: 8,
  cellsZ: 8,
  heights: new Float32Array(81),
  blocking: new Uint8Array(64)
});
const start = { x: 1, z: 1 },
  end = { x: 4, z: 1 };
/**
 * A long dirt road with a parallel stone detour 1.5 cells away: the closest a parallel road may run
 * now that every road reserves the 1.2 stone width (half-cell detours overlap that strip).
 */
const detourWorld = (): RoadWorld => ({
  cellsX: 16, cellsZ: 16, heights: new Float32Array(17 * 17), blocking: new Uint8Array(256)
});
const detour = { end: { x: 10, z: 1 }, left: { x: 1, z: 2.5 }, right: { x: 10, z: 2.5 }, start: { x: 1, z: 1 } };

it("previews and builds the missing section at both ends of a new dirt road", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad({ x: 1, z: 3 }, { x: 2, z: 3 });
  roads.addRoad({ x: 5, z: 3 }, { x: 6, z: 3 });
  const before = roads.segments();
  const plan = roads.planRoad({ x: 2.5, z: 3 }, { x: 4.5, z: 3 })!;
  expect(plan.points[0]).toEqual({ x: 2, z: 3 });
  expect(plan.points.at(-1)).toEqual({ x: 5, z: 3 });
  expect(roads.segments()).toEqual(before);
  expect(roads.addRoad({ x: 2.5, z: 3 }, { x: 4.5, z: 3 })).toBe(true);
  expect(roads.route({ x: 1, z: 3 }, { x: 6, z: 3 })?.length).toBe(5);
  expect(roads.segments().slice(before.length)).toEqual(plan.segments);
});

it("connects an endpoint to the side of an existing road", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad({ x: 1, z: 3 }, { x: 6, z: 3 });
  roads.addRoad({ x: 3, z: 1 }, { x: 3, z: 2.5 });
  expect(roads.route({ x: 3, z: 1 }, { x: 6, z: 3 })).not.toBeNull();
});

it("does not complete distant, diagonal or blocked endpoint gaps", () => {
  let blockConnector = false;
  const roads = createRoadNetwork(world(), {
    isBlocked: (x, z) => blockConnector && x > 2.05 && x < 2.45 && Math.abs(z - 3) < 0.05
  });
  roads.addRoad({ x: 1, z: 3 }, { x: 2, z: 3 });
  blockConnector = true;
  expect(roads.planRoad({ x: 2.5, z: 3 }, { x: 5, z: 3 })?.points[0])
    .toEqual({ x: 2.5, z: 3 });
  blockConnector = false;
  expect(roads.planRoad({ x: 3, z: 3 }, { x: 5, z: 3 })?.points[0])
    .toEqual({ x: 3, z: 3 });
  expect(roads.planRoad({ x: 2.5, z: 3.5 }, { x: 5, z: 3.5 })?.points[0])
    .toEqual({ x: 2.5, z: 3.5 });
});

it("connects only built road endpoints and supports intersecting half-cell paths", () => {
  const roads = createRoadNetwork(world());
  expect(roads.route(start, end)).toBeNull();
  expect(roads.addRoad(start, end)).toBe(true);
  expect(roads.route(start, end)?.length).toBe(3);
  expect(roads.route(start, end)?.cost).toBe(3);
  const revision = roads.revision;
  expect(roads.addRoad(end, start)).toBe(true);
  expect(roads.revision).toBe(revision);
  expect(roads.segments()).toHaveLength(6);
  roads.addRoad({ x: 2.5, z: 1 }, { x: 2.5, z: 3 });
  expect(roads.route(start, { x: 2.5, z: 3 })?.length).toBe(3.5);
  expect(roads.route(start, { x: 3, z: 3 })).toBeNull();
});

it("reports route metrics matching route status, length and cost without points", () => {
  const roads = createRoadNetwork(world(), { verifyRouteCache: 1 });
  expect(roads.addRoad(start, end)).toBe(true);
  expect(roads.upgradeRoad(start, { x: 2, z: 1 }, () => true)).toBe(true);
  const metrics = roads.routeMetrics(start, end);
  expect(metrics.status).toBe("found");
  expect(metrics.route).not.toBeNull();
  expect(metrics.route).not.toHaveProperty("points");
  const route = roads.route(start, end)!;
  expect(metrics.route).toStrictEqual({ cost: route.cost, length: route.length });
  // The second lookup is a verified cache hit and returns the same totals without a points copy.
  const hits = roads.routeStats().hits;
  expect(roads.routeMetrics(start, end)).toStrictEqual(metrics);
  expect(roads.routeStats().hits).toBe(hits + 1);
  expect(roads.route(start, end)).toStrictEqual(route);
  const unreachable = { x: 6, z: 6 };
  expect(roads.routeMetrics(start, unreachable)).toStrictEqual({ status: "no-path", route: null });
  expect(roads.route(start, unreachable)).toBeNull();
});

it("upgrades atomically, charges only dirt segments and preserves connectivity", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad(start, end);
  const revision = roads.revision,
    before = roads.segments();
  const refuse = vi.fn(() => false);
  expect(roads.upgradeRoad(start, end, refuse)).toBe(false);
  expect(refuse).toHaveBeenCalledWith(6 * ROAD_STONE_COST, "stone");
  expect(roads.segments()).toEqual(before);
  expect(roads.revision).toBe(revision);
  const pay = vi.fn(() => true);
  expect(roads.upgradeRoad(start, end, pay, "stone")).toBe(true);
  expect(roads.route(start, end)?.cost).toBeCloseTo(3 / ROAD_SPEED.stone);
  expect(roads.route(start, end)?.length).toBe(3);
  expect(roads.revision).toBe(revision + 1);
  expect(roads.upgradeRoad(start, end, pay, "stone")).toBe(true);
  expect(pay).toHaveBeenCalledTimes(1);
  expect(roads.revision).toBe(revision + 1);
});

it("chooses a faster granite detour instead of the shortest dirt distance", () => {
  const roads = createRoadNetwork(detourWorld());
  const { end, left, right, start } = detour;
  roads.addRoad(start, end);
  for (const [from, to] of [
    [start, left],
    [left, right],
    [right, end]
  ])
    expect(roads.addRoad(from!, to!)).toBe(true);
  for (const [from, to] of [
    [start, left],
    [left, right],
    [right, end]
  ])
    for (const tier of ["stone", "marble", "limestone", "basalt", "granite"] as const)
      expect(roads.upgradeRoad(from!, to!, () => true, tier)).toBe(true);
  expect(roads.route(start, end)?.length).toBe(12);
  expect(roads.route(start, end)?.cost).toBeCloseTo(12 / ROAD_SPEED.granite);
});

it.each([BLOCKING.water, BLOCKING.cliff, BLOCKING.prop])(
  "rejects impassable terrain %i without partial construction",
  (kind) => {
    const terrain = world();
    for (let z = 0; z < 8; z++) terrain.blocking[z * 8 + 3] = kind;
    const roads = createRoadNetwork(terrain);
    expect(roads.addRoad(start, { x: 6, z: 1 })).toBe(false);
    expect(roads.segments()).toHaveLength(0);
    expect(roads.revision).toBe(0);
  }
);

it("finds a clear-width detour around building obstacles", () => {
  const start = { x: 1, z: 1 }, end = { x: 6, z: 1 };
  const roads = createRoadNetwork(world(), { isBlocked: (x, z) => x >= 3 && x <= 4 && z <= 2 });
  expect(roads.addRoad(start, end)).toBe(true);
  const path = roads.route(start, end)!;
  expect(path.length).toBeGreaterThan(5);
  expect(path.points.some((point) => point.z >= 2.5)).toBe(true);
});

it("refuses cliffs, invalid coordinates and disconnected upgrades without spending stones", () => {
  const roads = createRoadNetwork(world(), { getHeight: (x) => (x < 3 ? 0 : 4) });
  const pay = vi.fn(() => true);
  expect(roads.addRoad(start, end)).toBe(false);
  expect(roads.addRoad({ x: NaN, z: 1 }, end)).toBe(false);
  expect(roads.addRoad({ x: -1, z: 1 }, end)).toBe(false);
  expect(roads.upgradeRoad(start, end, pay)).toBe(false);
  expect(pay).not.toHaveBeenCalled();
  expect(roads.segments()).toHaveLength(0);
});

it("stops routing through new obstacles without discarding existing road records", () => {
  const terrain = world(),
    roads = createRoadNetwork(terrain);
  roads.addRoad(start, end);
  const before = roads.segments(),
    pay = vi.fn(() => true);
  terrain.blocking[1 * 8 + 2] = BLOCKING.water;
  expect(roads.route(start, end)).toBeNull();
  expect(roads.upgradeRoad(start, end, pay)).toBe(false);
  expect(pay).not.toHaveBeenCalled();
  expect(roads.segments()).toEqual(before);
});

it("returns the actual segment speed at mixed-tier junctions and protects graph records", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad(start, { x: 2, z: 1 });
  roads.upgradeRoad({ x: 1.5, z: 1 }, { x: 2, z: 1 }, () => true);
  expect(roads.speedAt({ x: 1.25, z: 1 })).toBe(ROAD_SPEED.dirt);
  expect(roads.speedAt({ x: 1.75, z: 1 })).toBe(ROAD_SPEED.stone);
  const segments = roads.segments();
  segments[0]!.start.x = 99;
  expect(roads.segments()[0]!.start.x).toBe(1);
});

it("prefers one rounded bend over a sawtooth route across open ground", () => {
  const roads = createRoadNetwork(world());
  const from = { x: 1, z: 1 }, to = { x: 6, z: 5 };
  expect(roads.addRoad(from, to)).toBe(true);
  const path = roads.route(from, to)!.points;
  const headings = path.slice(1).map((point, index) =>
    `${point.x - path[index]!.x}:${point.z - path[index]!.z}`);
  const turns = headings.slice(1).filter((heading, index) => heading !== headings[index]).length;
  expect(turns).toBe(1);
  expect(roads.route(from, to)!.length).toBe(9);
});


it("removes one public section and disconnects routes without deleting unrelated roads", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad(start, end);
  roads.addRoad({ x: 2, z: 3 }, { x: 4, z: 3 });
  const revision = roads.revision;
  expect(roads.removeRoad({ x: 2, z: 1 }, { x: 2.5, z: 1 })).toBe(true);
  expect(roads.revision).toBe(revision + 1);
  expect(roads.segments()).toHaveLength(9);
  expect(roads.route(start, end)).toBeNull();
  expect(roads.route(start, { x: 2, z: 1 })?.length).toBe(1);
  expect(roads.route({ x: 2, z: 3 }, { x: 4, z: 3 })?.length).toBe(2);
  expect(roads.removeRoad(start, end)).toBe(false);
  expect(roads.removeRoad({ x: NaN, z: 1 }, end)).toBe(false);
  expect(roads.removeRoad({ x: 2, z: 1 }, { x: 2.5, z: 1 })).toBe(false);
  expect(roads.revision).toBe(revision + 1);
});

it("removes upgraded stone roads and charges only rebuilt dirt sections", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad(start, end);
  roads.upgradeRoad(start, end, () => true);
  const from = { x: 2, z: 1 }, to = { x: 2.5, z: 1 };
  expect(roads.removeRoad(to, from)).toBe(true);
  expect(roads.speedAt({ x: 2.25, z: 1 })).toBe(ROAD_SPEED.dirt);
  roads.addRoad(from, to);
  const pay = vi.fn(() => true);
  roads.upgradeRoad(start, end, pay);
  expect(pay).toHaveBeenCalledExactlyOnceWith(ROAD_STONE_COST, "stone");
  expect(roads.speedAt({ x: 2.25, z: 1 })).toBe(ROAD_SPEED.stone);
});


it("previews the exact prospective diagonal route without changing graph records", () => {
  const roads = createRoadNetwork(world());
  const from = { x: 1, z: 1 }, to = { x: 6, z: 5 };
  const plan = roads.planRoad(from, to)!;
  expect(plan.points[0]).toEqual(from);
  expect(plan.points.at(-1)).toEqual(to);
  expect(plan.segments.length).toBe(18);
  expect(roads.segments()).toEqual([]);
  expect(roads.revision).toBe(0);
  expect(roads.addRoad(from, to)).toBe(true);
  expect(roads.segments()).toEqual(plan.segments);
  expect(roads.route(from, to)!.points).toEqual(plan.points);
});

it("previews the same building detour and clears invalid previews without mutations", () => {
  const start = { x: 1, z: 1 }, end = { x: 6, z: 1 };
  const roads = createRoadNetwork(world(), { isBlocked: (x, z) => x >= 3 && x <= 4 && z <= 2 });
  const plan = roads.planRoad(start, end)!;
  expect(plan.points.some(point => point.z >= 2.5)).toBe(true);
  expect(roads.planRoad(start, { x: 3.5, z: 1 })).toBeNull();
  expect(roads.segments()).toEqual([]);
  expect(roads.revision).toBe(0);
  roads.addRoad(start, end);
  expect(roads.segments()).toEqual(plan.segments);
});

it("preserves existing stone sections while planning a dirt continuation", () => {
  const roads = createRoadNetwork(world());
  const middle = { x: 2, z: 1 };
  roads.addRoad(start, middle);
  roads.upgradeRoad(start, middle, () => true);
  const before = roads.segments(), revision = roads.revision;
  const plan = roads.planRoad(start, end)!;
  expect(plan.segments.slice(0, 2).every(segment => segment.tier === "stone")).toBe(true);
  expect(roads.segments()).toEqual(before);
  expect(roads.revision).toBe(revision);
  roads.addRoad(start, end);
  expect(roads.segments()).toEqual(plan.segments);
});

 it("upgrades the selected dirt shortcut even when a granite detour is faster", () => {
  const roads = createRoadNetwork(detourWorld());
  const { end, left, right, start } = detour;
  roads.addRoad(start, end);
  for (const [from, to] of [[start,left],[left,right],[right,end]]) {
    roads.addRoad(from!, to!);
    for (const tier of ["stone", "marble", "limestone", "basalt", "granite"] as const)
      expect(roads.upgradeRoad(from!, to!, () => true, tier)).toBe(true);
  }
  expect(roads.route(start,end)!.length).toBe(12);
  const plan = roads.planUpgrade(start,end)!;
  expect(plan.points.every(point => point.z === 1)).toBe(true);
  const pay = vi.fn(() => true);
  expect(roads.upgradeRoad(start,end,pay)).toBe(true);
  expect(pay).toHaveBeenCalledWith(18, "stone");
  expect(roads.segments().filter(segment => segment.start.z === 1 && segment.end.z === 1)
    .every(segment => segment.tier === "stone")).toBe(true);
  expect(roads.segments().filter(segment => segment.start.z !== 1 || segment.end.z !== 1)
    .every(segment => segment.tier === "granite")).toBe(true);
});

it("can upgrade every connected branch and corner with exact stone payment", () => {
  const roads = createRoadNetwork(world());
  roads.addRoad(start,end);
  roads.addRoad({x:2.5,z:1},{x:2.5,z:4});
  roads.addRoad({x:2.5,z:4},{x:5,z:4});
  const before = roads.segments();
  let paid = 0;
  for (const edge of before) expect(roads.upgradeRoad(edge.start, edge.end, cost => {
    paid += cost; return true;
  })).toBe(true);
  expect(paid).toBe(before.length * ROAD_STONE_COST);
  expect(roads.segments().every(segment => segment.tier === "stone")).toBe(true);
});

it("forgets cached routes when a prop changes blocking under the road (build revision)", () => {
  const ground = world();
  const roads = createRoadNetwork(ground, { verifyRouteCache: 0 });
  expect(roads.addRoad(start, end)).toBe(true);
  expect(roads.route(start, end)).not.toBeNull();
  ground.blocking[1 * 8 + 2] = BLOCKING.prop;
  ground.buildRevision = (ground.buildRevision ?? 0) + 1;
  expect(roads.route(start, end)).toBeNull();
});

it("repairs a stale cached route in development play instead of throwing", () => {
  const ground = world();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const roads = createRoadNetwork(ground);
  expect(roads.addRoad(start, end)).toBe(true);
  expect(roads.route(start, end)).not.toBeNull();
  // A blocking change that bumps no revision at all leaves only the periodic verification.
  ground.blocking[1 * 8 + 2] = BLOCKING.prop;
  let routes = 0;
  for (let check = 0; check < 128; check++) if (roads.route(start, end)) routes++;
  expect(routes).toBeLessThan(128);
  expect(roads.route(start, end)).toBeNull();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
