import { type GridSize,sampleBilinear } from "../grid-geometry";
import { clamp, createFbm, lerp, type Noise2,smoothstep } from "../noise";
import type { Random } from "../rng";
import { type RiverPoint,SAMPLE_SPACING } from "./river-line";

/** Largest sideways swing (cells) of a lowland meander: rivers stay at gameplay scale. */
const MAX_AMPLITUDE = 3.5;
/** Tightest centreline bend radius (cells): no sharp corners. */
const MIN_BEND_RADIUS = 2.5;
/** Bend wavelength range (cells): short, tight bends mixed with long, lazy ones. */
const SHORT_WAVELENGTH = 15;
const LONG_WAVELENGTH = 42;
/** Slow sideways drift (cells): left and right bends differ, no symmetric rhythm. */
const DRIFT_AMPLITUDE = 1.1;
/** Ground heights over which the meanders fade out uphill (steep, straight upper course). */
const LOWLAND_TOP = 1.4;
const UPLAND = 3.4;
/** Share of the course (from the source) before the meanders start and reach full size. */
const MEANDER_START = 0.08;
const MEANDER_FULL = 0.8;
/** Samples on each side for the local direction of the base line. */
const TANGENT_REACH = 6;
const OFFSET_SMOOTHING_RADIUS = 4;

/** What the meanders need to know of the terrain around the course. */
export interface MeanderTerrain {
  heights: Float32Array;
  /** Room (cells) for a sideways swing at a position: map border, start, sea, other rivers. */
  room: (x: number, z: number) => number;
}

interface MeanderNoises {
  drift: Noise2;
  openness: Noise2;
  rhythm: Noise2;
}

const createNoises = (random: Random): MeanderNoises => {
  const nextSeed = () => Math.floor(random() * 2 ** 31);
  return {
    drift: createFbm(nextSeed(), { octaves: 2 }),
    openness: createFbm(nextSeed(), { octaves: 2 }),
    rhythm: createFbm(nextSeed(), { octaves: 2 })
  };
};

/** Left hand normal of the base line, from its direction over a few cells. */
const getNormals = (points: RiverPoint[]) =>
  points.map((_, index) => {
    const from = points[Math.max(0, index - TANGENT_REACH)]!;
    const to = points[Math.min(points.length - 1, index + TANGENT_REACH)]!;
    const length = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    return { x: -(to.z - from.z) / length, z: (to.x - from.x) / length };
  });

/** 0 near the source and in the hills, 1 in the lowland of the lower course. */
const getMeanderGrowth = (grid: GridSize, heights: Float32Array, point: RiverPoint, t: number) => {
  const ground = sampleBilinear(grid, heights, point.x, point.z);
  return smoothstep(MEANDER_START, MEANDER_FULL, t) * (1 - smoothstep(LOWLAND_TOP, UPLAND, ground));
};

/** Bend wavelength (cells) at a distance along the course: varies bend to bend. */
const getWavelength = (noises: MeanderNoises, along: number) =>
  lerp(SHORT_WAVELENGTH, LONG_WAVELENGTH, smoothstep(-0.4, 0.4, noises.rhythm(along / 30, 0.5)));

/** Amplitude limited so the bend radius stays above the minimum (sine offset curvature). */
const getAmplitude = (noises: MeanderNoises, along: number, growth: number, wavelength: number) => {
  const openness = smoothstep(-0.5, 0.2, noises.openness(along / 45, 3.7));
  const bendLimit = (wavelength / (2 * Math.PI)) ** 2 / MIN_BEND_RADIUS;
  return Math.min(MAX_AMPLITUDE * growth * openness, bendLimit);
};

/** Moving average of the offsets: rounds off where the room clamps a swing. */
const smoothOffsets = (offsets: number[]) =>
  offsets.map((_, index) => {
    const from = Math.max(0, index - OFFSET_SMOOTHING_RADIUS);
    const to = Math.min(offsets.length - 1, index + OFFSET_SMOOTHING_RADIUS);
    let sum = 0;
    for (let other = from; other <= to; other += 1) sum += offsets[other]!;
    return sum / (to - from + 1);
  });

/** Sideways offset per sample: a sine of varying wavelength and amplitude plus a slow drift. */
const createOffsets = (
  grid: GridSize,
  points: RiverPoint[],
  terrain: MeanderTerrain,
  random: Random
) => {
  const noises = createNoises(random);
  const offsets: number[] = [];
  let phase = random() * Math.PI * 2;
  points.forEach((point, index) => {
    const along = index * SAMPLE_SPACING;
    const growth = getMeanderGrowth(grid, terrain.heights, point, index / (points.length - 1));
    const wavelength = getWavelength(noises, along);
    phase += (2 * Math.PI * SAMPLE_SPACING) / wavelength;
    const swing = getAmplitude(noises, along, growth, wavelength) * Math.sin(phase);
    const drift = DRIFT_AMPLITUDE * growth * noises.drift(along / 60, 9.1);
    const room = Math.max(0, terrain.room(point.x, point.z));
    offsets.push(clamp(swing + drift, -room, room));
  });
  return smoothOffsets(smoothOffsets(offsets));
};

/**
 * Bends the smooth base line into irregular meanders: straight and steep near the source,
 * growing lazier downstream, kept inside the room the terrain leaves.
 */
export const applyMeanders = (
  grid: GridSize,
  points: RiverPoint[],
  terrain: MeanderTerrain,
  random: Random
) => {
  if (points.length < 3) return points;
  const normals = getNormals(points);
  const offsets = createOffsets(grid, points, terrain, random);
  return points.map((point, index) => ({
    x: point.x + normals[index]!.x * offsets[index]!,
    z: point.z + normals[index]!.z * offsets[index]!
  }));
};
