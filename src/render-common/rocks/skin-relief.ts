import {
  createFbm,
  createPermutation,
  createRidgedNoise,
  type Noise2,
  smoothstep} from "../../shared/world/noise";
import { deriveSeed } from "../../shared/world/rng";
import { getGradient, type RockTerrain } from "./rock-terrain";
import { createPlates } from "./skin-plates";

/** Height of one strata layer on gentle slopes. */
const STRATA = 0.85;
/** Height of one strata bed on walls (thick beds read at gameplay distance). */
const WALL_STRATA = 1.3;
/** Slope (rise per run) where the skin starts to be a wall, and where it is fully one. */
const WALL_SLOPE: [number, number] = [1.1, 2.4];
/** Column (vertical joint) spacing on walls and talus stone size at the foot, world units. */
const COLUMN = 2.1;
const TALUS_STONE = 0.55;
/** How far uphill the foot probe looks for the wall above. */
const FOOT_PROBE = 1.2;

/** 0 slope .. 1 wall: where columns, beds and buttresses take over from the plates. */
export const getWallFactor = (slope: number) => smoothstep(WALL_SLOPE[0], WALL_SLOPE[1], slope);

interface Cell {
  /** Distance to the nearest cell centre minus the second nearest (joint proximity). */
  edge: number;
  /** 0..1 hash of the nearest cell. */
  hash: number;
  /** Distance to the nearest centre in cell sizes (dome of a stone). */
  nearest: number;
}

/**
 * 2D Voronoi cells in xz. A wall spans little ground, so a cell crossing it is a vertical prism:
 * the cell borders are the vertical joints and every cell is one column of rock.
 */
const createCells = (seed: number, size: number) => {
  const permutation = createPermutation(seed);
  const hash = (x: number, z: number) =>
    permutation[(permutation[x & 255]! + (z & 255)) & 255]! / 255;
  return (x: number, z: number): Cell => {
    const cellX = Math.floor(x / size);
    const cellZ = Math.floor(z / size);
    let nearest = Infinity;
    let second = Infinity;
    let best = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const idX = cellX + dx;
        const idZ = cellZ + dz;
        const offsetX = x - (idX + 0.15 + hash(idX, idZ) * 0.7) * size;
        const offsetZ = z - (idZ + 0.15 + hash(idZ + 13, idX + 7) * 0.7) * size;
        const squared = offsetX * offsetX + offsetZ * offsetZ;
        if (squared < nearest) {
          second = nearest;
          nearest = squared;
          best = hash(idX + 29, idZ + 3);
        } else if (squared < second) second = squared;
      }
    }
    return {
      edge: Math.sqrt(second) - Math.sqrt(nearest),
      hash: best,
      nearest: Math.sqrt(nearest) / size
    };
  };
};

export interface SkinFields {
  /** Low frequency bulges: buttresses and recessed bays along a wall. */
  buttresses: Noise2;
  columns: ReturnType<typeof createCells>;
  /** Ridged noise: its crests are the erosion channels cut down the slopes. */
  gullies: Noise2;
  /** Per bed 0..1 standing-out depth (a hash of the bed index and the column). */
  layerDepth: (layer: number, column: number) => number;
  plates: ReturnType<typeof createPlates>;
  stones: ReturnType<typeof createCells>;
}

/** The erosion channel field of a seed (ridged noise; see getGullyShare). */
export const createGullyNoise = (seed: number) =>
  createRidgedNoise(deriveSeed(seed, "rock-gullies"), 2);

/** 0 .. 1 inside an erosion channel cut down the rock (the skin's gullies, talus below them). */
export const getGullyShare = (gullies: Noise2, x: number, z: number) =>
  smoothstep(0.72, 0.95, gullies(x * 0.18, z * 0.18));

export const createSkinFields = (seed: number): SkinFields => {
  const permutation = createPermutation(deriveSeed(seed, "rock-beds"));
  const layerHash = (value: number) => permutation[value & 255]! / 255;
  return {
    buttresses: createFbm(deriveSeed(seed, "rock-buttresses"), { octaves: 2 }),
    columns: createCells(deriveSeed(seed, "rock-columns"), COLUMN),
    gullies: createGullyNoise(seed),
    layerDepth: (layer, column) =>
      layerHash(layer) * 0.7 + layerHash(layer + Math.floor(column * 97)) * 0.3,
    plates: createPlates(seed),
    stones: createCells(deriveSeed(seed, "rock-talus"), TALUS_STONE)
  };
};

/** Strata ledges of gentle slopes: the offset steps with height, each layer slightly wavy. */
export const getStrataStep = (y: number, x: number, z: number) => {
  const layer = (y + Math.sin(x * 0.21) * 0.3 + Math.sin(z * 0.17) * 0.3) / STRATA;
  const within = layer - Math.floor(layer);
  return smoothstep(0.75, 0.95, within) * -0.18 + within * 0.12;
};

/** Tessellation rows per strata bed: a bed step spans exactly one row band (straight ledges). */
const BED_ROWS = 3;
/** Height of one tessellation row on walls. */
export const WALL_ROW = WALL_STRATA / BED_ROWS;

/**
 * Wall level of a ground point: its integer levels are the skin's rows up steep faces and every
 * third one a bedding plane. Beds dip and warp gently, so they never read as ruled lines.
 */
export const getWallLevel = (x: number, y: number, z: number) => {
  const warp = Math.sin(x * 0.13 + z * 0.05) * 0.3 + Math.sin(z * 0.11 - x * 0.04) * 0.3;
  return (y + warp + x * 0.04) / WALL_ROW;
};

interface Bed {
  index: number;
  /** 0 at the bed's base .. 1 at its top. */
  within: number;
}

const getBed = (level: number): Bed => {
  const index = Math.floor(level / BED_ROWS);
  return { index, within: level / BED_ROWS - index };
};

/**
 * Outward offset of a bed: each bed stands out by its own depth and swells towards its top, then
 * the next bed starts recessed (a shelf: the lower bed's top faces up) or further out (an
 * overhanging lip).
 */
const getBedOffset = (fields: SkinFields, { index, within }: Bed, column: number) => {
  const body = fields.layerDepth(index, column) * (0.45 + 0.55 * smoothstep(0.05, 0.7, within));
  const nextStart = fields.layerDepth(index + 1, column) * 0.45;
  return (body + (nextStart - body) * smoothstep(2 / 3, 1, within)) * 0.55;
};

export interface WallForms {
  /** 0 open face .. 1 inside a vertical joint between columns. */
  joint: number;
  /** Outward offset of the wall forms (always >= 0). */
  offset: number;
}

/**
 * Large wall forms first: buttresses and bays, columns split by vertical joints, strata beds
 * with shallow, locally eroded shelves. Columns meander continuously up the face, so their
 * position never jumps at a bedding plane and creates a repeated staircase.
 */
export const getWallForms = (fields: SkinFields, x: number, y: number, z: number): WallForms => {
  const bed = getBed(getWallLevel(x, y, z));
  const jog = fields.buttresses(x * 0.13 + y * 0.05, z * 0.13 - y * 0.03) * COLUMN * 0.35;
  const column = fields.columns(x + jog, z - jog * 0.6);
  const joint = smoothstep(0.26, 0.04, column.edge);
  const buttress = (fields.buttresses(x * 0.11, z * 0.11) + 1) * 0.35;
  const erosion = smoothstep(-0.35, 0.45, fields.buttresses(x * 0.25 + y * 0.07, z * 0.25));
  const bedOffset = getBedOffset(fields, bed, column.hash) * (0.35 + erosion * 0.65);
  const offset = buttress + 0.1 + column.hash * 0.12 + bedOffset - joint * 0.2;
  return { joint, offset: Math.max(0, offset) };
};

/**
 * Talus at the foot of a wall: 0 elsewhere .. 1 on the moderate ground just below a steep face
 * (looked up a little uphill along the gradient).
 */
export const getFootFactor = (
  terrain: RockTerrain,
  x: number,
  z: number,
  [gradientX, gradientZ]: [number, number]
) => {
  const slope = Math.hypot(gradientX, gradientZ);
  if (slope < 0.05) return 0;
  const probeX = x + (gradientX / slope) * FOOT_PROBE;
  const probeZ = z + (gradientZ / slope) * FOOT_PROBE;
  const above = Math.hypot(...getGradient(terrain, probeX, probeZ));
  return smoothstep(1.4, 2.6, above) * (1 - smoothstep(1, 2, slope));
};

/** Lumpy stones of the talus apron (0 .. ~0.14 outward). */
export const getTalusOffset = (fields: SkinFields, x: number, z: number) =>
  smoothstep(1, 0.2, fields.stones(x, z).nearest) * 0.14;
