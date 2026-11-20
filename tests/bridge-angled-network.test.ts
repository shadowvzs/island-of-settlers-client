import { describe, expect, it, vi } from "vitest";

import { BRIDGE_FLARE_LENGTH, flareBridgeApproaches } from "../src/shared/settlement/bridge-approaches";
import {
  BRIDGE_ANCHOR_CLEARANCE,
  BRIDGE_STRUCTURE_HALF_WIDTH,
  bridgeDecks,
  deckPoint,
  segmentEntersDeck
} from "../src/shared/settlement/bridge-deck";
import { bridgeLatticeNodes, bridgeLatticeSpan } from "../src/shared/settlement/bridge-lattice";
import { type BridgePlan, planBridge } from "../src/shared/settlement/bridge-planning";
import {
  BRIDGE_MAX_RAMP_SLOPE,
  createBridgeSurfaceHeight,
  createBridgeSurfaceProfiles
} from "../src/shared/settlement/bridge-surface";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { roadStripIndex } from "../src/shared/settlement/road-reserved-strip";
import {
  BRIDGE_DECK_WIDTH,
  ROAD_GRID_STEP,
  type RoadPoint,
  roadRibbonWidth,
  type RoadSegment
} from "../src/shared/settlement/road-types";
import { isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { refreshRoadTravel } from "../src/shared/settlement/settlement-road-rerouting";
import { angledBridgeTestWorld, bridgeRules, paintAngledRiver } from "./helpers/bridge-world";
import { addActor, addRoadWalker, createTrafficWorld, runTraffic } from "./helpers/traffic-scenario";

const RIVER = { angleDegrees: 55, centre: { x: 16, z: 16 }, halfWidth: 1.5 };

const planned = (result: ReturnType<typeof planBridge>): BridgePlan => {
  expect(result.ok, result.ok ? "" : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
};

/** Straight axis road of half-cell edges along x, from `start` for `cells` cells in `direction`. */
const xRoad = (start: RoadPoint, cells: number, direction: -1 | 1): RoadSegment[] =>
  Array.from({ length: cells * 2 }, (_, index) => {
    const from = { x: start.x + direction * index * ROAD_GRID_STEP, z: start.z };
    return { end: { x: from.x + direction * ROAD_GRID_STEP, z: from.z }, start: from, tier: "stone" };
  });

const angledFixture = () => {
  const world = angledBridgeTestWorld(RIVER);
  const plan = planned(planBridge({ id: 9, kind: "stone", pointer: RIVER.centre, rules: bridgeRules(world), world }));
  const [west, east] = [plan.start, plan.end].sort((a, b) => a.x - b.x) as [RoadPoint, RoadPoint];
  const saved = [...xRoad(west, 4, -1), ...plan.segments, ...xRoad(east, 4, 1)];
  const roads = createRoadNetwork(world);
  return { east, plan, roads, saved, west, world };
};

describe("angled bridge road graph", () => {
  it("routes across the angled deck with its real length and keeps the river closed", () => {
    const { east, plan, roads, saved, west, world } = angledFixture();
    const from = { x: west.x - 4, z: west.z }, to = { x: east.x + 4, z: east.z };
    expect(roads.planRoad(from, to)).toBeNull();
    expect(roads.replaceSegments(saved)).toBe(true);
    const route = roads.route(from, to)!;
    expect(route).not.toBeNull();
    const deck = Math.hypot(plan.end.x - plan.start.x, plan.end.z - plan.start.z);
    expect(route.length).toBeCloseTo(8 + deck, 9);
    expect(route.points).toContainEqual(west);
    expect(route.points).toContainEqual(east);
    expect(roads.stoneRoute(from, to)).not.toBeNull();
    expect(roads.searchRoute({ x: west.x - 4, z: west.z + 1 }, to).status).toBe("no-path");
    expect(roads.speedAt(deckPoint(bridgeDecks(plan.segments)[0]!, deck / 2, 0.2))).toBeCloseTo(1.1, 9);
    expect(createRoadNetwork(world).route(from, to)).toBeNull();
  });

  it("round-trips the angled span through the public road save shape", () => {
    const { east, roads, saved, west, world } = angledFixture();
    expect(roads.replaceSegments(saved)).toBe(true);
    const exported = JSON.parse(JSON.stringify(roads.segments())) as RoadSegment[];
    const restored = createRoadNetwork(world);
    expect(restored.replaceSegments(exported)).toBe(true);
    expect(restored.segments()).toEqual(exported);
    expect(restored.route({ x: west.x - 4, z: west.z }, { x: east.x + 4, z: east.z })?.length)
      .toBeCloseTo(roads.route({ x: west.x - 4, z: west.z }, { x: east.x + 4, z: east.z })!.length, 12);
  });

  it("rejects malformed angled spans atomically", () => {
    const { plan, roads, saved, world } = angledFixture();
    expect(roads.replaceSegments(saved)).toBe(true);
    const before = roads.segments();
    const bridgeIndex = (tiles: RoadSegment[]) => tiles.findIndex(segment => segment.bridge);
    const cases: ((tiles: RoadSegment[]) => void)[] = [
      tiles => { tiles.find(segment => segment.bridge)!.bridge!.tiles += 1; },
      tiles => { tiles.splice(bridgeIndex(tiles), 1); },
      tiles => {
        // Two lattice steps merged into one edge would hide a grid node inside it.
        const first = tiles[bridgeIndex(tiles)]!, second = tiles[bridgeIndex(tiles) + 1]!;
        first.end = second.end;
        tiles.splice(bridgeIndex(tiles) + 1, 1);
      },
      tiles => {
        // An ordinary road may never take a diagonal step.
        const first = tiles[bridgeIndex(tiles)]!;
        delete first.bridge;
      }
    ];
    expect(plan.segments.length).toBeGreaterThan(1);
    for (const mutate of cases) {
      const malformed = structuredClone(before);
      mutate(malformed);
      const candidate = createRoadNetwork(world);
      expect(candidate.replaceSegments(malformed)).toBe(false);
      expect(candidate.segments()).toEqual([]);
    }
    expect(roads.segments()).toEqual(before);
  });

  it("removes the whole angled span and refuses material upgrades across it", () => {
    const { east, roads, saved, west } = angledFixture();
    expect(roads.replaceSegments(saved)).toBe(true);
    const pay = vi.fn(() => true);
    expect(roads.upgradeRoad({ x: west.x - 4, z: west.z }, { x: east.x + 4, z: east.z }, pay)).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    const tile = roads.segments().find(segment => segment.bridge)!;
    expect(roads.removeRoad(tile.start, tile.end)).toBe(true);
    expect(roads.segments().filter(segment => segment.bridge)).toEqual([]);
  });

  it("routes new road construction around an angled deck but lets roads join its anchors", () => {
    // A deck laid over dry test ground isolates the reserved-strip rule from the river.
    const world = angledBridgeTestWorld({ ...RIVER, centre: { x: 60, z: 60 } }, { size: 24 });
    const start = { x: 8, z: 12 }, end = { x: 11, z: 10.5 };
    const span = bridgeLatticeSpan(start, end)!;
    const nodes = bridgeLatticeNodes(start, span);
    const deckSegments: RoadSegment[] = nodes.slice(1).map((next, tile) => ({ end: next, start: nodes[tile]!,
      tier: "dirt", bridge: { id: 1, kind: "wood", tile, tiles: span.tiles, width: BRIDGE_DECK_WIDTH } }));
    const roads = createRoadNetwork(world);
    expect(roads.replaceSegments(deckSegments)).toBe(true);
    const deck = bridgeDecks(deckSegments)[0]!;
    const crossing = roads.planRoad({ x: 9.5, z: 7 }, { x: 9.5, z: 15 });
    expect(crossing).not.toBeNull();
    for (const segment of crossing!.segments)
      expect(segmentEntersDeck(deck, segment.start, segment.end, BRIDGE_STRUCTURE_HALF_WIDTH,
        BRIDGE_ANCHOR_CLEARANCE)).toBe(false);
    expect(segmentEntersDeck(deck, { x: 9.5, z: 7 }, { x: 9.5, z: 15 }, BRIDGE_STRUCTURE_HALF_WIDTH,
      BRIDGE_ANCHOR_CLEARANCE)).toBe(true);
    const join = roads.planRoad({ x: 8, z: 15 }, start);
    expect(join).not.toBeNull();
    expect(join!.points.at(-1)).toEqual(start);
  });
});

describe("angled deck navigation and reservations", () => {
  const trafficScene = () => {
    const scene = createTrafficWorld(32);
    const world = scene.world as unknown as Parameters<typeof paintAngledRiver>[0];
    Object.assign(world, { riverDistance: new Float32Array(33 * 33), waterDepth: new Float32Array(33 * 33) });
    paintAngledRiver(world, RIVER);
    const plan = planned(planBridge({ id: 3, kind: "wood", pointer: RIVER.centre,
      rules: bridgeRules(world as never), world: world as never }));
    const [west, east] = [plan.start, plan.end].sort((a, b) => a.x - b.x) as [RoadPoint, RoadPoint];
    return { east, plan, scene, west, segments: [...xRoad(west, 5, -1), ...plan.segments, ...xRoad(east, 5, 1)] };
  };

  it("lets people walk the completed deck and nothing else over the water", () => {
    const { plan, scene, segments } = trafficScene();
    const deck = bridgeDecks(plan.segments)[0]!;
    const middle = deckPoint(deck, deck.length / 2, 0);
    const beside = deckPoint(deck, deck.length / 2, 1.6);
    expect(isNavigationClear(scene.context, middle)).toBe(false);
    expect(scene.roads.replaceSegments(segments)).toBe(true);
    expect(isNavigationClear(scene.context, middle)).toBe(true);
    expect(isNavigationClear(scene.context, deckPoint(deck, deck.length / 2, 1.2))).toBe(true);
    expect(isNavigationClear(scene.context, beside)).toBe(false);
  });

  it("carries a road walker across the angled deck from one shore road to the other", () => {
    const { east, scene, segments, west } = trafficScene();
    expect(scene.roads.replaceSegments(segments)).toBe(true);
    const start = { x: west.x - 5, z: west.z }, goal = { x: east.x + 5, z: east.z };
    const walker = addRoadWalker(scene, { job: "Carrier", to: goal, uid: 1, x: start.x, z: start.z });
    let overWater = false;
    const metrics = runTraffic(scene.context, [walker], 40, { afterTick: () => {
      overWater ||= scene.world.walkCost[Math.floor(walker.z) * 32 + Math.floor(walker.x)] === 0;
    }, scene });
    expect(metrics.completed).toBe(1);
    expect(overWater).toBe(true);
    expect(Math.hypot(walker.x - goal.x, walker.z - goal.z)).toBeLessThan(0.3);
  });

  it("rejoins a carrier caught mid-span by a graph edit at the nearer shore anchor", () => {
    const { east, plan, scene, segments } = trafficScene();
    expect(scene.roads.replaceSegments(segments)).toBe(true);
    const deck = bridgeDecks(plan.segments)[0]!;
    const caught = deckPoint(deck, deck.length / 4, 0);
    const goal = { x: east.x + 5, z: east.z };
    const actor = addActor(scene, { job: "Carrier", path: [goal], phase: "deliver", uid: 2, x: caught.x, z: caught.z });
    expect(refreshRoadTravel(scene.context, actor)).toBe(true);
    const spur: RoadSegment = { end: { x: 3, z: 3.5 }, start: { x: 3, z: 3 }, tier: "dirt" };
    expect(scene.roads.replaceSegments([...segments, spur])).toBe(true);
    expect(refreshRoadTravel(scene.context, actor)).toBe(true);
    expect(actor.path[0]).toEqual(deck.start);
    expect(actor.path.at(-1)).toEqual(goal);
  });

  it("reserves the rotated deck, its abutments and the flared shore roads against plots", () => {
    const { plan, scene, segments, west } = trafficScene();
    expect(scene.roads.replaceSegments(segments)).toBe(true);
    const strip = roadStripIndex(scene.roads);
    const deck = bridgeDecks(plan.segments)[0]!;
    const box = (centre: RoadPoint, half = 0.2) =>
      ({ bottom: centre.z + half, left: centre.x - half, right: centre.x + half, top: centre.z - half });
    expect(strip.findInRect(box(deckPoint(deck, -0.3, 1.2)))).not.toBeNull();
    expect(strip.findInRect(box(deckPoint(deck, deck.length / 2, 1.45)))).not.toBeNull();
    expect(strip.findInRect(box(deckPoint(deck, deck.length / 2, 2.4)))).toBeNull();
    // Beside the flared west shore road (1.25 from its centreline) versus the same offset farther out.
    expect(strip.findInRect(box({ x: west.x - 0.5, z: west.z + 1.25 }, 0.05))).not.toBeNull();
    expect(strip.findInRect(box({ x: west.x - 3, z: west.z + 1.25 }, 0.05))).toBeNull();
  });
});

describe("angled bridge presentation surface", () => {
  it("flares both shore roads to the deck width and never narrows them", () => {
    const { plan, saved, west } = angledFixture();
    const frames = flareBridgeApproaches(saved);
    const touching = frames.find(segment => !segment.bridge &&
      (segment.start.x === west.x && segment.start.z === west.z))!;
    expect(roadRibbonWidth(touching, 0)).toBeCloseTo(BRIDGE_DECK_WIDTH, 9);
    const outward = frames.find(segment => !segment.bridge &&
      segment.start.x === west.x - BRIDGE_FLARE_LENGTH + ROAD_GRID_STEP && segment.start.z === west.z)!;
    expect(roadRibbonWidth(outward, 1)).toBeCloseTo(1.3, 9);
    for (const segment of frames) {
      expect(roadRibbonWidth(segment, 0)).toBeGreaterThanOrEqual(1.3 - 1e-9);
      expect(roadRibbonWidth(segment, 1)).toBeGreaterThanOrEqual(1.3 - 1e-9);
    }
    expect(frames.filter(segment => segment.bridge)).toEqual(plan.segments);
  });

  it("lifts the angled deck above the water and ramps down along the real shore road", () => {
    const { plan, saved, west } = angledFixture();
    const terrain = () => 0.1, water = () => 0.2;
    const profile = createBridgeSurfaceProfiles(saved, terrain, water)[0]!;
    const height = createBridgeSurfaceHeight(saved, terrain, water);
    const deck = bridgeDecks(plan.segments)[0]!;
    const middle = deckPoint(deck, deck.length / 2, 0.9);
    expect(height(middle.x, middle.z)).toBeGreaterThanOrEqual(0.2 + 0.45);
    expect(profile.unit.x).toBeCloseTo(deck.unitX, 12);
    // Leaving the west anchor along the axis-aligned shore road: continuous, descending, no step.
    let previous = height(west.x, west.z)!;
    expect(previous).toBeCloseTo(profile.baseHeight, 9);
    const rampLength = (profile.baseHeight - 0.1) / BRIDGE_MAX_RAMP_SLOPE;
    for (let distance = 0.05; distance < rampLength - 0.05; distance += 0.05) {
      const sample = height(west.x - distance, west.z);
      expect(sample).toBeDefined();
      expect(sample!).toBeLessThanOrEqual(previous + 1e-9);
      expect(previous - sample!).toBeLessThanOrEqual(0.05 * BRIDGE_MAX_RAMP_SLOPE + 1e-6);
      previous = sample!;
    }
    expect(height(west.x - rampLength - 0.2, west.z)).toBeUndefined();
  });
});
