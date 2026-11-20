import { getVertexCount, type GridSize } from "../grid-geometry";
import { lerp, smoothstep } from "../noise";
import type { Waterfall } from "../world-data";
import type { RiverCourse } from "./river-course";
import { carvePlungePool, findWaterfalls, raiseLipBanks } from "./river-falls";
import { getCurvatures, getMouthDistance, MOUTH_LENGTH } from "./river-line";
import { createRiverProfile } from "./river-profile";

const BED_DEPTH = 0.55;
const BANK_WIDTH = 3;
const BANK_SLOPE = 0.35;
/** Gorge walls: steep banks, and a channel narrower by this share (steep ground). */
const GORGE_BANK_SLOPE = 1.4;
const GORGE_NARROWING = 0.3;
const LEVEE_WIDTH = 1.5;
/** Bed radius (cells, times the theme width) at the source, and its growth down to the coast. */
export const SOURCE_RADIUS = 0.75;
export const RADIUS_GROWTH = 1;
/** Outer bank widening per unit of bend curvature, capped (share of the radius). */
const BEND_WIDENING = 1.2;
export const MAX_BEND_WIDENING = 0.3;
/** The inner bank (point bar) narrows by this share of the outer widening. */
const INNER_BEND_SHARE = 0.4;
/** Extra mouth width (share of the river radius) where the channel meets the sea. */
export const MOUTH_FLARE = 0.8;
/** Samples on each side for the bend curvature. */
export const CURVATURE_REACH = 3;

/** A carved river: its course plus the per sample bed radius, curvature and water level. */
export interface CarvedRiver extends RiverCourse {
  /** Signed centreline curvature per sample (1 / cells, positive turning left). */
  curvature: Float32Array;
  /** Optional measured cross-section depth for explicitly adopted baked channels. */
  bedDepth?: Float32Array;
  replaceBed?: boolean;
  /** Gorge strength 0..1 per sample (steep ground): narrower bed, steep walls. */
  gorge: Float32Array;
  /** Water level per sample. */
  profile: Float32Array;
  /** Bed radius per sample (cells) before the bend widening. */
  radius: Float32Array;
}

export interface RiverLayers {
  courses: CarvedRiver[];
  flow: Float32Array;
  /** 1 where the vertex is inside a river bed. */
  mask: Uint8Array;
  /** River water surface height, NaN where no river. */
  surface: Float32Array;
  waterfalls: Waterfall[];
}

/**
 * Bed radius per sample (theme width at the sample): grows downstream and flares into an
 * estuary funnel over the last cells to the coast.
 */
export const getBedRadius = (step: number, mouthStep: number, width: number) => {
  const downstream = Math.min(1, step / mouthStep);
  const mouthDistance = getMouthDistance(step, mouthStep);
  const flare = 1 + MOUTH_FLARE * (1 - smoothstep(0, MOUTH_LENGTH, mouthDistance));
  return (SOURCE_RADIUS + RADIUS_GROWTH * downstream) * width * flare;
};

export const prepareCarvedRiver = (
  grid: GridSize,
  heights: Float32Array,
  course: RiverCourse,
  context: { seaLevel: number; widthAt: RiverWidth }
): CarvedRiver => {
  const { gorge, level } = createRiverProfile(grid, heights, course, context.seaLevel);
  return {
    ...course,
    curvature: getCurvatures(course.points, CURVATURE_REACH),
    gorge,
    profile: level,
    radius: Float32Array.from(course.points, (point, step) => {
      const radius = getBedRadius(step, course.mouthStep, context.widthAt(point.x, point.z, step));
      return radius * (1 - GORGE_NARROWING * gorge[step]!);
    })
  };
};

/**
 * Bed radius towards a vertex: wider on the outer side of a bend (the current cuts the bank),
 * a little narrower on the inner side.
 */
const getBankRadius = (river: CarvedRiver, step: number, vertexX: number, vertexZ: number) => {
  const { curvature, points, radius } = river;
  const before = points[Math.max(0, step - 1)]!;
  const after = points[Math.min(points.length - 1, step + 1)]!;
  const point = points[step]!;
  const side =
    (after.x - before.x) * (vertexZ - point.z) - (after.z - before.z) * (vertexX - point.x);
  const bend = curvature[step]!;
  const widening = Math.min(MAX_BEND_WIDENING, Math.abs(bend) * BEND_WIDENING);
  const isOuterBank = side * bend < 0;
  return radius[step]! * (isOuterBank ? 1 + widening : 1 - widening * INNER_BEND_SHARE);
};

interface NearestPoints {
  distance: Float32Array;
  step: Int32Array;
}

/** Target ground height at a distance from the river centre line (gorges: steep walls). */
const getCarveTarget = (distance: number, level: number, radius: number, gorge: number, depth = BED_DEPTH) => {
  if (distance <= radius) return level - 0.1 - depth * (1 - (distance / radius) ** 2);
  return level + 0.05 + (distance - radius) * lerp(BANK_SLOPE, GORGE_BANK_SLOPE, gorge);
};

/** For every vertex near the river: the closest course sample and its distance. */
const findNearestPoints = (grid: GridSize, river: CarvedRiver): NearestPoints => {
  const count = getVertexCount(grid);
  const nearest: NearestPoints = {
    distance: new Float32Array(count).fill(Infinity),
    step: new Int32Array(count).fill(-1)
  };
  const stride = grid.cellsX + 1;
  river.points.forEach((point, step) => {
    const reach = river.radius[step]! * (1 + MAX_BEND_WIDENING) + BANK_WIDTH;
    for (
      let vertexZ = Math.max(0, Math.ceil(point.z - reach));
      vertexZ <= Math.min(grid.cellsZ, point.z + reach);
      vertexZ += 1
    ) {
      for (
        let vertexX = Math.max(0, Math.ceil(point.x - reach));
        vertexX <= Math.min(grid.cellsX, point.x + reach);
        vertexX += 1
      ) {
        const distance = Math.hypot(vertexX - point.x, vertexZ - point.z);
        const index = vertexZ * stride + vertexX;
        if (distance >= nearest.distance[index]!) continue;
        nearest.distance[index] = distance;
        nearest.step[index] = step;
      }
    }
  });
  return nearest;
};

/** River width factor at a position (the local theme's: narrower desert rivers). */
export type RiverWidth = (x: number, z: number, step?: number) => number;

const writeFlow = (flow: Float32Array, index: number, river: CarvedRiver, step: number) => {
  const { points, profile } = river;
  const next = points[Math.min(points.length - 1, step + 1)]!;
  const current = points[Math.max(0, Math.min(step, points.length - 2))]!;
  const directionX = next.x - current.x;
  const directionZ = next.z - current.z;
  const length = Math.hypot(directionX, directionZ) || 1;
  const ahead = profile[Math.min(points.length - 1, step + 6)]!;
  const speed = 0.6 + Math.min(2, (profile[step]! - ahead) * 2);
  flow[index * 2] = (directionX / length) * speed;
  flow[index * 2 + 1] = (directionZ / length) * speed;
};

/**
 * Carves one river into the heights: bed and banks, plus a levee holding the water above the
 * ground beside it. The estuary gets no levee: it opens into the sea without a bar.
 */
const carveRiver = (
  grid: GridSize,
  heights: Float32Array,
  river: CarvedRiver,
  layers: RiverLayers
) => {
  const { flow, mask, surface } = layers;
  const nearest = findNearestPoints(grid, river);
  const stride = grid.cellsX + 1;
  for (let index = 0; index < heights.length; index += 1) {
    const step = nearest.step[index]!;
    if (step < 0) continue;
    const distance = nearest.distance[index]!;
    const radius = getBankRadius(river, step, index % stride, Math.floor(index / stride));
    if (distance > radius + BANK_WIDTH) continue;
    const level = river.profile[step]!;
    const target = getCarveTarget(distance, level, radius, river.gorge[step]!, river.bedDepth?.[step]);
    heights[index] = river.replaceBed && distance <= radius ? target : Math.min(heights[index]!, target);
    if (distance <= radius) mask[index] = 1;
    if (distance > radius + LEVEE_WIDTH) continue;
    const isEstuary = getMouthDistance(step, river.mouthStep) < MOUTH_LENGTH;
    if (distance > radius && !isEstuary) heights[index] = Math.max(heights[index]!, level + 0.04);
    surface[index] = level;
    writeFlow(flow, index, river, step);
  }
};

/** Optional sparse-provenance capture; observers must not mutate the live carve layers. */
export interface RiverCarvingObserver {
  before: (river: CarvedRiver, layers: RiverLayers) => void;
  after: (river: CarvedRiver, falls: Waterfall[], layers: RiverLayers) => void;
}

const createRiverLayers = (grid: GridSize): RiverLayers => {
  const count = getVertexCount(grid);
  return {
    courses: [],
    flow: new Float32Array(count * 2),
    mask: new Uint8Array(count),
    surface: new Float32Array(count).fill(Number.NaN),
    waterfalls: []
  };
};

const appendCarvedRiver = (
  grid: GridSize,
  heights: Float32Array,
  river: CarvedRiver,
  layers: RiverLayers
) => {
  const waterfalls = findWaterfalls(river);
  layers.courses.push(river);
  layers.waterfalls.push(...waterfalls);
  carveRiver(grid, heights, river, layers);
  for (const fall of waterfalls) carvePlungePool(grid, heights, fall, layers);
  for (const fall of waterfalls) raiseLipBanks(grid, heights, fall, layers);
  return waterfalls;
};

/** Reuse exact captured profiles/radii without re-smoothing or resampling a generated course. */
export const carvePreparedRiver = (grid: GridSize, heights: Float32Array, river: CarvedRiver) => {
  const layers = createRiverLayers(grid);
  appendCarvedRiver(grid, heights, river, layers);
  return layers;
};

/** Native generation geometry is unchanged when sparse provenance capture is enabled. */
export const carveRivers = (
  grid: GridSize,
  heights: Float32Array,
  courses: RiverCourse[],
  seaLevel: number,
  widthAt: RiverWidth,
  observer?: RiverCarvingObserver
): RiverLayers => {
  const layers = createRiverLayers(grid);
  for (const course of courses) {
    const river = prepareCarvedRiver(grid, heights, course, { seaLevel, widthAt });
    observer?.before(river, layers);
    const falls = appendCarvedRiver(grid, heights, river, layers);
    observer?.after(river, falls, layers);
  }
  return layers;
};
