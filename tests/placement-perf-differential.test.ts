import { beforeAll, describe, expect, it } from "vitest";

import {
  type BuildingCollisionBox, buildingEntrancesObstructModels, getPlacedBuildingEntranceBounds,
  getPlacedBuildingModelBoxes, type PlacedBuildingModel
} from "../src/render-common/buildings/building-model-clearance";
import { findRoadConstructionPath } from "../src/shared/settlement/road-construction-path";
import { canLevelRoadGround } from "../src/shared/settlement/road-ground-leveling";
import { enforceRoadHeights, roadHeightConstraint } from "../src/shared/settlement/road-height-constraints";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { findRoadPath } from "../src/shared/settlement/road-pathfinding";
import { someRoadInBox } from "../src/shared/settlement/road-proximity-index";
import { createRoadTraversal } from "../src/shared/settlement/road-traversal";
import {
  ROAD_GRID_STEP, ROAD_RESERVED_HALF_WIDTH, ROAD_STONE_WIDTH, type RoadPoint, type RoadSegment
} from "../src/shared/settlement/road-types";
import { entranceClearancePlacementReason } from "../src/shared/settlement/settlement-building-entrance-clearance";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSignpostStakes } from "../src/shared/settlement/settlement-road-strip-placement";
import { getPlacedTreeClearanceBox, someTreeNearPlot } from "../src/shared/settlement/settlement-rotor-clearance";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import type { WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/**
 * Lane placement-perf: the faster placement and road planning functions against verbatim copies of the code they
 * replaced, on a generated island with a grown town (trees, roads, signposts) and seeded random cases.
 */
const SIDE = 96;
const TYPES = [17, 19, 20, 33, 31, 2] as const;
const STEPS: ReadonlyArray<readonly [number, number]> = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]];

/** Deterministic pseudo-random numbers (mulberry32). */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const overlap = (first: BuildingCollisionBox, second: BuildingCollisionBox) =>
  first.min.every((value, axis) => value < second.max[axis]! && first.max[axis]! > second.min[axis]!);
const hitsBox = (building: PlacedBuildingModel, box: BuildingCollisionBox) =>
  getPlacedBuildingEntranceBounds(building).some(entrance => overlap(entrance, box));

/** The entrance-versus-model check as it was: every model box of both buildings, no broad phase. */
const referenceObstruct = (first: PlacedBuildingModel, second: PlacedBuildingModel) => {
  const firstEntrance = getPlacedBuildingEntranceBounds(first);
  const secondEntrance = getPlacedBuildingEntranceBounds(second);
  if (firstEntrance.length && getPlacedBuildingModelBoxes(second).some(box =>
    firstEntrance.some(entrance => overlap(entrance, box)))) return true;
  return secondEntrance.length > 0 && getPlacedBuildingModelBoxes(first).some(box =>
    secondEntrance.some(entrance => overlap(entrance, box)));
};

/** The door clearance check as it was: every road of the network sampled every 0.1. */
const referenceEntranceReason = (context: SettlementContext, building: SettlementBuilding) => {
  for (const existing of context.buildings)
    if (referenceObstruct(building, existing)) return "Door swing would overlap another building";
  if (!getPlacedBuildingEntranceBounds(building).length) return null;
  const { world } = context.options;
  if (someTreeNearPlot(world, building, (index) => hitsBox(building, getPlacedTreeClearanceBox(world, index))))
    return "Door swing would overlap a tree outside its plot";
  for (const road of context.options.roads.segments?.() ?? []) {
    const samples = Math.max(1, Math.ceil(Math.hypot(road.end.x - road.start.x, road.end.z - road.start.z) / .1));
    for (let step = 0; step <= samples; step++) {
      const x = road.start.x + (road.end.x - road.start.x) * step / samples;
      const z = road.start.z + (road.end.z - road.start.z) * step / samples;
      const height = sampleSmooth(world, world.heights, x, z), radius = ROAD_RESERVED_HALF_WIDTH;
      const box: BuildingCollisionBox = { max: [x + radius, height + .06, z + radius],
        min: [x - radius, height - .02, z - radius] };
      if (hitsBox(building, box))
        return "Door swing would overlap an existing road";
    }
  }
  return null;
};

/** The construction A* as it was: no step memo, no enclosure proof. */
const referencePath = (first: number, last: number, traversal: ReturnType<typeof createRoadTraversal>) => {
  const { node, point, walkable } = traversal;
  const destination = point(last);
  const result = findRoadPath(first * 5 + 4, last * 5 + 4, (state, visit) => {
    const current = Math.floor(state / 5), direction = state % 5;
    if (current === last) {
      visit(last * 5 + 4, 0);
      return;
    }
    const position = point(current);
    STEPS.forEach(([dx, dz], nextDirection) => {
      const next = { x: position.x + dx, z: position.z + dz };
      if (!walkable(position, next)) return;
      const turn = direction === 4 || direction === nextDirection ? 0 : 0.04;
      visit(node(next) * 5 + nextDirection, ROAD_GRID_STEP + turn);
    });
  }, (state) => {
    const current = point(Math.floor(state / 5));
    return Math.abs(current.x - destination.x) + Math.abs(current.z - destination.z);
  });
  if (result.status !== "found") return null;
  const path = result.path.map((state) => Math.floor(state / 5))
    .filter((current, index, nodes) => index === 0 || current !== nodes[index - 1]);
  return { cost: result.cost, path };
};

/** The Map-based height weights as they were. */
const referenceWeights = (world: WorldData, point: RoadPoint) => {
  const cubic = (t: number) => [-.5 * t + t * t - .5 * t * t * t, 1 - 2.5 * t * t + 1.5 * t * t * t,
    .5 * t + 2 * t * t - 1.5 * t * t * t, -.5 * t * t + .5 * t * t * t];
  const x = Math.max(0, Math.min(world.cellsX, point.x)), z = Math.max(0, Math.min(world.cellsZ, point.z));
  const cellX = Math.min(Math.floor(x), world.cellsX - 1), cellZ = Math.min(Math.floor(z), world.cellsZ - 1);
  const xs = cubic(x - cellX), zs = cubic(z - cellZ), weights = new Map<number, number>();
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const vx = Math.max(0, Math.min(world.cellsX, cellX + column - 1));
    const vz = Math.max(0, Math.min(world.cellsZ, cellZ + row - 1));
    const vertex = vz * (world.cellsX + 1) + vx;
    weights.set(vertex, (weights.get(vertex) ?? 0) + xs[column]! * zs[row]!);
  }
  return weights;
};
const referenceConstraint = (world: WorldData, a: RoadPoint, b: RoadPoint, limit: number) => {
  const weights = referenceWeights(world, a);
  for (const [vertex, weight] of referenceWeights(world, b)) weights.set(vertex, (weights.get(vertex) ?? 0) - weight);
  return { limit, weights: [...weights].filter(([, value]) => Math.abs(value) > 1e-9)
    .map(([vertex, value]) => ({ vertex, value })) };
};
const referenceEnforce = (world: WorldData, constraints: ReturnType<typeof referenceConstraint>[],
  editable: ReadonlySet<number>) => {
  for (let pass = 0; pass < 64; pass++) {
    let maximum = 0;
    for (const { limit, weights } of constraints) {
      let difference = 0, lengthSquared = 0;
      for (const { value, vertex } of weights) {
        difference += world.heights[vertex]! * value;
        if (editable.has(vertex)) lengthSquared += value * value;
      }
      const excess = Math.abs(difference) - limit;
      if (excess <= .0001 || lengthSquared < 1e-10) continue;
      maximum = Math.max(maximum, excess);
      const correction = excess * Math.sign(difference) / lengthSquared;
      for (const { value, vertex } of weights) if (editable.has(vertex))
        world.heights[vertex] = Math.max(world.seaLevel + .02, world.heights[vertex]! - correction * value);
    }
    if (maximum < .0005) break;
  }
};

/** A grown town: the headquarters and up to 24 buildings near it, each joined to the nearest flag or road node. */
const growTown = () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: SIDE, cellsZ: SIDE, erosionDroplets: 2000,
    landform: "island", mountains: 0, seed: 1234 });
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const buildings = () => simulation?.buildings() ?? [];
  const isOccupied = (x: number, z: number) => simulation?.isOccupied(x, z) ?? false;
  const signposts = createSignpostStakes(world, buildings);
  const roads = createRoadNetwork(world, { isBlocked: isOccupied, isStripReserved: signposts.isStripReserved,
    validateGradedRoads: (planned, existing) => canLevelRoadGround(world, planned, existing, buildings()) });
  simulation = createSettlementSimulation({ homeBuilding: 0, initialStock: { logs: 999, planks: 999, stone: 999 },
    roads, unlockAllBuildings: true, world });
  const home = simulation.headquarters, plots: RoadPoint[] = [];
  for (let dz = -22; dz <= 22; dz++) for (let dx = -22; dx <= 22; dx++) plots.push({ x: dx, z: dz });
  plots.sort((a, b) => a.x * a.x + a.z * a.z - b.x * b.x - b.z * b.z || a.z - b.z || a.x - b.x);
  let placed = 0, tries = 0;
  for (const plot of plots) {
    if (placed === 24) break;
    const typeId = TYPES[tries++ % TYPES.length]!, rotation = tries % 4;
    const result = simulation.placeBuilding(typeId, Math.floor(home.x) + plot.x + 1, Math.floor(home.z) + plot.z + 1,
      rotation);
    if (!result.ok || !result.building) continue;
    placed++;
    const flag = result.building.access;
    const targets = [...simulation.buildings().map(building => building.access),
      ...simulation.roadSegments().flatMap(segment => [segment.start, segment.end])]
      .filter(point => point.x !== flag.x || point.z !== flag.z)
      .sort((a, b) => Math.hypot(a.x - flag.x, a.z - flag.z) - Math.hypot(b.x - flag.x, b.z - flag.z));
    targets.slice(0, 3).some(target => simulation!.connectRoads(flag, target));
  }
  const context = { buildings: simulation.buildings(), nextBuilding: 1_000_000, options: { roads, world },
    playerNation: "roman" } as unknown as SettlementContext;
  return { context, home, isOccupied, roads, signposts, simulation, world };
};

describe("placement-perf differential (faster functions equal the code they replaced)", () => {
  let town: ReturnType<typeof growTown>;
  beforeAll(() => {
    town = growTown();
  }, 120_000);

  it("door clearance: the same verdict on 1500 random drafts round the town", () => {
    const { context, home } = town, random = seededRandom(11), verdicts = new Map<string, number>();
    expect(context.buildings.length).toBeGreaterThan(10);
    expect(town.roads.segments().length).toBeGreaterThan(40);
    for (let draft = 0; draft < 1500; draft++) {
      const typeId = TYPES[draft % TYPES.length]!;
      const x = Math.floor(home.x + (random() - .5) * 44) + (random() < .5 ? .5 : 1);
      const z = Math.floor(home.z + (random() - .5) * 44) + (random() < .5 ? .5 : 1);
      const building = makeBuilding(context, typeId, x, z, Math.floor(random() * 4));
      const reason = entranceClearancePlacementReason(context, building);
      expect(reason).toBe(referenceEntranceReason(context, building));
      for (const existing of context.buildings)
        expect(buildingEntrancesObstructModels(building, existing)).toBe(referenceObstruct(building, existing));
      verdicts.set(String(reason), (verdicts.get(String(reason)) ?? 0) + 1);
    }
    // Not vacuous: every refusal kind occurs, and most drafts pass.
    expect([...verdicts.keys()].sort()).toEqual(["Door swing would overlap a tree outside its plot",
      "Door swing would overlap an existing road", "Door swing would overlap another building", "null"]);
  });

  it("roads in a box: every road whose bounds meet the box is tested", () => {
    const { roads } = town, random = seededRandom(13), segments = roads.segments();
    type Box = { maxX: number; maxZ: number; minX: number; minZ: number };
    const meets = (box: Box) => (segment: Pick<RoadSegment, "end" | "start">) =>
      Math.min(segment.start.x, segment.end.x) <= box.maxX && Math.max(segment.start.x, segment.end.x) >= box.minX &&
      Math.min(segment.start.z, segment.end.z) <= box.maxZ && Math.max(segment.start.z, segment.end.z) >= box.minZ;
    let hits = 0;
    for (let query = 0; query < 2000; query++) {
      const minX = random() * SIDE, minZ = random() * SIDE, size = random() * 3;
      const box = { maxX: minX + size, maxZ: minZ + size, minX, minZ };
      const expected = segments.some(meets(box));
      expect(someRoadInBox(roads, box, meets(box))).toBe(expected);
      if (expected) hits++;
    }
    expect(hits).toBeGreaterThan(20);
  });

  it("construction A*: the same plan (or none) between 400 random node pairs", () => {
    const { isOccupied, world } = town, random = seededRandom(17);
    const traversal = createRoadTraversal(world, { isBlocked: isOccupied }, ROAD_STONE_WIDTH);
    let found = 0, none = 0;
    for (let pair = 0; pair < 400; pair++) {
      const point = () => ({ x: Math.round(random() * SIDE * 2) / 2, z: Math.round(random() * SIDE * 2) / 2 });
      const near = pair % 3 !== 0, start = point();
      const end = near ? { x: Math.min(SIDE, start.x + Math.round(random() * 20) / 2), z: start.z } : point();
      const first = traversal.node(start), last = traversal.node(end);
      if (first === last) continue;
      const plan = findRoadConstructionPath(first, last, traversal);
      expect(plan).toEqual(referencePath(first, last, traversal));
      if (plan) found++;
      else none++;
    }
    expect(found).toBeGreaterThan(40);
    expect(none).toBeGreaterThan(40);
  });

  it("road steps: the same walkability as the sampled corridor test it replaced", () => {
    const { isOccupied, world } = town, random = seededRandom(29);
    const traversal = createRoadTraversal(world, { isBlocked: isOccupied }, ROAD_STONE_WIDTH);
    const height = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
    const reference = (start: RoadPoint, end: RoadPoint) => {
      const dx = end.x - start.x, dz = end.z - start.z, length = Math.sqrt(dx * dx + dz * dz);
      if (length === 0 || Math.abs(height(start.x, start.z) - height(end.x, end.z)) > length * 0.7) return false;
      for (const fraction of [0, 0.5, 1]) for (const side of [-1, 0, 1]) {
        const x = start.x + dx * fraction - (((dz / length) * ROAD_STONE_WIDTH) / 2) * side;
        const z = start.z + dz * fraction + (((dx / length) * ROAD_STONE_WIDTH) / 2) * side;
        if (traversal.blocked(x, z)) return false;
      }
      return true;
    };
    let open = 0;
    for (let index = 0; index < 20000; index++) {
      const start = { x: Math.round(random() * SIDE * 2) / 2, z: Math.round(random() * SIDE * 2) / 2 };
      const [dx, dz] = STEPS[index % 4]!, end = { x: start.x + dx, z: start.z + dz };
      const expected = reference(start, end);
      expect(traversal.walkable(start, end)).toBe(expected);
      if (expected) open++;
    }
    expect(open).toBeGreaterThan(1000);
  });

  it("road grading: the same height constraints and projection, bit for bit", () => {
    const { world } = town, random = seededRandom(19);
    for (let index = 0; index < 3000; index++) {
      const a = { x: random() * (SIDE + 2) - 1, z: random() * (SIDE + 2) - 1 };
      const b = index % 3 ? { x: a.x + random() - .5, z: a.z + random() - .5 } : { x: a.x, z: a.z };
      expect(roadHeightConstraint(world, a, b, .3)).toEqual(referenceConstraint(world, a, b, .3));
    }
    const constraints = Array.from({ length: 400 }, () => {
      const a = { x: 20 + random() * 30, z: 20 + random() * 30 };
      return referenceConstraint(world, a, { x: a.x + (random() < .5 ? .5 : 0), z: a.z + .5 }, random() * .2);
    });
    const editable = new Set(constraints.flatMap(({ weights }) => weights.map(({ vertex }) => vertex))
      .filter(vertex => vertex % 3 !== 0));
    const lane = { ...world, heights: world.heights.slice() }, reference = { ...world, heights: world.heights.slice() };
    enforceRoadHeights(lane, constraints, editable);
    referenceEnforce(reference, constraints, editable);
    expect(lane.heights).toEqual(reference.heights);
    expect(lane.heights).not.toEqual(world.heights);
  });

  it("signpost strips: the early-exit test equals the full clearance", () => {
    const { home, signposts } = town, random = seededRandom(23);
    let reserved = 0;
    for (let index = 0; index < 4000; index++) {
      const start = { x: Math.round((home.x + (random() - .5) * 40) * 2) / 2,
        z: Math.round((home.z + (random() - .5) * 40) * 2) / 2 };
      const [dx, dz] = STEPS[index % 4]!, end = { x: start.x + dx, z: start.z + dz };
      const expected = signposts.clearance(start, end) < ROAD_RESERVED_HALF_WIDTH - 1e-6;
      expect(signposts.isStripReserved(start, end)).toBe(expected);
      if (expected) reserved++;
    }
    expect(reserved).toBeGreaterThan(10);
  });
});
