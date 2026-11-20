import { DMath } from "../math/deterministic-math";
import { type CellRegion,sampleBilinear } from "../world/grid-geometry";
import { bumpBuildRevision, bumpTerrainRevision } from "../world/save/world-change-journal";
import { HEIGHT_LEVEL_STEP, type WorldData } from "../world/world-data";
import { roadCellHeightConstraints, roadCorridorCells, roadGroundPassable } from "./road-ground-passability";
import { enforceRoadHeights, type RoadHeightConstraint,roadHeightConstraint } from "./road-height-constraints";
import { ROAD_TIER_WIDTH, ROAD_WIDTH, type RoadPoint, type RoadSegment } from "./road-types";
import { refreshFoundationTerrain } from "./settlement-foundation";
import { beginTerrainChange, finishFoundationChange } from "./settlement-foundation-changes";
import { distanceAtSegmentFraction, segmentFraction } from "./settlement-geometry";
import type { SettlementBuilding } from "./settlement-types";

type GradeNode = RoadPoint & { height: number };
const key = (point: RoadPoint) => `${point.x}:${point.z}`;
/** Dirt grading: fully level within 0.8 of the centreline, blended out to 1.4. */
const DIRT_GRADE_REACH = 1.4;
const GRADE_BLEND = .6;
/** Extra half width of a road's tier over dirt: a stone road levels a wider bed. */
const extraHalfWidth = (road: RoadSegment) => (ROAD_TIER_WIDTH[road.tier ?? "dirt"] - ROAD_WIDTH) / 2;
/** Cross-section camber samples sit at 60% of the half width (0.24 on dirt, 0.36 on stone). */
const camberOffset = (road: RoadSegment) => ROAD_TIER_WIDTH[road.tier ?? "dirt"] * .3;

/** A graded road follows the hill longitudinally while its narrow cross-section is level. */
export const levelRoadGround = (
  world: WorldData, segments: readonly RoadSegment[], buildings: readonly SettlementBuilding[],
  refreshTerrain = true
): CellRegion | null => {
  const roads = segments.filter(road => !road.bridge && !road.preview && !road.doorway);
  if (!roads.length) return null;
  const before = world.heights.slice(), nodes = new Map<string, GradeNode>();
  const reference = world.roadGradeBase?.slice() ?? before.slice();
  const applied = world.roadGradeApplied;
  // Several road segments and camber probes revisit the same vertex. Water and
  // foundation footprints remain unchanged throughout this synchronous operation.
  const fixed = new Uint8Array(before.length);
  const fixedVertex = (vertex: number, x: number, z: number) => {
    if (!fixed[vertex]) fixed[vertex] = (world.waterDepth?.[vertex] ?? 0) > 0 || buildings.some(building =>
      Math.abs(x - building.x) <= building.width / 2 &&
      Math.abs(z - building.z) <= building.depth / 2) ? 2 : 1;
    return fixed[vertex] === 2;
  };
  // Foundation/editor changes become new source terrain; our own previous grading never does.
  for (let vertex = 0; vertex < reference.length; vertex++)
    if (!applied || before[vertex] !== applied[vertex]) reference[vertex] = before[vertex]!;
  // Each road's two grade nodes, looked up once (`ends[2i]`, `ends[2i + 1]`) for every pass below.
  const ends: GradeNode[] = [];
  for (const road of roads) for (const point of [road.start, road.end]) {
    const id = key(point);
    let node = nodes.get(id);
    if (!node) nodes.set(id, node = { ...point,
      // Cubic render sampling can overshoot beside a cut: feeding it back into grading amplifies the trench.
      height: Math.max(world.seaLevel + .02, sampleBilinear(world, reference, point.x, point.z)) });
    ends.push(node);
  }
  // Spread a steep local step over neighbouring segments rather than making a stair or cliff.
  for (let pass = 0; pass < 16; pass++) for (let index = 0; index < roads.length; index++) {
    const a = ends[index * 2]!, b = ends[index * 2 + 1]!;
    const limit = DMath.hypot(a.x - b.x, a.z - b.z) * .45;
    const excess = Math.abs(a.height - b.height) - limit;
    if (excess <= 0) continue;
    const correction = excess * .5 * Math.sign(a.height - b.height);
    a.height -= correction; b.height += correction;
  }
  const targets = new Map<number, { height: number; distance: number; x: number; z: number }>();
  for (let index = 0; index < roads.length; index++) {
    const road = roads[index]!, a = ends[index * 2]!, b = ends[index * 2 + 1]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    if (!dx && !dz) continue;
    const extra = extraHalfWidth(road), reach = DIRT_GRADE_REACH + extra;
    for (let z = Math.max(0, Math.floor(Math.min(a.z, b.z) - reach));
      z <= Math.min(world.cellsZ, Math.ceil(Math.max(a.z, b.z) + reach)); z++) {
      for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach));
        x <= Math.min(world.cellsX, Math.ceil(Math.max(a.x, b.x) + reach)); x++) {
        const vertex = z * (world.cellsX + 1) + x;
        if (fixedVertex(vertex, x, z)) continue;
        const t = segmentFraction(x, z, a.x, a.z, dx, dz);
        // Dirt-equivalent distance: the stone bed is level 0.2 farther out and wins where both reach.
        const distance = distanceAtSegmentFraction(x, z, a.x, a.z, dx, dz, t) - extra;
        if (distance >= DIRT_GRADE_REACH || distance >= (targets.get(vertex)?.distance ?? Infinity)) continue;
        targets.set(vertex, { height: a.height + (b.height - a.height) * t, distance, x, z });
      }
    }
  }
  const constraints: RoadHeightConstraint[] = [];
  // A centreline's weights read only the grid size and its ends: the passability pass below reuses them.
  const centrelines = new Map<RoadSegment, RoadHeightConstraint["weights"]>();
  for (const road of roads) {
    const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z;
    const length = DMath.hypot(dx, dz);
    if (!length) continue;
    const centreline = roadHeightConstraint(world, road.start, road.end, length * .55);
    centrelines.set(road, centreline.weights);
    constraints.push(centreline);
    for (const point of [road.start, road.end]) {
      const camber = camberOffset(road);
      const offset = { x: -dz / length * camber, z: dx / length * camber };
      const crossSection = roadHeightConstraint(world,
        { x: point.x + offset.x, z: point.z + offset.z },
        { x: point.x - offset.x, z: point.z - offset.z }, .04);
      // Camber is cosmetic. Its cubic samples can include fixed corners from two different
      // foundations; projecting their incompatible heights repeatedly excavates the free
      // vertices through the sampler's negative weights. Keep that cross-section's natural
      // grade and let the travel/corridor constraints below determine whether it is passable.
      const fixedSupport = crossSection.weights.some(({ vertex }) => {
        const x = vertex % (world.cellsX + 1), z = Math.floor(vertex / (world.cellsX + 1));
        return fixedVertex(vertex, x, z);
      });
      if (!fixedSupport) constraints.push(crossSection);
    }
  }
  // Projection only writes editable target vertices. Refresh can also change the adjacent
  // cells, so prove the complete potential write region before the first height mutation.
  const receiptBounds = { minX: world.cellsX, minZ: world.cellsZ, maxX: 0, maxZ: 0 };
  for (const { x, z } of targets.values()) {
    receiptBounds.minX = Math.min(receiptBounds.minX, Math.max(0, x - 1));
    receiptBounds.minZ = Math.min(receiptBounds.minZ, Math.max(0, z - 1));
    receiptBounds.maxX = Math.max(receiptBounds.maxX, Math.min(world.cellsX, x + 1));
    receiptBounds.maxZ = Math.max(receiptBounds.maxZ, Math.min(world.cellsZ, z + 1));
  }
  const receipt = beginTerrainChange(world, receiptBounds);
  for (const [vertex, target] of targets) {
    const blend = Math.max(0, Math.min(1, (DIRT_GRADE_REACH - target.distance) / GRADE_BLEND));
    world.heights[vertex] = reference[vertex]! + (target.height - reference[vertex]!) * blend * blend * (3 - 2 * blend);
  }
  const editable = new Set(targets.keys());
  enforceRoadHeights(world, constraints, editable);
  // Travel slopes and corridor cells take priority where a fixed foundation limits camber.
  const passability = roads.filter(road => road.start.x !== road.end.x || road.start.z !== road.end.z)
    .map(road => {
      const limit = DMath.hypot(road.start.x - road.end.x, road.start.z - road.end.z) * .55;
      const weights = centrelines.get(road);
      return weights ? { limit, weights } : roadHeightConstraint(world, road.start, road.end, limit);
    });
  passability.push(...roadCellHeightConstraints(world, roadCorridorCells(world, roads)));
  enforceRoadHeights(world, passability, editable);
  const bounds = { minX: world.cellsX, minZ: world.cellsZ, maxX: 0, maxZ: 0 };
  let changed = false;
  for (const [vertex, target] of targets) {
    const height = world.heights[vertex]!;
    if (Math.abs(height - before[vertex]!) < .0001) {
      world.heights[vertex] = before[vertex]!;
      continue;
    }
    world.heights[vertex] = height;
    if (world.heightLevels) world.heightLevels[vertex] = Math.max(0, Math.floor((height + .5) / HEIGHT_LEVEL_STEP));
    bounds.minX = Math.min(bounds.minX, target.x); bounds.maxX = Math.max(bounds.maxX, target.x);
    bounds.minZ = Math.min(bounds.minZ, target.z); bounds.maxZ = Math.max(bounds.maxZ, target.z);
    changed = true;
  }
  world.roadGradeBase = reference;
  world.roadGradeApplied = world.heights.slice();
  if (!changed) return null;
  bumpTerrainRevision(world, bounds);
  bumpBuildRevision(world, null);
  const result = refreshTerrain ? refreshFoundationTerrain(world, bounds) : bounds;
  finishFoundationChange(world, receipt);
  return result;
};

/** Preview the same grading as construction, on private height buffers only. */
export const canLevelRoadGround = (
  world: WorldData, planned: readonly RoadSegment[], existing: readonly RoadSegment[],
  buildings: readonly SettlementBuilding[]
) => {
  const preview = { ...world, heights: world.heights.slice(),
    heightLevels: world.heightLevels?.slice() };
  levelRoadGround(preview, [...existing, ...planned], buildings, false);
  return roadGroundPassable(preview, [...existing, ...planned]
    .filter(road => !road.preview && !road.doorway));
};
