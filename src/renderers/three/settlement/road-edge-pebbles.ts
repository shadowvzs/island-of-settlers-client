import { BufferGeometry, Float32BufferAttribute } from "three";

import { ROAD_APPEARANCE } from "../../../render-common/road-appearance";
import { ROAD_WIDTH, type RoadPoint, type RoadTier } from "../../../shared/settlement/road-types";
import type { createRoadSurfaceProfile } from "./road-surface-profile";

export type PebbleSample = {
  capEdge?: boolean;
  normal: RoadPoint;
  point: RoadPoint;
  /** Bend-radius samples only: the inner edge of a tighter bend cannot carry a stone row. */
  radius?: number;
  width?: number;
};

/** One placed roadside stone; also exposed on `geometry.userData.pebbles` for review and tests. */
export interface RoadEdgeStone {
  /** Arc length of the stone along its merged edge row. */
  along: number;
  /** Nominal road-edge point, used to detect coverage by another road ribbon. */
  edgeX: number;
  edgeZ: number;
  /** Facing of a stone kerb block; the dirt pebble uses its own hashed rotation instead. */
  normalAngle: number;
  /** Merged edge-row id: stones of one continuous side line share it. */
  row: number;
  side: number;
  x: number;
  z: number;
}

const unit = [[0, .75, 0], [-1, 0, 0], [0, 0, -.85], [1, 0, 0], [0, 0, .85], [0, -.3, 0]];
const faces = [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1];
const squareUnit = [
  [-1, -.08, -1], [1, -.08, -1], [1, -.08, 1], [-1, -.08, 1],
  [-1, .82, -1], [1, .82, -1], [1, .82, 1], [-1, .82, 1],
  [-.72, 1, -.72], [.72, 1, -.72], [.72, 1, .72], [-.72, 1, .72]
];
const squareFaces = [8, 11, 10, 8, 10, 9, 0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1,
  1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  4, 8, 9, 4, 9, 5, 5, 9, 10, 5, 10, 6, 6, 10, 11, 6, 11, 7, 7, 11, 8, 7, 8, 4];
const noise = (x: number, z: number, salt: number) => {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 73.9) * 43758.5453;
  return value - Math.floor(value);
};

/** The owner-approved straight-road spacing (2026-11-08) measured along each edge line. */
const stoneSpacing = (detailed: boolean) => detailed ? .225 : .425;
/** Stones stay this far from a ribbon tip; leaves narrowed doorway access and tips clean. */
const TIP_MARGIN = .12;
/** A row starts this far in, plus a small hashed jitter, exactly like the straight-road reference. */
const ROW_START = .12;
const ROW_START_JITTER = .10;
/** A stone this close to an already placed stone of another edge row is skipped (owner 2026-11-08). */
const CROSS_ROW_CLEARANCE = .999;
/** Ribbon endpoints of one edge line share their centre point; only their widths may differ. */
const SEAM_TOLERANCE = 1e-6;
const SEAM_ALIGNMENT = .9;
/** Fitted widths and bridge flares can shift a row laterally by up to this much at one seam. */
const SEAM_GAP = .7;
/** A stone line inside a bend narrower than this share of its radius would fold over the centre. */
const BEND_CLEARANCE = .95;
/** Pebble grid key resolution of the original straight-road placement (0.05 world units). */
const OCCUPANCY_SCALE = 20;

/** A bend ribbon's circular arc, recovered from its samples (point = centre + normal * radius). */
interface BendInfo {
  centre: RoadPoint;
  radius: number;
  width: number;
}

/** One sample of an edge line: the road centre, the nominal stone line and the source ribbon. */
interface EdgePoint {
  centre: RoadPoint;
  nominal: RoadPoint;
  normal: RoadPoint;
  samples: PebbleSample[];
  side: number;
  width: number;
}

interface EdgeRow {
  /** Set on the rows a bend ribbon produces, so a missing inner row can be joined at its mitre. */
  bend?: BendInfo;
  cap: boolean;
  points: EdgePoint[];
  /** Ribbon that generated this row; rows of one edge line use different ribbons across a seam. */
  ribbon: number;
}

interface ChainSegment {
  a: EdgePoint;
  b: EdgePoint;
  length: number;
  samples: PebbleSample[];
  start: number;
}

interface StoneChain {
  cap: boolean;
  length: number;
  segments: ChainSegment[];
  start: RoadPoint;
}

interface StoneState {
  grid: Map<string, RoadEdgeStone[]>;
  occupied: Set<string>;
  spacing: number;
  stones: RoadEdgeStone[];
}

const normalise = (x: number, z: number): RoadPoint | undefined => {
  const length = Math.hypot(x, z);
  return length < 1e-9 ? undefined : { x: x / length, z: z / length };
};

const mixPoint = (from: RoadPoint, to: RoadPoint, amount: number): RoadPoint =>
  ({ x: from.x + (to.x - from.x) * amount, z: from.z + (to.z - from.z) * amount });

const addPoint = (point: RoadPoint, normal: RoadPoint, distance: number): RoadPoint =>
  ({ x: point.x + normal.x * distance, z: point.z + normal.z * distance });

const centreKey = (point: RoadPoint) =>
  `${Math.round(point.x / SEAM_TOLERANCE)}:${Math.round(point.z / SEAM_TOLERANCE)}`;

/** Distance of a stone line outside its ribbon edge; a dead-end cap carries its own rounded row. */
const stoneOffset = (tier: RoadTier, width: number, cap: boolean) => {
  if (cap) return tier === "dirt" ? 0 : .065;
  return tier === "dirt" ? width * .455 : width * .5 + .065;
};

/** Circular arc of a bend ribbon, recovered from its first sample. */
const bendInfo = (samples: PebbleSample[]): BendInfo | undefined => {
  const sample = samples[0];
  if (sample?.radius === undefined) return undefined;
  return {
    centre: { x: sample.point.x - sample.normal.x * sample.radius,
      z: sample.point.z - sample.normal.z * sample.radius },
    radius: sample.radius,
    width: sample.width ?? ROAD_WIDTH
  };
};

const sideRow = (samples: PebbleSample[], side: -1 | 1, tier: RoadTier,
  ribbon: number): EdgeRow | undefined => {
  const radius = samples[0]?.radius;
  const firstWidth = samples[0]?.width ?? ROAD_WIDTH;
  // The inner edge of a tight bend folds over the centre: its mitre join is built separately.
  if (radius !== undefined && side < 0 && stoneOffset(tier, firstWidth, false) >= radius * BEND_CLEARANCE)
    return undefined;
  return {
    bend: bendInfo(samples),
    cap: false,
    points: samples.map(sample => {
      const width = sample.width ?? ROAD_WIDTH;
      const nominal = addPoint(sample.point, sample.normal, stoneOffset(tier, width, false) * side);
      return { centre: sample.point, nominal, normal: sample.normal, samples, side, width };
    }),
    ribbon
  };
};

const capRow = (samples: PebbleSample[], tier: RoadTier, ribbon: number): EdgeRow => ({
  cap: true,
  points: samples.map(sample => {
    const width = sample.width ?? ROAD_WIDTH;
    return {
      centre: sample.point,
      nominal: addPoint(sample.point, sample.normal, stoneOffset(tier, width, true)),
      normal: sample.normal,
      samples,
      side: 1,
      width
    };
  }),
  ribbon
});

const buildRows = (ribbons: readonly PebbleSample[][], tier: RoadTier): EdgeRow[] => {
  const rows: EdgeRow[] = [];
  for (const [ribbon, samples] of ribbons.entries()) {
    if (samples.length < 2) continue;
    if (samples[0]!.capEdge) {
      rows.push(capRow(samples, tier, ribbon));
      continue;
    }
    for (const side of [-1, 1] as const) {
      const row = sideRow(samples, side, tier, ribbon);
      if (row) rows.push(row);
    }
  }
  return rows;
};

interface RowEnd {
  atStart: boolean;
  row: number;
}

const endKey = (end: RowEnd) => `${end.row}:${end.atStart ? 0 : 1}`;

const rowEndCentre = (row: EdgeRow, atStart: boolean) =>
  atStart ? row.points[0]!.centre : row.points[row.points.length - 1]!.centre;

const rowEndPoint = (row: EdgeRow, atStart: boolean) =>
  atStart ? row.points[0]!.nominal : row.points[row.points.length - 1]!.nominal;

/** Tangent the road has when it arrives at this row end (from inside the row). */
const arrivalTangent = (row: EdgeRow, atStart: boolean): RoadPoint | undefined => {
  const points = row.points, last = points.length - 1;
  return atStart
    ? normalise(points[0]!.nominal.x - points[1]!.nominal.x,
      points[0]!.nominal.z - points[1]!.nominal.z)
    : normalise(points[last]!.nominal.x - points[last - 1]!.nominal.x,
      points[last]!.nominal.z - points[last - 1]!.nominal.z);
};

/** Tangent the road takes when it leaves this row end (into the row). */
const departureTangent = (row: EdgeRow, atStart: boolean): RoadPoint | undefined => {
  const points = row.points, last = points.length - 1;
  return atStart
    ? normalise(points[1]!.nominal.x - points[0]!.nominal.x,
      points[1]!.nominal.z - points[0]!.nominal.z)
    : normalise(points[last - 1]!.nominal.x - points[last]!.nominal.x,
      points[last - 1]!.nominal.z - points[last]!.nominal.z);
};

/** Direction from a row end into its row, used to intersect the two inner arm lines. */
const rowEndDirection = (row: EdgeRow, atStart: boolean): RoadPoint | undefined => {
  const points = row.points, last = points.length - 1;
  return atStart
    ? normalise(points[1]!.nominal.x - points[0]!.nominal.x,
      points[1]!.nominal.z - points[0]!.nominal.z)
    : normalise(points[last - 1]!.nominal.x - points[last]!.nominal.x,
      points[last - 1]!.nominal.z - points[last]!.nominal.z);
};

const nonCapEnds = (rows: EdgeRow[]) => {
  const ends: RowEnd[] = [];
  for (let row = 0; row < rows.length; row++)
    if (!rows[row]!.cap) ends.push({ atStart: true, row }, { atStart: false, row });
  return ends;
};

const endsByCentre = (rows: EdgeRow[], ends: RowEnd[]) => {
  const groups = new Map<string, RowEnd[]>();
  for (const end of ends) {
    const key = centreKey(rowEndCentre(rows[end.row]!, end.atStart));
    const group = groups.get(key) ?? [];
    group.push(end);
    groups.set(key, group);
  }
  return groups;
};

type SeamCandidate = { alignment: number; distance: number; first: RowEnd; second: RowEnd };

const seamCandidate = (rows: EdgeRow[], first: RowEnd, second: RowEnd): SeamCandidate | undefined => {
  if (first.row === second.row || rows[first.row]!.ribbon === rows[second.row]!.ribbon) return undefined;
  const arrival = arrivalTangent(rows[first.row]!, first.atStart);
  const departure = departureTangent(rows[second.row]!, second.atStart);
  if (!arrival || !departure) return undefined;
  const alignment = arrival.x * departure.x + arrival.z * departure.z;
  if (alignment < SEAM_ALIGNMENT) return undefined;
  const firstPoint = rowEndPoint(rows[first.row]!, first.atStart);
  const secondPoint = rowEndPoint(rows[second.row]!, second.atStart);
  const distance = Math.hypot(firstPoint.x - secondPoint.x, firstPoint.z - secondPoint.z);
  return distance <= SEAM_GAP ? { alignment, distance, first, second } : undefined;
};

/**
 * Pair ribbon endpoints that continue one edge line. Endpoints are matched by their shared centre
 * point (widths, and therefore nominal offsets, may differ after fitting or a bridge flare); the
 * closest nominal pair wins, so a junction branch never steals a through row's partner. Pairing all
 * rows of one centre group at once lets the chain insert a short connector instead of restarting
 * the stone spacing at the width step.
 */
const pairSeams = (rows: EdgeRow[]) => {
  const ends = nonCapEnds(rows);
  const partner = new Map<string, RowEnd>();
  for (const group of endsByCentre(rows, ends).values()) {
    const candidates: SeamCandidate[] = [];
    for (let first = 0; first < group.length; first++)
      for (let second = first + 1; second < group.length; second++) {
        const candidate = seamCandidate(rows, group[first]!, group[second]!);
        if (candidate) candidates.push(candidate);
      }
    candidates.sort((first, second) => first.distance - second.distance ||
      second.alignment - first.alignment);
    for (const candidate of candidates) {
      if (partner.has(endKey(candidate.first)) || partner.has(endKey(candidate.second))) continue;
      partner.set(endKey(candidate.first), candidate.second);
      partner.set(endKey(candidate.second), candidate.first);
    }
  }
  return { ends, partner };
};

/** Intersection of two infinite lines through `point` along `direction`, undefined if parallel. */
const intersectLines = (point: RoadPoint, direction: RoadPoint,
  otherPoint: RoadPoint, otherDirection: RoadPoint): RoadPoint | undefined => {
  const denominator = direction.x * otherDirection.z - direction.z * otherDirection.x;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const dx = otherPoint.x - point.x, dz = otherPoint.z - point.z;
  const amount = (dx * otherDirection.z - dz * otherDirection.x) / denominator;
  return { x: point.x + direction.x * amount, z: point.z + direction.z * amount };
};

/**
 * Clip a row to the mitre point: the stone line of an arm inner edge stops where the two inner
 * offset lines cross, so the inner apex is one clean clipped corner without overlapping tails.
 */
const clipRowAtMitre = (row: EdgeRow, atStart: boolean, mitre: RoadPoint) => {
  const outward = atStart ? row.points.slice() : row.points.slice().reverse();
  if (outward.length < 2) return false;
  const seam = outward[0]!.nominal;
  const direction = normalise(outward[outward.length - 1]!.nominal.x - seam.x,
    outward[outward.length - 1]!.nominal.z - seam.z);
  if (!direction) return false;
  const measure = (point: RoadPoint) => (point.x - seam.x) * direction.x + (point.z - seam.z) * direction.z;
  const target = measure(mitre);
  if (target > measure(outward[outward.length - 1]!.nominal) + 1e-9) return false;
  let index = 0;
  while (index < outward.length && measure(outward[index]!.nominal) <= target + 1e-9) index++;
  if (index >= outward.length) return false;
  const after = outward[index]!;
  const before = outward[Math.max(0, index - 1)]!;
  const span = measure(after.nominal) - measure(before.nominal);
  const amount = index === 0 || span < 1e-9 ? 0 : Math.max(0, Math.min(1,
    (target - measure(before.nominal)) / span));
  const normal = normalise(before.normal.x + (after.normal.x - before.normal.x) * amount,
    before.normal.z + (after.normal.z - before.normal.z) * amount) ?? before.normal;
  const clipped: EdgePoint = {
    centre: addPoint(before.centre, direction, target - measure(before.nominal)),
    nominal: mitre,
    normal,
    samples: before.samples,
    side: before.side,
    width: before.width + (after.width - before.width) * amount
  };
  const reordered = [clipped, ...outward.slice(index)];
  row.points = atStart ? reordered : reordered.reverse();
  return true;
};

/** The unpaired inner row end of the arm that meets a bend ribbon at `centrePoint`. */
const innerArmEnd = (rows: EdgeRow[], groups: Map<string, RowEnd[]>, partner: Map<string, RowEnd>,
  bendRow: EdgeRow, centrePoint: RoadPoint): RowEnd | undefined => {
  const centre = bendRow.bend!.centre;
  for (const end of groups.get(centreKey(centrePoint)) ?? []) {
    const row = rows[end.row]!;
    if (row.ribbon === bendRow.ribbon || partner.has(endKey(end))) continue;
    const nominal = rowEndPoint(row, end.atStart);
    const innerSide = (nominal.x - centrePoint.x) * (centre.x - centrePoint.x) +
      (nominal.z - centrePoint.z) * (centre.z - centrePoint.z);
    if (innerSide > 0) return end;
  }
  return undefined;
};

/**
 * A stone bend's inner arc folds over the road centre, so that row is not generated. The two arm
 * inner rows are clipped at their common mitre instead and chained into one continuous inner line.
 */
const pairInnerMitres = (rows: EdgeRow[], ends: RowEnd[], partner: Map<string, RowEnd>) => {
  const groups = endsByCentre(rows, ends);
  for (let index = 0; index < rows.length; index++) {
    const bendRow = rows[index]!;
    if (bendRow.cap || !bendRow.bend) continue;
    // The bend ribbon generated its inner row when a sibling row exists; nothing to repair then.
    if (rows.some(row => row.ribbon === bendRow.ribbon && row !== bendRow)) continue;
    const first = innerArmEnd(rows, groups, partner, bendRow, rowEndCentre(bendRow, true));
    const last = innerArmEnd(rows, groups, partner, bendRow, rowEndCentre(bendRow, false));
    if (!first || !last) continue;
    const firstRow = rows[first.row]!, lastRow = rows[last.row]!;
    const firstDirection = rowEndDirection(firstRow, first.atStart);
    const lastDirection = rowEndDirection(lastRow, last.atStart);
    if (!firstDirection || !lastDirection) continue;
    const mitre = intersectLines(rowEndPoint(firstRow, first.atStart), firstDirection,
      rowEndPoint(lastRow, last.atStart), lastDirection);
    if (!mitre) continue;
    // A short link between two corners cannot reach its mitre: leave both inner rows as they are
    // rather than dragging a stone line across the junction's paving.
    const firstPoints = firstRow.points, lastPoints = lastRow.points;
    if (!clipRowAtMitre(firstRow, first.atStart, mitre) ||
      !clipRowAtMitre(lastRow, last.atStart, mitre)) {
      firstRow.points = firstPoints;
      lastRow.points = lastPoints;
      continue;
    }
    partner.set(endKey(first), last);
    partner.set(endKey(last), first);
  }
};

interface OrientedRow {
  reversed: boolean;
  row: number;
}

/** Chain ribbons of one edge line in either direction, so spacing continues through corners. */
const buildChains = (rows: EdgeRow[]): OrientedRow[][] => {
  const { ends, partner } = pairSeams(rows);
  pairInnerMitres(rows, ends, partner);
  const visited = new Set<number>();
  const walk = (startRow: number, startAtStart: boolean) => {
    const chain: OrientedRow[] = [];
    let row = startRow, enterAtStart = startAtStart;
    while (!visited.has(row)) {
      visited.add(row);
      chain.push({ reversed: !enterAtStart, row });
      const next = partner.get(endKey({ atStart: !enterAtStart, row }));
      if (!next || visited.has(next.row)) break;
      row = next.row;
      enterAtStart = next.atStart;
    }
    return chain;
  };
  const chains: OrientedRow[][] = [];
  for (let row = 0; row < rows.length; row++) {
    for (const atStart of [true, false]) {
      if (visited.has(row) || partner.has(endKey({ atStart, row }))) continue;
      chains.push(walk(row, atStart));
    }
  }
  for (let row = 0; row < rows.length; row++) if (!visited.has(row)) chains.push(walk(row, true));
  return chains.filter(chain => chain.length > 0);
};

const createChain = (rows: EdgeRow[], orientedRows: OrientedRow[]): StoneChain | undefined => {
  const segments: ChainSegment[] = [];
  let length = 0;
  for (const { reversed, row: rowId } of orientedRows) {
    const source = rows[rowId]!.points;
    const points = reversed ? [...source].reverse() : source;
    if (!points.length) continue;
    // A width step at a seam leaves a short gap between the two rows: bridge it so the spacing
    // continues instead of restarting, and so no stone is missing at the outer apex.
    const previous = segments[segments.length - 1]?.b;
    if (previous) {
      const first = points[0]!;
      const gap = Math.hypot(first.nominal.x - previous.nominal.x, first.nominal.z - previous.nominal.z);
      if (gap > 1e-9) {
        segments.push({ a: previous, b: first, length: gap, samples: first.samples, start: length });
        length += gap;
      }
    }
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!;
      const segmentLength = Math.hypot(b.nominal.x - a.nominal.x, b.nominal.z - a.nominal.z);
      if (segmentLength < 1e-9) continue;
      segments.push({ a, b, length: segmentLength, samples: a.samples, start: length });
      length += segmentLength;
    }
  }
  if (!segments.length) return undefined;
  return {
    cap: rows[orientedRows[0]!.row]!.cap,
    length,
    segments,
    start: segments[0]!.a.nominal
  };
};

/** Longer rows first, caps last: the established tip row keeps its place against the side rows. */
const compareChains = (first: StoneChain, second: StoneChain) =>
  Number(first.cap) - Number(second.cap) || second.length - first.length ||
  first.start.x - second.start.x || first.start.z - second.start.z;

const locateSegment = (segments: ChainSegment[], along: number) => {
  let index = 0;
  while (index < segments.length - 1 && along > segments[index]!.start + segments[index]!.length) index++;
  return index;
};

const stoneAt = (segment: ChainSegment, amount: number, along: number, row: number,
  tier: RoadTier, profile: ReturnType<typeof createRoadSurfaceProfile>): RoadEdgeStone | undefined => {
  const { a, b } = segment;
  const width = a.width * (1 - amount) + b.width * amount;
  if (width < ROAD_WIDTH * .98) return undefined;
  const normal = normalise(
    a.normal.x + (b.normal.x - a.normal.x) * amount,
    a.normal.z + (b.normal.z - a.normal.z) * amount
  );
  if (!normal) return undefined;
  const nominal = mixPoint(a.nominal, b.nominal, amount);
  const centre = mixPoint(a.centre, b.centre, amount);
  const cap = segment.samples[0]!.capEdge === true;
  const jitter = cap || tier !== "dirt" ? 0 : width * .025 * noise(centre.x, centre.z, a.side + 7);
  const x = nominal.x + normal.x * a.side * jitter;
  const z = nominal.z + normal.z * a.side * jitter;
  const edgeX = cap ? centre.x : centre.x + normal.x * width * .5 * a.side;
  const edgeZ = cap ? centre.z : centre.z + normal.z * width * .5 * a.side;
  if (profile.isEdgeCovered(edgeX, edgeZ, segment.samples)) return undefined;
  return { along, edgeX, edgeZ, normalAngle: Math.atan2(normal.z, normal.x), row, side: a.side, x, z };
};

const isClearOfOtherRows = (stone: RoadEdgeStone, state: StoneState) => {
  const cellX = Math.floor(stone.x / state.spacing), cellZ = Math.floor(stone.z / state.spacing);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    for (const other of state.grid.get(`${cellX + dx}:${cellZ + dz}`) ?? []) {
      if (other.row === stone.row) continue;
      if (Math.hypot(other.x - stone.x, other.z - stone.z) < state.spacing * CROSS_ROW_CLEARANCE)
        return false;
    }
  }
  return true;
};

const keepStone = (stone: RoadEdgeStone, cap: boolean, state: StoneState) => {
  const key = `${Math.round(stone.x * OCCUPANCY_SCALE)}:${Math.round(stone.z * OCCUPANCY_SCALE)}`;
  if (state.occupied.has(key)) return;
  // A dead-end cap keeps its established row; only side rows are thinned where roads meet.
  if (!cap && !isClearOfOtherRows(stone, state)) return;
  state.occupied.add(key);
  state.stones.push(stone);
  if (cap) return;
  const cell = `${Math.floor(stone.x / state.spacing)}:${Math.floor(stone.z / state.spacing)}`;
  const bucket = state.grid.get(cell) ?? [];
  bucket.push(stone);
  state.grid.set(cell, bucket);
};

interface ChainPoint {
  along: number;
  amount: number;
  point: RoadPoint;
  segment: number;
}

/** First point of a segment at exactly `radius` from `centre`, at or after `minAmount`. */
const segmentRoot = (segment: ChainSegment, centre: RoadPoint, radius: number,
  minAmount: number): number | undefined => {
  const dx = segment.b.nominal.x - segment.a.nominal.x;
  const dz = segment.b.nominal.z - segment.a.nominal.z;
  const fx = segment.a.nominal.x - centre.x;
  const fz = segment.a.nominal.z - centre.z;
  const quadratic = dx * dx + dz * dz;
  if (quadratic < 1e-18) return undefined;
  const linear = 2 * (fx * dx + fz * dz);
  const constant = fx * fx + fz * fz - radius * radius;
  const discriminant = linear * linear - 4 * quadratic * constant;
  if (discriminant < 0) return undefined;
  const root = Math.sqrt(discriminant);
  for (const amount of [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)]) {
    if (amount >= minAmount - 1e-9 && amount <= 1 + 1e-9) return Math.min(1, Math.max(0, amount));
  }
  return undefined;
};

const chainPoint = (chain: StoneChain, segment: number, amount: number): ChainPoint => {
  const source = chain.segments[segment]!;
  return {
    along: source.start + source.length * amount,
    amount,
    point: mixPoint(source.a.nominal, source.b.nominal, amount),
    segment
  };
};

const pointOnChain = (chain: StoneChain, along: number): ChainPoint => {
  const segment = locateSegment(chain.segments, along);
  const source = chain.segments[segment]!;
  const amount = Math.min(1, Math.max(0, (along - source.start) / source.length));
  return chainPoint(chain, segment, amount);
};

/** Next point whose straight-line distance to `from` is the spacing, walking the edge line. */
const spacedPoint = (chain: StoneChain, from: ChainPoint, spacing: number): ChainPoint | undefined => {
  for (let segment = from.segment; segment < chain.segments.length; segment++) {
    const source = chain.segments[segment]!;
    const amount = segmentRoot(source, from.point, spacing, segment === from.segment ? from.amount : 0);
    if (amount === undefined) continue;
    const point = chainPoint(chain, segment, amount);
    if (point.along > from.along + 1e-9) return point;
  }
  return undefined;
};

/** Dead-end caps keep their established arc placement; side rows keep equal gaps even through a corner. */
const advancePoint = (chain: StoneChain, from: ChainPoint, spacing: number) =>
  chain.cap ? pointOnChain(chain, from.along + spacing) : spacedPoint(chain, from, spacing);

const placeChain = (chain: StoneChain, row: number, tier: RoadTier,
  profile: ReturnType<typeof createRoadSurfaceProfile>, state: StoneState) => {
  const first = chain.segments[0]!.a;
  const start = ROW_START + noise(first.centre.x, first.centre.z, 5) * ROW_START_JITTER;
  if (start > chain.length - TIP_MARGIN) return;
  const attempt = (point: ChainPoint) => {
    const stone = stoneAt(chain.segments[point.segment]!, point.amount, point.along, row, tier, profile);
    if (stone) keepStone(stone, chain.cap, state);
  };
  let reference = pointOnChain(chain, start);
  attempt(reference);
  for (;;) {
    const next = advancePoint(chain, reference, state.spacing);
    if (!next || next.along > chain.length - TIP_MARGIN) return;
    reference = next;
    attempt(reference);
  }
};

/**
 * Edge stones are spaced along each merged edge line, one row per side. Seams pair by shared road
 * centre point, so a fitted or flared width step bridges with a short connector instead of
 * restarting the spacing; a stone bend's missing inner arc row is replaced by the clipped mitre
 * of its two arm rows. Side rows step by the straight-line gap between neighbours, so a bend's
 * inner corner cannot bunch while its outer side keeps the straight-road spacing; dead-end caps
 * keep their arc placement. Pure and deterministic.
 */
export const createRoadEdgeStones = (
  ribbons: readonly PebbleSample[][],
  profile: ReturnType<typeof createRoadSurfaceProfile>,
  detailed: boolean,
  tier: RoadTier = "dirt"
): RoadEdgeStone[] => {
  const rows = buildRows(ribbons, tier);
  const chains = buildChains(rows)
    .map(orientedRows => createChain(rows, orientedRows))
    .filter((chain): chain is StoneChain => chain !== undefined)
    .sort(compareChains);
  const state: StoneState = { grid: new Map(), occupied: new Set(), spacing: stoneSpacing(detailed), stones: [] };
  chains.forEach((chain, row) => placeChain(chain, row, tier, profile, state));
  return state.stones;
};

/** One immutable geometry batch rebuilt only with the road graph, never during animation. */
export const createRoadEdgePebbles = (
  ribbons: PebbleSample[][], profile: ReturnType<typeof createRoadSurfaceProfile>,
  height: (x: number, z: number) => number, detailed: boolean, tier: RoadTier = "dirt"
) => {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const stones = createRoadEdgeStones(ribbons, profile, detailed, tier);
  for (const stone of stones) {
    const { x: px, z: pz } = stone;
    const radius = .035 + noise(px, pz, 2) * .015;
    // Stone kerbs: 30 % lower than first built (owner, 2026-10-12).
    const rise = tier !== "dirt" ? .084 + noise(px, pz, 3) * .021 : .018 + noise(px, pz, 3) * .010;
    const angle = tier !== "dirt" ?
      stone.normalAngle + (noise(px, pz, 4) - .5) * .16 : noise(px, pz, 4) * Math.PI * 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const shade = .30 + noise(px, pz, 1) * .16;
    const first = positions.length / 3;
    for (const [vx, vy, vz] of tier !== "dirt" ? squareUnit : unit) {
      const gx = px + (vx! * cos - vz! * sin) * radius, gz = pz + (vx! * sin + vz! * cos) * radius;
      positions.push(gx, height(gx, gz) + (tier !== "dirt" ? .008 : .018) + profile(gx, gz) + vy! * rise, gz);
      const tint = ROAD_APPEARANCE[tier].rgb;
      if (tier === "dirt") colors.push(shade * 1.06, shade, shade * .88);
      else colors.push(shade * tint[0] / 139, shade * tint[1] / 139, shade * tint[2] / 139);
    }
    for (const index of tier !== "dirt" ? squareFaces : faces) indices.push(first + index);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.userData.pebbles = stones;
  return geometry;
};
