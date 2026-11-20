import type { GridSize } from "../grid-geometry";
import type { Random } from "../rng";
import { MATERIAL, MATERIAL_COUNT, PROP } from "../world-data";
import { getClusterFactor, type PropSample } from "./prop-rules";

/** Bushes and shrubs the theme thins out (shore shrubs and saplings are not affected). */
const SHRUBS = new Set<number>([PROP.bush, PROP.berryBush, PROP.broadleafShrub, PROP.fieldShrub]);
/** Grounds a bush grows in, and the weight counted as inside them. */
const SHRUB_GROUNDS: number[] = [MATERIAL.grass, MATERIAL.lushGrass, MATERIAL.forestFloor];
const INSIDE_WEIGHT = 0.6;
const EDGE_DIRECTIONS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export const isShrub = (type: number) => SHRUBS.has(type);

/** Vegetated ground weight 0..1 at the nearest vertex. */
const readShrubGround = (grid: GridSize, splat: Uint8Array, x: number, z: number) => {
  const vertexX = Math.min(grid.cellsX, Math.max(0, Math.round(x)));
  const vertexZ = Math.min(grid.cellsZ, Math.max(0, Math.round(z)));
  const base = (vertexZ * (grid.cellsX + 1) + vertexX) * MATERIAL_COUNT;
  return SHRUB_GROUNDS.reduce((sum, material) => sum + splat[base + material]!, 0) / 255;
};

/** The spot and the points `margin` cells around it all lie inside the vegetated ground. */
const isInsideShrubGround = (
  grid: GridSize,
  splat: Uint8Array,
  spot: { x: number; z: number },
  margin: number
) =>
  readShrubGround(grid, splat, spot.x, spot.z) >= INSIDE_WEIGHT &&
  EDGE_DIRECTIONS.every(
    ([dx, dz]) =>
      readShrubGround(grid, splat, spot.x + dx * margin, spot.z + dz * margin) >= INSIDE_WEIGHT
  );

/**
 * Theme filter of the bushes: a margin inside their ground (not on the edge of dirt, sand or
 * rock), and below full density thinned towards sparse clusters (desert scrub, steppe patches).
 */
export const createShrubFilter =
  (grid: GridSize, splat: Uint8Array) =>
  (type: number, spot: PropSample & { x: number; z: number }, random: Random) => {
    if (!isShrub(type)) return true;
    const { shrubDensity, shrubEdgeMargin } = spot.vegetation;
    if (shrubDensity < 1 && random() >= shrubDensity * (0.5 + getClusterFactor(spot))) {
      return false;
    }
    return isInsideShrubGround(grid, splat, spot, shrubEdgeMargin);
  };
