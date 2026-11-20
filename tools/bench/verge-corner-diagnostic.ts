/**
 * VERGE-DENSITY-FIX diagnostic (2026-11-08): measures roadside-stone spacing at every real road
 * corner of an owner save, inner and outer side separately, against the straight-road reference.
 *
 *   SAVE=<owner save.json> npx tsx --env-file=<captures>/verge-density/diagnostic.env \
 *     tools/bench/verge-corner-diagnostic.ts
 *
 * The tool rebuilds the renderer's road frames exactly as `island-settlement.ts` does
 * (`createBuildingRoadApproaches` -> `fitStoneRoadWidths` -> `flareBridgeApproaches`), then runs
 * `createRoadGeometry` per tier and reads the placed stones back from the geometry.
 *
 * A corner is a degree-two same-tier node that gets a `createRoadBend` arc. On each of its two
 * arms, the stone row of each side is identified by its nominal offset (the arm's own ribbon width
 * at the bend tangent) and by its distance to the bend centre (inner/outer). The corner's
 * neighbour gaps are then the consecutive gaps of the identified chains within a window around the
 * node, plus the gap between two chains if a side is split. Stones of neighbouring roads never
 * enter the measurement because they are not members of the identified chains.
 */
import { readFileSync } from "node:fs";

import type { BufferGeometry } from "three";

import { createRoadGeometry } from "../../src/renderers/three/settlement/road-geometry";
import type { RoadEdgeStone } from "../../src/renderers/three/settlement/road-edge-pebbles";
import { flareBridgeApproaches } from "../../src/shared/settlement/bridge-approaches";
import { createBuildingRoadApproaches } from "../../src/shared/settlement/building-road-approaches";
import { compactRoadSegments, createRoadBend } from "../../src/shared/settlement/road-curves";
import { fitStoneRoadWidths } from "../../src/shared/settlement/road-fitted-widths";
import {
  ROAD_TIERS,
  type RoadPoint,
  type RoadSegment,
  type RoadTier,
  roadRibbonWidth
} from "../../src/shared/settlement/road-types";

/** The corner stone of one arm/side is at most this far from the node along the arm. */
const ARM_REACH = 1.2;
/** A stone belongs to an arm row when its perpendicular offset matches within this tolerance. */
const OFFSET_TOLERANCE = .09;
/** Stones of the identified chains within this radius of the node form the corner's neighbour run. */
const GAP_WINDOW = 1.4;
/** Stones this close to the apex arc/mitre also seed the side's chain set. */
const APEX_RADIUS = .3;
/** An apex gap whose midpoint is farther than this has no stones at the apex (covered by a road). */
const APEX_OPEN_LIMIT = .6;
/** Only arm stones at least this far from the node are real row stones. */
const ARM_INSET = .04;

type SavedBuilding = Parameters<typeof createBuildingRoadApproaches>[1][number];
type Save = { settlement: { roads: RoadSegment[]; buildings: SavedBuilding[] } };

type Incident = { segment: RoadSegment; other: RoadPoint };
type Corner = {
  bend: NonNullable<ReturnType<typeof createRoadBend>>;
  first: Incident;
  point: RoadPoint;
  second: Incident;
  width: number;
};

type Side = "inner" | "outer";
/** The stone gap that straddles the corner apex, plus how far its midpoint sits from the apex. */
type SideReading = { apexGap: number; apexDistance: number; rows: Set<number>; stones: number };
type Reading = { corner: Corner; inner: SideReading; outer: SideReading };

const pointKey = (point: RoadPoint) => `${point.x}:${point.z}`;

const normalise = (x: number, z: number): RoadPoint => {
  const length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
};

const distanceToPiece = (point: RoadPoint, from: RoadPoint, to: RoadPoint) => {
  const dx = to.x - from.x, dz = to.z - from.z, squared = dx * dx + dz * dz;
  const amount = squared < 1e-12 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / squared));
  return Math.hypot(point.x - (from.x + dx * amount), point.z - (from.z + dz * amount));
};

/** An entrance lane, including its interpolated flare pieces, lies on the access-worker-door path. */
const approachSegments = (buildings: readonly SavedBuilding[]) => {
  const lanes = buildings.map(building => [building.access, building.workerApproach, building.doorThreshold])
    .filter(([access, worker, door]) => access && worker && door) as RoadPoint[][];
  return (segment: RoadSegment) => Boolean(segment.doorway) || lanes.some(lane =>
    distanceToPiece(segment.start, lane[0]!, lane[1]!) <= .05 &&
    distanceToPiece(segment.end, lane[0]!, lane[1]!) <= .05 ||
    distanceToPiece(segment.start, lane[1]!, lane[2]!) <= .05 &&
    distanceToPiece(segment.end, lane[1]!, lane[2]!) <= .05);
};

const incidentWidth = (incident: Incident, point: RoadPoint) =>
  roadRibbonWidth(incident.segment, pointKey(incident.segment.start) === pointKey(point) ? 0 : 1);

const incidentRoads = (segments: readonly RoadSegment[]) => {
  const incidents = new Map<string, Incident[]>();
  for (const segment of segments) {
    if (Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z) < 1e-5) continue;
    for (const [point, other] of [
      [segment.start, segment.end],
      [segment.end, segment.start]
    ] as const) {
      const list = incidents.get(pointKey(point)) ?? [];
      list.push({ segment, other });
      incidents.set(pointKey(point), list);
    }
  }
  return incidents;
};

const isTimberDeck = (segment: RoadSegment) => segment.bridge?.kind === "wood";

/** Same rule as `curvedJoin` in road-geometry: a two-road same-tier node becomes a circular bend. */
const cornerAt = (point: RoadPoint, incidents: readonly Incident[], tier: RoadTier): Corner | undefined => {
  if (incidents.length !== 2) return undefined;
  const [first, second] = incidents as [Incident, Incident];
  if (first.segment.tier !== tier || second.segment.tier !== tier) return undefined;
  if (first.segment.doorway || second.segment.doorway) return undefined;
  if (isTimberDeck(first.segment) || isTimberDeck(second.segment)) return undefined;
  const width = Math.min(incidentWidth(first, point), incidentWidth(second, point));
  const bend = createRoadBend(first.other, point, second.other, width);
  return bend ? { bend, first, point, second, width } : undefined;
};

const stoneOffset = (tier: RoadTier, width: number) => tier === "dirt" ? width * .455 : width * .5 + .065;
/** Intersection of two infinite lines through `point` along `direction`, or undefined if parallel. */
const intersect = (point: RoadPoint, direction: RoadPoint,
  otherPoint: RoadPoint, otherDirection: RoadPoint): RoadPoint | undefined => {
  const denominator = direction.x * otherDirection.z - direction.z * otherDirection.x;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const dx = otherPoint.x - point.x, dz = otherPoint.z - point.z;
  const amount = (dx * otherDirection.z - dz * otherDirection.x) / denominator;
  return { x: point.x + direction.x * amount, z: point.z + direction.z * amount };
};

/** A corner arm: its outward direction, its stone offset, its bend tangent and its inner side. */
type Arm = {
  direction: RoadPoint;
  /** +1 when the bend centre lies right of the outward direction, -1 when it lies left. */
  innerSide: number;
  offset: number;
  tangent: RoadPoint;
};

const cornerArm = (corner: Corner, incident: Incident, tangent: RoadPoint, tier: RoadTier): Arm => {
  const segmentLength = Math.hypot(incident.segment.end.x - incident.segment.start.x,
    incident.segment.end.z - incident.segment.start.z);
  const fromNode = Math.hypot(tangent.x - corner.point.x, tangent.z - corner.point.z);
  const startFraction = pointKey(incident.segment.start) === pointKey(corner.point)
    ? fromNode / segmentLength : 1 - fromNode / segmentLength;
  const direction = normalise(incident.other.x - corner.point.x, incident.other.z - corner.point.z);
  const normal = { x: -direction.z, z: direction.x };
  const centreSide = (corner.bend.centre.x - corner.point.x) * normal.x +
    (corner.bend.centre.z - corner.point.z) * normal.z;
  return {
    direction,
    innerSide: centreSide >= 0 ? 1 : -1,
    offset: stoneOffset(tier, roadRibbonWidth(incident.segment, startFraction)),
    tangent
  };
};

const cornerArms = (corner: Corner, tier: RoadTier) => [
  cornerArm(corner, corner.first, corner.bend.start, tier),
  cornerArm(corner, corner.second, corner.bend.end, tier)
] as const;

/**
 * A corner whose arm is shorter than its inner mitre distance plus one stone gap cannot carry a
 * continuous inner line: the two inner offset lines cross beyond the end of the short link. Such
 * tight links (half-cell road jogs between two bends) are reported separately from normal corners.
 */
const isTightCorner = (corner: Corner, tier: RoadTier, spacing: number) => {
  const arms = cornerArms(corner, tier);
  const angle = Math.acos(Math.max(-1, Math.min(1,
    arms[0].direction.x * arms[1].direction.x + arms[0].direction.z * arms[1].direction.z)));
  const sine = Math.max(.25, Math.sin(angle));
  const first = Math.hypot(corner.first.other.x - corner.point.x, corner.first.other.z - corner.point.z);
  const second = Math.hypot(corner.second.other.x - corner.point.x, corner.second.other.z - corner.point.z);
  return first < arms[1].offset / sine + spacing || second < arms[0].offset / sine + spacing;
};

/** The arm's stone closest to the node on one side; side follows the bend centre. */
const armApexStone = (stones: readonly RoadEdgeStone[], corner: Corner, arm: Arm, side: Side) => {
  let best: { along: number; stone: RoadEdgeStone } | undefined;
  for (const stone of stones) {
    const dx = stone.x - corner.point.x, dz = stone.z - corner.point.z;
    const along = dx * arm.direction.x + dz * arm.direction.z;
    if (along < ARM_INSET || along > ARM_REACH) continue;
    const signedOffset = dx * -arm.direction.z + dz * arm.direction.x;
    if (Math.abs(Math.abs(signedOffset) - arm.offset) > OFFSET_TOLERANCE) continue;
    if (Math.sign(signedOffset) !== arm.innerSide * (side === "inner" ? 1 : -1)) continue;
    if (!best || along < best.along) best = { along, stone };
  }
  return best?.stone;
};

/** The corner's apex point for a side: the outer arc midpoint or the inner mitre intersection. */
const sideApex = (corner: Corner, arms: ReturnType<typeof cornerArms>, tier: RoadTier, side: Side) => {
  if (side === "outer") {
    const angle = corner.bend.startAngle + corner.bend.sweep / 2;
    const radius = corner.bend.radius + stoneOffset(tier, corner.width);
    return { x: corner.bend.centre.x + Math.cos(angle) * radius,
      z: corner.bend.centre.z + Math.sin(angle) * radius };
  }
  const firstToCentre = normalise(corner.bend.centre.x - corner.bend.start.x,
    corner.bend.centre.z - corner.bend.start.z);
  const secondToCentre = normalise(corner.bend.centre.x - corner.bend.end.x,
    corner.bend.centre.z - corner.bend.end.z);
  const firstInner = { x: arms[0].tangent.x + firstToCentre.x * arms[0].offset,
    z: arms[0].tangent.z + firstToCentre.z * arms[0].offset };
  const secondInner = { x: arms[1].tangent.x + secondToCentre.x * arms[1].offset,
    z: arms[1].tangent.z + secondToCentre.z * arms[1].offset };
  return intersect(firstInner, arms[0].direction, secondInner, arms[1].direction);
};

type GapCandidate = { distance: number; gap: number };

/** Keep the gap whose midpoint lies closest to the apex: that is the visible corner gap. */
const closestToApex = (best: GapCandidate, gap: number, midpoint: RoadPoint,
  apex: RoadPoint): GapCandidate => {
  const distance = Math.hypot(midpoint.x - apex.x, midpoint.z - apex.z);
  return distance < best.distance ? { distance, gap } : best;
};

const readSide = (stones: readonly RoadEdgeStone[], corner: Corner, tier: RoadTier, side: Side,
  spacing: number): SideReading => {
  const arms = cornerArms(corner, tier);
  const rows = new Set<number>();
  for (const arm of arms) {
    const apex = armApexStone(stones, corner, arm, side);
    if (apex) rows.add(apex.row);
  }
  const apex = sideApex(corner, arms, tier, side);
  if (apex)
    for (const stone of stones)
      if (Math.hypot(stone.x - apex.x, stone.z - apex.z) <= APEX_RADIUS) rows.add(stone.row);
  const near = stones.filter(stone => rows.has(stone.row) &&
    Math.hypot(stone.x - corner.point.x, stone.z - corner.point.z) <= GAP_WINDOW);
  const byRow = new Map<number, RoadEdgeStone[]>();
  for (const stone of near) {
    const group = byRow.get(stone.row) ?? [];
    group.push(stone);
    byRow.set(stone.row, group);
  }
  const groups = [...byRow.values()];
  for (const group of groups) group.sort((first, second) => first.along - second.along);
  if (!apex) return { apexDistance: Infinity, apexGap: 0, rows, stones: near.length };
  let best: GapCandidate = { distance: Infinity, gap: 0 };
  for (const group of groups)
    for (let index = 1; index < group.length; index++) {
      const first = group[index - 1]!, second = group[index]!;
      best = closestToApex(best, Math.hypot(second.x - first.x, second.z - first.z),
        { x: (first.x + second.x) / 2, z: (first.z + second.z) / 2 }, apex);
    }
  // A split side leaves its two chains facing each other across the apex.
  for (let first = 0; first < groups.length; first++)
    for (let second = first + 1; second < groups.length; second++)
      for (const a of groups[first]!)
        for (const b of groups[second]!) {
          const gap = Math.hypot(a.x - b.x, a.z - b.z);
          if (gap > 3 * spacing) continue;
          best = closestToApex(best, gap, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, apex);
        }
  return { apexDistance: best.distance, apexGap: best.gap, rows, stones: near.length };
};

const tierStones = (segments: RoadSegment[], tier: RoadTier, detailed: boolean): RoadEdgeStone[] => {
  let pebbles: BufferGeometry | undefined;
  const surface = createRoadGeometry(segments, tier, detailed, () => 0, false,
    geometry => { pebbles = geometry; });
  surface.dispose();
  const stones = (pebbles?.userData.pebbles ?? []) as RoadEdgeStone[];
  pebbles?.dispose();
  return stones;
};

const minimumPairDistance = (stones: readonly RoadEdgeStone[]) => {
  let minimum = Infinity;
  for (let first = 0; first < stones.length; first++)
    for (let second = first + 1; second < stones.length; second++)
      minimum = Math.min(minimum, Math.hypot(stones[first]!.x - stones[second]!.x,
        stones[first]!.z - stones[second]!.z));
  return minimum;
};

const fixed = (value: number) => value.toFixed(3);

const reportTier = (segments: RoadSegment[], tier: RoadTier, detailed: boolean,
  isApproach: (segment: RoadSegment) => boolean) => {
  const spacing = detailed ? .225 : .425;
  const stones = tierStones(segments, tier, detailed);
  const incidents = incidentRoads(compactRoadSegments(segments));
  const readings: Reading[] = [], approachReadings: Reading[] = [], tightReadings: Reading[] = [];
  for (const [id, list] of incidents) {
    const [x, z] = id.split(":").map(Number);
    const corner = cornerAt({ x: x!, z: z! }, list, tier);
    if (!corner || stones.length === 0) continue;
    const reading = {
      corner,
      inner: readSide(stones, corner, tier, "inner", spacing),
      outer: readSide(stones, corner, tier, "outer", spacing)
    };
    if (isApproach(corner.first.segment) || isApproach(corner.second.segment))
      approachReadings.push(reading);
    else if (isTightCorner(corner, tier, spacing)) tightReadings.push(reading);
    else readings.push(reading);
  }
  const deviation = (gap: number) => Math.abs(gap - spacing) / spacing;
  const measured = (side: SideReading) => side.apexDistance <= APEX_OPEN_LIMIT;
  const failing = (reading: Reading) => {
    for (const side of [reading.inner, reading.outer])
      if (measured(side) && deviation(side.apexGap) > .15) return true;
    return false;
  };
  const worst = (side: Side) => {
    let deviationWorst = 0, corner = "";
    for (const reading of readings) {
      if (!measured(reading[side])) continue;
      const candidate = deviation(reading[side].apexGap);
      if (candidate > deviationWorst) {
        deviationWorst = candidate;
        corner = `${fixed(reading.corner.point.x)},${fixed(reading.corner.point.z)}`;
      }
    }
    return { corner, deviation: deviationWorst };
  };
  const innerWorst = worst("inner"), outerWorst = worst("outer");
  const failures = readings.filter(failing);
  console.log(`\n=== tier ${tier}, detail ${detailed ? "high" : "minimal"}, reference ${spacing}, ` +
    `${stones.length} stones, ${readings.length} road corners, ${failures.length} outside 15%, ` +
    `${tightReadings.length} tight short-link corners, ${approachReadings.length} approach corners ===`);
  for (const reading of readings) {
    const describe = (side: SideReading) => measured(side)
      ? `apex=${fixed(side.apexGap)} at ${fixed(side.apexDistance)} n=${side.stones} rows=${[...side.rows]}`
      : `open n=${side.stones}`;
    console.log(`${failing(reading) ? "FAIL " : ""}corner ${fixed(reading.corner.point.x)},` +
      `${fixed(reading.corner.point.z)} width=${fixed(reading.corner.width)} ` +
      `inner [${describe(reading.inner)}] | outer [${describe(reading.outer)}]`);
  }
  console.log(`worst inner ${(innerWorst.deviation * 100).toFixed(1)}% at ${innerWorst.corner}; ` +
    `worst outer ${(outerWorst.deviation * 100).toFixed(1)}% at ${outerWorst.corner}`);
  const listCorners = (items: Reading[]) => items.map(reading =>
    `${fixed(reading.corner.point.x)},${fixed(reading.corner.point.z)}`).join(" | ");
  const tightFailures = tightReadings.filter(failing);
  if (tightFailures.length)
    console.log(`tight short-link corners outside 15%: ${listCorners(tightFailures)}`);
  const approachFailures = approachReadings.filter(failing);
  if (approachFailures.length)
    console.log(`building-approach corners outside 15%: ${listCorners(approachFailures)}`);
  const minimum = minimumPairDistance(stones);
  console.log(`minimum pair distance ${fixed(minimum)} (${(minimum / spacing * 100).toFixed(1)}% of reference)`);
};

/** `CORNER=x,z` dumps every stone near one corner with its row, side and along-road order. */
const dumpCorner = (segments: RoadSegment[], tier: RoadTier, point: RoadPoint,
  buildings: readonly SavedBuilding[]) => {
  const stones = tierStones(segments, tier, true);
  const near = stones.filter(stone => Math.hypot(stone.x - point.x, stone.z - point.z) <= 2.5)
    .sort((first, second) => first.row - second.row || first.along - second.along);
  console.log(`\n--- all stones within 2.5 of ${point.x},${point.z} (${tier}, high) ---`);
  for (const stone of near)
    console.log(`row ${stone.row} side ${stone.side} along ${stone.along.toFixed(3)} ` +
      `(${stone.x.toFixed(3)},${stone.z.toFixed(3)}) edge (${stone.edgeX.toFixed(3)},${stone.edgeZ.toFixed(3)})`);
  for (const segment of compactRoadSegments(segments).filter(segment =>
    Math.hypot(segment.start.x - point.x, segment.start.z - point.z) <= 2.5 ||
    Math.hypot(segment.end.x - point.x, segment.end.z - point.z) <= 2.5))
    console.log(`segment ${segment.tier} ${segment.start.x},${segment.start.z} -> ${segment.end.x},${segment.end.z} ` +
      `width ${segment.startWidth ?? "-"}/${segment.endWidth ?? "-"} doorway ${segment.doorway ?? false}`);
  for (const building of buildings)
    for (const [name, approach] of [["access", building.access],
      ["worker", building.workerApproach], ["door", building.doorThreshold]] as const)
      if (approach && Math.hypot(approach.x - point.x, approach.z - point.z) <= 3)
        console.log(`building ${name} ${approach.x},${approach.z}`);
};

const save = JSON.parse(readFileSync(process.env.SAVE!, "utf8")) as Save;
const roads = save.settlement.roads;
const buildings = save.settlement.buildings;
const frames = flareBridgeApproaches(
  fitStoneRoadWidths(createBuildingRoadApproaches(roads, buildings), { isBlocked: () => false }));
console.log(`save roads ${roads.length}, buildings ${buildings.length}, renderer frames ${frames.length}`);
const tiers = ROAD_TIERS.filter(tier => frames.some(segment => segment.tier === tier));
console.log(`tiers ${tiers.join(", ")}`);
const isApproach = approachSegments(buildings);
for (const tier of tiers)
  for (const detailed of [true, false]) reportTier(frames, tier, detailed, isApproach);
const corner = process.env.CORNER?.split(",").map(Number);
if (corner?.length === 2)
  dumpCorner(frames, process.env.CORNER_TIER as RoadTier ?? "limestone",
    { x: corner[0]!, z: corner[1]! }, buildings);
