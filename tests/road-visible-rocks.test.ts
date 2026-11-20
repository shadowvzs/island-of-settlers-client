import { describe, expect, it } from "vitest";

import { rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { roadIntersectsVisibleRock } from "../src/shared/settlement/road-rock-footprints";
import { ROAD_STONE_WIDTH } from "../src/shared/settlement/road-types";
import { PROP, type WorldData } from "../src/shared/world/world-data";
const worldFixture = () => ({ cellsX: 24, cellsZ: 24, heights: new Float32Array(25 ** 2),
  blocking: new Uint8Array(24 ** 2) }) as unknown as WorldData;
const rock = (extra: Partial<RockInstance> = {}): RockInstance => ({ axes: [[3, 0, 0], [0, 1, 0], [0, 0, 2]],
  centre: [12, .3, 12], role: ROCK_ROLE.outcrop, exposure: 0, family: 0, high: true,
  moss: 0, slab: 0, tint: 0, variant: 0, ...extra });
const crosses = (world: WorldData, z = 12) => roadIntersectsVisibleRock(world, { x: 10, z }, { x: 10.5, z }, ROAD_STONE_WIDTH);
describe("visible rocks block new public-road strips", () => {
  it("routes preview around a procedural boulder even when all its cells are free, and commits that same plan", () => {
    const world = worldFixture(); rememberIslandRocks(world, [rock()]);
    const roads = createRoadNetwork(world);
    const start = { x: 6, z: 12 }, end = { x: 18, z: 12 };
    const preview = roads.planRoad(start, end)!;
    expect(preview).not.toBeNull(); expect(preview.points.some(point => point.z !== 12)).toBe(true);
    expect(preview.segments.every(segment => !roadIntersectsVisibleRock(world, segment.start, segment.end, ROAD_STONE_WIDTH))).toBe(true);
    expect(roads.addRoad(start, end)).toBe(true);
    expect(roads.segments()).toEqual(preview.segments);
    expect(roads.route(start, end)).not.toBeNull();
  });
  it.each([ROCK_ROLE.slab, ROCK_ROLE.plate, ROCK_ROLE.lip, ROCK_ROLE.rubble, ROCK_ROLE.outcrop])(
    "blocks substantial role %s including its projected tilted-axis extent", role => {
      const world = worldFixture(); rememberIslandRocks(world, [rock({ role, axes: [[2, 0, 1], [1, 1, 0], [0, 0, 2]] })]);
      expect(crosses(world)).toBe(true); expect(crosses(world, 16)).toBe(false);
    });
  it.each([ROCK_ROLE.pebble, ROCK_ROLE.mass])("ignores render-only role %s even if its bounding box is large", role => {
    const world = worldFixture(); rememberIslandRocks(world, [rock({ role })]); expect(crosses(world)).toBe(false);
  });
  it("ignores tiny decorative fragments and works with minimal worlds without props", () => {
    const world = worldFixture(); expect(crosses(world)).toBe(false);
    rememberIslandRocks(world, [rock({ axes: [[.3, 0, 0], [0, .15, 0], [0, 0, .2]] })]);
    expect(crosses(world)).toBe(false);
  });
  it("includes scaled large-rock companion stones beyond the blocked center cell", () => {
    const world = worldFixture();
    world.props = { count: 1, types: new Uint8Array([PROP.largeRock]), x: new Float32Array([12]),
      z: new Float32Array([12]), scale: new Float32Array([2]) } as WorldData["props"];
    // Center cell is 12:12; a road by x9.5 still clips this prop's visible cluster at scale2.
    expect(roadIntersectsVisibleRock(world, { x: 9.5, z: 11 }, { x: 9.5, z: 11.5 }, ROAD_STONE_WIDTH)).toBe(true);
    world.props.scale[0] = .5; world.buildRevision = 1;
    expect(roadIntersectsVisibleRock(world, { x: 9.5, z: 11 }, { x: 9.5, z: 11.5 }, ROAD_STONE_WIDTH)).toBe(false);
  });
  it("refreshes when rocks are first remembered, replaced, extended or terrain changes", () => {
    const world = worldFixture(); expect(crosses(world)).toBe(false);
    const rocks = [rock()]; rememberIslandRocks(world, rocks); expect(crosses(world)).toBe(true);
    rememberIslandRocks(world, []); expect(crosses(world)).toBe(false);
    rememberIslandRocks(world, rocks); expect(crosses(world)).toBe(true);
    rocks[0]!.centre = [20, .3, 12]; world.terrainRevision = 1; expect(crosses(world)).toBe(false);
    rocks.push(rock()); expect(crosses(world)).toBe(true);
  });
  it("reuses the spatial footprint cache across repeated preview probes", () => {
    const world = worldFixture(), source = rock(); let reads = 0;
    const axes = source.axes;
    Object.defineProperty(source, "axes", { get: () => { reads++; return axes; } });
    rememberIslandRocks(world, [source]); crosses(world); const first = reads;
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) crosses(world, 16);
    expect(reads).toBe(first);
    world.buildRevision = 1; crosses(world); expect(reads).toBeGreaterThan(first);
  });
  it("rejects a rock-covered endpoint atomically for both preview and commit", () => {
    const world = worldFixture(); rememberIslandRocks(world, [rock()]);
    const roads = createRoadNetwork(world), start = { x: 6, z: 12 }, end = { x: 12, z: 12 };
    expect(roads.planRoad(start, end)).toBeNull(); expect(roads.addRoad(start, end)).toBe(false);
    expect(roads.segments()).toEqual([]);
  });
  it("checks the full future stone width instead of only the narrow dirt centerline", () => {
    const world = worldFixture(); rememberIslandRocks(world, [rock({ centre: [10.25, .2, 12.8],
      axes: [[.8, 0, 0], [0, .4, 0], [0, 0, .6]] })]);
    const start = { x: 10, z: 12 }, end = { x: 10.5, z: 12 };
    expect(roadIntersectsVisibleRock(world, start, end, .8)).toBe(false);
    expect(roadIntersectsVisibleRock(world, start, end, ROAD_STONE_WIDTH)).toBe(true);
  });
  it("preserves restored existing road travel and upgrading across a rock", () => {
    const world = worldFixture(); rememberIslandRocks(world, [rock()]);
    const roads = createRoadNetwork(world), start = { x: 6, z: 12 }, end = { x: 18, z: 12 };
    const segments = Array.from({ length: 24 }, (_, i) => ({ start: { x: 6 + i / 2, z: 12 },
      end: { x: 6 + (i + 1) / 2, z: 12 }, tier: "dirt" as const }));
    expect(roads.replaceSegments(segments)).toBe(true);
    expect(roads.route(start, end)?.length).toBe(12);
    expect(roads.upgradeRoad(start, end, () => true)).toBe(true);
    expect(roads.route(start, end)?.length).toBe(12);
    expect(roads.addRoad(start, end)).toBe(true);
    expect(roads.segments()).toHaveLength(24);
  });
});
