import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { indigenousRoofHeight } from "../../../render-common/buildings/indigenous-roof-profile";
import { MAYA_PLANT_ROOF_CORE_THICKNESS, mayaPlantRoofProfileHeight }
  from "../../../render-common/buildings/maya-plant-roof-profile";
import {
  ACROSS_SLOPE, getEndSlope, getOccupationRoofHeight, HIP_RIDGE_END, isHippedOccupationRoof
} from "../../../render-common/buildings/occupation-roof-height";

/** Closed vertical timber end below an outlaw roof; shares its barrel or pitched outline. */
export const createRoofEndInfill = (part: BuildingPart, detailed: boolean) => {
  const positions: number[] = [],
    uvs: number[] = [];
  let count = detailed ? 10 : 4;
  if (part.compactGeometry && !part.roofCurve && part.occupationRoof !== "barrel") count = 2;
  const height = (value: number) => {
    const x = value * (part.roofInfillRatio?.[0] ?? 1),
      z = (part.roofInfillRatio?.[1] ?? 1) / 2;
    // End infill spans the full ridge: seat its top beneath the lowest central cloth sag too.
    if (part.indigenousRoof === "awning") return indigenousRoofHeight("awning", x, 0) - .035;
    if (part.plantRoofStyle || part.surface === "straw")
      return mayaPlantRoofProfileHeight(part, x, z) - MAYA_PLANT_ROOF_CORE_THICKNESS + .005;
    if (part.roofSweep || part.roofCurve)
      return getOccupationRoofHeight(part.occupationRoof, x, z, part.roofSweep, part.roofCurve);
    if (part.occupationRoof === "barrel")
      return -0.44 + 0.87 * Math.sqrt(Math.max(0, 1 - 4 * x * x));
    const across = 0.43 - 1.74 * Math.abs(x);
    if (part.occupationRoof === "gable") return across;
    const slope = part.occupationRoof === "half-hip" ? 2.7 : 4.35;
    return Math.min(across, 0.43 - slope * Math.max(0, z - 0.3));
  };
  const vertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    uvs.push(x + 0.5, y + 0.5);
  };
  const triangle = (a: number[], b: number[], c: number[]) => {
    for (const point of [a, b, c]) vertex(point[0]!, point[1]!, point[2]!);
  };
  for (let index = 0; index < count; index++) {
    const x0 = index / count - 0.5,
      x1 = (index + 1) / count - 0.5,
      y0 = height(x0),
      y1 = height(x1);
    for (const side of [-1, 1]) {
      const a = [x0, -0.5, side * 0.5],
        b = [x1, -0.5, side * 0.5],
        c = [x1, y1, side * 0.5],
        d = [x0, y0, side * 0.5];
      if (side > 0) {
        triangle(a, b, c);
        triangle(a, c, d);
      } else {
        triangle(a, c, b);
        triangle(a, d, c);
      }
    }
    triangle([x0, y0, -0.5], [x1, y1, 0.5], [x0, y0, 0.5]);
    triangle([x0, y0, -0.5], [x1, y1, -0.5], [x1, y1, 0.5]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
};

import { createChinesePanCoverRoof } from "./chinese-pan-cover-roof";
import { createMayaThatchRoof } from "./maya-thatch-roof";
import { clipPersianVaultRoof } from "./persian-vault-roof-plan";

type RoofProfile = BuildingPart["occupationRoof"];
type GridPoint = (x: number, t: number, lift?: number) => Vector3;
type SurfacePoint = (x: number, z: number, lift?: number) => Vector3;
interface RoofCell { t0: number; t1: number; x0: number; x1: number }

const HIP_COLUMNS_HIGH = [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];
const HIP_COLUMNS_MINIMAL = [-0.5, -HIP_RIDGE_END, HIP_RIDGE_END, 0.5];
const CAP_EDGE_LIFT = 0.03;
const CAP_HALF_WIDTH = 0.03;
const CAP_TOP_LIFT = 0.065;
const CHANNEL_LIFT = 0.026;
const LAP_DROP = new Vector3(0, -0.025, 0);
const UNDERSIDE_DROP = new Vector3(0, -0.06, 0);

/**
 * |x| where a hip line reaches the roof end: the corner on a hip roof; on a half-hip, the clipped
 * gable below it continues the side pitches to the end.
 */
const getHipReach = (profile: RoofProfile) => ((0.5 - HIP_RIDGE_END) * getEndSlope(profile)) / ACROSS_SLOPE;

/** The hip line, where the side and end pitches meet (|z| = 0.3 + 0.4 |x| on a hip roof). */
const getHipLineZ = (profile: RoofProfile, x: number) =>
  Math.min(0.5, HIP_RIDGE_END + (Math.abs(x) * ACROSS_SLOPE) / getEndSlope(profile));

/**
 * Maps a hipped roof column onto its plan position so the ridge ends and hip lines run along grid
 * edges. Every cell then lies on one plane: no folded quads, gaps or flat eave triangles.
 */
const warpHipColumn = (profile: RoofProfile, x: number, t: number) => {
  const hip = getHipLineZ(profile, x),
    along = Math.abs(t);
  if (along <= HIP_RIDGE_END) return (t * hip) / HIP_RIDGE_END;
  const endShare = (along - HIP_RIDGE_END) / (0.5 - HIP_RIDGE_END);
  return Math.sign(t) * (hip + endShare * (0.5 - hip));
};

const getRoofCoordinates = (part: BuildingPart, count: number) => {
  const values = Array.from({ length: count + 1 }, (_, index) => index / count - 0.5);
  if (!part.roofOculus) return values;
  return [...new Set([...values.filter((value) => Math.abs(value) >= 0.06), -0.06, 0.06])].sort(
    (a, b) => a - b
  );
};

const getRowCount = (part: BuildingPart, detailed: boolean) => {
  if (part.occupationRoof === "barrel" && part.radialSegments !== undefined)
    return Math.max(2, Math.min(32, Math.round(part.radialSegments)));
  if (detailed) return 8;
  return part.occupationRoof === "barrel" ? 4 : 2;
};

/**
 * Rows across the slope. A half-hip needs rows where its hip lines meet the clipped gable: High
 * moves its nearest rows there (same triangle budget), Minimal adds them.
 */
const getRoofRows = (part: BuildingPart, detailed: boolean) => {
  const rows = getRoofCoordinates(part, getRowCount(part, detailed));
  if (part.occupationRoof !== "half-hip") return rows;
  const reach = getHipReach(part.occupationRoof);
  const inner = rows.filter(row => row > 0 && row < 0.5);
  const nearest = inner.reduce((best, row) => (Math.abs(row - reach) < Math.abs(best - reach) ? row : best),
    inner[0] ?? reach);
  const kept = detailed ? rows.filter(row => Math.abs(row) !== nearest) : rows;
  return [...kept, -reach, reach].sort((a, b) => a - b);
};

const getRoofColumns = (part: BuildingPart, detailed: boolean) => {
  if (!isHippedOccupationRoof(part.occupationRoof)) return getRoofCoordinates(part, detailed ? 10 : 2);
  return detailed ? HIP_COLUMNS_HIGH : HIP_COLUMNS_MINIMAL;
};

const createRoofShellWriter = (part: BuildingPart) => {
  const positions: number[] = [],
    uvs: number[] = [],
    colors: number[] = [];
  let brightness = 1;
  const vertex = (point: Vector3) => {
    positions.push(point.x, point.y, point.z);
    colors.push(brightness, brightness, brightness);
    // Clay channels follow the roof slope; texture density is independent of building size.
    uvs.push((point.z + 0.5) * part.size[2], (point.x + 0.5) * part.size[0]);
  };
  const triangle = (a: Vector3, b: Vector3, c: Vector3) => {
    vertex(a);
    vertex(b);
    vertex(c);
  };
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
    triangle(a, c, b);
    triangle(a, d, c);
  };
  /** A quad whose visible face points up, whatever order its corners were listed in. */
  const upwardQuad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
    const normal = c.clone().sub(a).cross(b.clone().sub(a));
    if (normal.y >= 0) quad(a, b, c, d);
    else quad(a, d, c, b);
  };
  const finish = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  const setBrightness = (value: number) => {
    brightness = value;
  };
  return { finish, quad, setBrightness, upwardQuad };
};
type RoofShellWriter = ReturnType<typeof createRoofShellWriter>;

/**
 * Three rounded strips per pottery channel. Channels run down their own pitch: across the cell on
 * the side pitches and along it on the steep hip ends.
 */
const addChannelStrips = (
  writer: RoofShellWriter,
  gridPoint: GridPoint,
  { t0, t1, x0, x1 }: RoofCell,
  hipEnd: boolean,
  roundedTiles = false
) => {
  const strips = roundedTiles ? 5 : 3;
  const lift = roundedTiles ? .065 : CHANNEL_LIFT;
  for (let strip = 0; strip < strips; strip++) {
    const start = strip / strips,
      end = (strip + 1) / strips;
    const startLift = lift * Math.sin(start * Math.PI),
      endLift = lift * Math.sin(end * Math.PI);
    if (hipEnd) {
      const xStart = x0 + (x1 - x0) * start,
        xEnd = x0 + (x1 - x0) * end;
      writer.quad(
        gridPoint(xStart, t0, startLift),
        gridPoint(xEnd, t0, endLift),
        gridPoint(xEnd, t1, endLift),
        gridPoint(xStart, t1, startLift)
      );
      continue;
    }
    const tStart = t0 + (t1 - t0) * start,
      tEnd = t0 + (t1 - t0) * end;
    writer.quad(
      gridPoint(x0, tStart, startLift),
      gridPoint(x1, tStart, startLift),
      gridPoint(x1, tEnd, endLift),
      gridPoint(x0, tEnd, endLift)
    );
  }
};

/** The exposed downhill lap separates pottery courses without an open seam. */
const addDownhillLap = (
  writer: RoofShellWriter,
  [a, b, c, d]: [Vector3, Vector3, Vector3, Vector3],
  { t0, t1, x0, x1 }: RoofCell,
  hipEnd: boolean
) => {
  const lower = (point: Vector3) => point.clone().add(LAP_DROP);
  if (hipEnd && t0 + t1 > 0) writer.quad(c, lower(c), lower(d), d);
  else if (hipEnd) writer.quad(a, lower(a), lower(b), b);
  else if (x0 + x1 < 0) writer.quad(a, d, lower(d), lower(a));
  else writer.quad(b, lower(b), lower(c), c);
};

/** A rounded capping course: a low tent of tiles straddling a ridge or hip line. */
const addCapCourse = (
  writer: RoofShellWriter,
  surfacePoint: SurfacePoint,
  from: [number, number],
  to: [number, number]
) => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const offsetX = (-(to[1] - from[1]) / length) * CAP_HALF_WIDTH,
    offsetZ = ((to[0] - from[0]) / length) * CAP_HALF_WIDTH;
  const edge = ([x, z]: [number, number], side: number) =>
    surfacePoint(x + side * offsetX, z + side * offsetZ, CAP_EDGE_LIFT);
  const top = ([x, z]: [number, number]) => surfacePoint(x, z, CAP_TOP_LIFT);
  for (const side of [-1, 1])
    writer.upwardQuad(edge(from, side), edge(to, side), top(to), top(from));
};

/** High hip roofs cap their ridge and four hips, covering the turn of the pottery channels. */
const addHipCaps = (writer: RoofShellWriter, surfacePoint: SurfacePoint, reach: number) => {
  writer.setBrightness(0.9);
  addCapCourse(writer, surfacePoint, [0, -HIP_RIDGE_END], [0, HIP_RIDGE_END]);
  for (const end of [-1, 1])
    for (const side of [-1, 1])
      addCapCourse(writer, surfacePoint, [0, end * HIP_RIDGE_END], [side * reach, end * 0.5]);
};

interface ShellEdges { firstColumn: boolean; firstRow: boolean; lastColumn: boolean; lastRow: boolean }

/** Underside faces point down; the outer cells close the shell edge between both layers. */
const addUnderside = (
  writer: RoofShellWriter,
  corners: [Vector3, Vector3, Vector3, Vector3],
  { firstColumn, firstRow, lastColumn, lastRow }: ShellEdges
) => {
  const [a, b, c, d] = corners;
  const [belowA, belowB, belowC, belowD] = corners.map((point) => point.clone().add(UNDERSIDE_DROP)) as
    [Vector3, Vector3, Vector3, Vector3];
  writer.quad(belowD, belowC, belowB, belowA);
  if (firstRow) writer.quad(a, d, belowD, belowA);
  if (lastRow) writer.quad(b, belowB, belowC, c);
  if (firstColumn) writer.quad(a, belowA, belowB, b);
  if (lastColumn) writer.quad(d, c, belowC, belowD);
};

/** Closed clay shells; High adds rounded, aligned pottery channels to the same silhouette. */
export const createRomanOccupationRoof = (part: BuildingPart, detailed: boolean) => {
  if (part.plantRoofStyle || part.surface === "straw") return createMayaThatchRoof(part, detailed);
  if (part.roofTiles === "pan-cover") return createChinesePanCoverRoof(part, detailed);
  const writer = createRoofShellWriter(part);
  const profile = part.occupationRoof, hip = isHippedOccupationRoof(profile);
  const roundedTiles = part.roofSweep !== undefined;
  const channelled = detailed && (part.surface === "roof" || (roundedTiles && part.surface === "roof-slate"));
  const xs = getRoofRows(part, detailed),
    ts = getRoofColumns(part, detailed);
  const surfacePoint: SurfacePoint = (x, z, lift = 0) =>
    new Vector3(x, getOccupationRoofHeight(profile, x, z, part.roofSweep, part.roofCurve) + lift, z);
  const gridPoint: GridPoint = (x, t, lift = 0) =>
    surfacePoint(x, hip ? warpHipColumn(profile, x, t) : t, lift);
  for (let row = 0; row < xs.length - 1; row++)
    for (let column = 0; column < ts.length - 1; column++) {
      writer.setBrightness(0.93 + ((row * 13 + column * 17) % 11) * 0.006);
      const cell: RoofCell = { t0: ts[column]!, t1: ts[column + 1]!, x0: xs[row]!, x1: xs[row + 1]! };
      const { t0, t1, x0, x1 } = cell;
      if (part.roofOculus && Math.abs((x0 + x1) / 2) < 0.06 && Math.abs((t0 + t1) / 2) < 0.06)
        continue;
      const hipEnd = hip && Math.abs((t0 + t1) / 2) > HIP_RIDGE_END;
      const corners: [Vector3, Vector3, Vector3, Vector3] =
        [gridPoint(x0, t0), gridPoint(x1, t0), gridPoint(x1, t1), gridPoint(x0, t1)];
      const [a, b, c, d] = corners;
      if (channelled) addChannelStrips(writer, gridPoint, cell, hipEnd, roundedTiles);
      else writer.quad(a, b, c, d);
      if (detailed) addDownhillLap(writer, corners, cell, hipEnd);
      addUnderside(writer, corners, { firstColumn: column === 0, firstRow: row === 0,
        lastColumn: column === ts.length - 2, lastRow: row === xs.length - 2 });
    }
  if (hip && channelled) addHipCaps(writer, surfacePoint, getHipReach(profile));
  const geometry = writer.finish();
  return part.persianRoofPlan ? clipPersianVaultRoof(geometry, part, detailed) : geometry;
};
