import { describe, expect, it } from "vitest";

import { createRoadNetwork, type RoadPoint, type RoadWorld } from "../src/shared/settlement/road-network";

const SIZE = 20;
const roadWorld = (): RoadWorld => ({
  cellsX: SIZE,
  cellsZ: SIZE,
  heights: new Float32Array((SIZE + 1) ** 2),
  blocking: new Uint8Array(SIZE ** 2)
});

/** Deterministic LCG, so a failure reproduces. */
const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** A dense grid of roads with gaps, stone stretches (faster than dirt) and blocked cells. */
const buildTown = (seed: number) => {
  const next = random(seed), blocked = new Set<number>();
  let revision = 0;
  const isBlocked = (x: number, z: number) => blocked.has(Math.floor(z) * SIZE + Math.floor(x));
  const roads = createRoadNetwork(roadWorld(), { isBlocked, occupancyRevision: () => revision,
    verifyRouteCache: 1 });
  for (let line = 2; line <= 17; line += 3) {
    for (let at = 2; at < 17; at += 3) {
      if (next() < .8) roads.addRoad({ x: at, z: line }, { x: at + 3, z: line });
      if (next() < .8) roads.addRoad({ x: line, z: at }, { x: line, z: at + 3 });
    }
  }
  // The outer ring becomes granite (1.5× dirt): some fastest routes then walk around the town.
  for (let tier = 0; tier < 5; tier++) roads.raiseTiersWhere(segment => segment.start.z <= 2 || segment.start.x <= 2);
  const nodes = [...new Map(roads.segments().flatMap(segment => [segment.start, segment.end])
    .map(point => [`${point.x},${point.z}`, point])).values()].filter((_, index) => index % 3 === 0);
  const block = (count: number) => {
    for (let index = 0; index < count; index++) blocked.add(Math.floor(next() * SIZE * SIZE));
    revision++;
  };
  return { block, nodes, roads };
};

const expectFieldMatchesRoutes = (roads: ReturnType<typeof createRoadNetwork>, nodes: readonly RoadPoint[]) => {
  let routes = 0, detours = 0;
  for (const end of nodes) {
    const field = roads.lengthField(end)!;
    expect(field).not.toBeNull();
    for (const start of nodes) {
      const route = roads.route(start, end);
      expect(Number.isFinite(field(start))).toBe(route !== null);
      if (!route) continue;
      routes++;
      expect(field(start)).toBeLessThanOrEqual(route.length + 1e-9);
      if (field(start) < route.length - 1e-9) detours++;
    }
  }
  return { detours, routes };
};

describe("road length field (A04d)", () => {
  it("is finite exactly where a route exists and never exceeds the route's walked length", () => {
    for (const seed of [1, 2, 3]) {
      const { block, nodes, roads } = buildTown(seed);
      const open = expectFieldMatchesRoutes(roads, nodes);
      block(40);
      const blocked = expectFieldMatchesRoutes(roads, nodes);
      expect(open.routes).toBeGreaterThan(blocked.routes);
      // Stone is faster than dirt, so some fastest routes walk farther than the shortest way.
      expect(open.detours + blocked.detours).toBeGreaterThan(0);
    }
  });

  it("answers off-road starts and targets like route does", () => {
    const { nodes, roads } = buildTown(4);
    const offRoad = { x: .5, z: .5 };
    expect(roads.lengthField(offRoad)!(nodes[0]!)).toBe(Infinity);
    expect(roads.lengthField(nodes[0]!)!(offRoad)).toBe(Infinity);
    expect(roads.lengthField(nodes[0]!)!(nodes[0]!)).toBe(0);
    expect(roads.lengthField({ x: -1, z: 0 })).toBeNull();
  });

  it("offers no field for a live blocker without a revision (such routes are never memoized)", () => {
    const roads = createRoadNetwork(roadWorld(), { isBlocked: () => false });
    roads.addRoad({ x: 2, z: 2 }, { x: 6, z: 2 });
    expect(roads.lengthField({ x: 2, z: 2 })).toBeNull();
  });
});
