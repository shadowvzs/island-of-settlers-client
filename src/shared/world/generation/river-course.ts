import type { GridSize } from "../grid-geometry";
import { smoothstep } from "../noise";
import type { Random } from "../rng";
import {
  averagePath,
  getCurvatures,
  resamplePath,
  type RiverPoint,
  SAMPLE_SPACING,
  smoothPath} from "./river-line";
import { applyMeanders, type MeanderTerrain } from "./river-meanders";

/** How far (cells) the channel runs on into the sea: the open mouth. */
const MOUTH_SEA_REACH = 3;
/** Direction of the last stretch (cells), continued into the sea. */
const MOUTH_HEADING_LENGTH = 4;
/** Moving average window (samples) at the source; it shrinks to none over the upper course. */
const UPPER_STRAIGHTENING = 24;
/** Share of the course (from the source) counted as the steep, straight upper course. */
const UPPER_COURSE = 0.6;
const STRAIGHTENING_PASSES = 2;
/** Bends sharper than this (1 / cells, over 2 cells each side) are relaxed. */
const MAX_CURVATURE = 0.42;
const RELAX_CURVATURE_REACH = 4;
const RELAX_REACH = 3;
const RELAX_PASSES = 12;

export interface RiverCourse {
  /** First sample on the coastline: from here the channel is the open mouth (sea level). */
  mouthStep: number;
  /** Evenly spaced centreline samples (SAMPLE_SPACING), source first, ending out in the sea. */
  points: RiverPoint[];
}

/** Centred moving average whose window shrinks downstream (ends pinned). */
const straightenSample = (points: RiverPoint[], index: number) => {
  const t = index / (points.length - 1);
  const window = Math.round(UPPER_STRAIGHTENING * (1 - smoothstep(0, UPPER_COURSE, t)));
  const reach = Math.min(window, index, points.length - 1 - index);
  let x = 0;
  let z = 0;
  for (let other = index - reach; other <= index + reach; other += 1) {
    x += points[other]!.x;
    z += points[other]!.z;
  }
  return { x: x / (reach * 2 + 1), z: z / (reach * 2 + 1) };
};

/** The steep upper course runs straighter: it ignores the small turns of the traced path. */
const straightenUpperCourse = (points: RiverPoint[]) => {
  let current = points;
  for (let pass = 0; pass < STRAIGHTENING_PASSES; pass += 1) {
    const source = current;
    current = source.map((_, index) => straightenSample(source, index));
  }
  return current;
};

/** The traced vertex path as a smooth, evenly sampled line. */
const toBaseLine = (grid: GridSize, path: number[]) => {
  const stride = grid.cellsX + 1;
  const vertices = path.map((index) => ({ x: index % stride, z: Math.floor(index / stride) }));
  return straightenUpperCourse(resamplePath(smoothPath(averagePath(vertices))));
};

/** Moves a sample towards the mean of its neighbours (a local Laplacian step). */
const relaxSample = (points: RiverPoint[], index: number) => {
  let x = 0;
  let z = 0;
  for (let other = index - RELAX_REACH; other <= index + RELAX_REACH; other += 1) {
    x += points[other]!.x;
    z += points[other]!.z;
  }
  const count = RELAX_REACH * 2 + 1;
  return { x: x / count, z: z / count };
};

/** Rounds off the bends still sharper than the limit (tight turns of the traced valley). */
const relaxSharpBends = (points: RiverPoint[]) => {
  let current = points;
  for (let pass = 0; pass < RELAX_PASSES; pass += 1) {
    const curvatures = getCurvatures(current, RELAX_CURVATURE_REACH);
    const source = current;
    let changed = false;
    current = source.map((point, index) => {
      const isInside = index >= RELAX_REACH && index < source.length - RELAX_REACH;
      if (!isInside || Math.abs(curvatures[index]!) <= MAX_CURVATURE) return point;
      changed = true;
      return relaxSample(source, index);
    });
    if (!changed) break;
  }
  return resamplePath(current);
};

/** Continues the last stretch straight out into the sea: the channel opens into it. */
const extendIntoSea = (points: RiverPoint[]) => {
  const last = points[points.length - 1]!;
  const back = Math.min(points.length - 1, Math.round(MOUTH_HEADING_LENGTH / SAMPLE_SPACING));
  const from = points[points.length - 1 - back]!;
  const length = Math.hypot(last.x - from.x, last.z - from.z) || 1;
  const directionX = (last.x - from.x) / length;
  const directionZ = (last.z - from.z) / length;
  const extension: RiverPoint[] = [];
  for (let along = SAMPLE_SPACING; along <= MOUTH_SEA_REACH; along += SAMPLE_SPACING) {
    extension.push({ x: last.x + directionX * along, z: last.z + directionZ * along });
  }
  return { mouthStep: points.length - 1, points: [...points, ...extension] };
};

/**
 * The river course from a traced vertex path (source to the first sea vertex): a smoothed
 * centreline with irregular meanders growing downstream, opening on into the sea.
 */
export const createRiverCourse = (
  grid: GridSize,
  path: number[],
  terrain: MeanderTerrain,
  random: Random
): RiverCourse => {
  const meandering = applyMeanders(grid, toBaseLine(grid, path), terrain, random);
  return extendIntoSea(relaxSharpBends(resamplePath(meandering)));
};
