import { createCellRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { CHUNK_CELLS, getChunkCounts } from "../terrain-chunks";
import type { RockInstance } from "./rock-instances";
import { isInRockArea, type RockTerrain } from "./rock-terrain";

/**
 * Rock scatter (slabs, rubble, apron boulders, scree, contact pebbles) is placed tile by tile:
 * every tile has its own random streams and its own crowding test, and owns what it places. A
 * tile is a terrain chunk, so a map editor rebuild of some chunks places exactly what the full
 * build places there (same world, same rocks), whatever was built before or around it.
 */
export interface RockTile {
  /** Chunk id (tileZ * chunksX + tileX): the rock mesh chunk of what the tile places. */
  index: number;
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/** The tiles of the terrain inside its placement area (every tile without an area). */
export const listRockTiles = (terrain: RockTerrain): RockTile[] => {
  const { chunksX, chunksZ } = getChunkCounts(terrain);
  const tiles: RockTile[] = [];
  for (let tileZ = 0; tileZ < chunksZ; tileZ += 1) {
    for (let tileX = 0; tileX < chunksX; tileX += 1) {
      const minX = tileX * CHUNK_CELLS;
      const minZ = tileZ * CHUNK_CELLS;
      if (!isInRockArea(terrain, minX + CHUNK_CELLS / 2, minZ + CHUNK_CELLS / 2)) continue;
      const maxX = Math.min(terrain.cellsX, minX + CHUNK_CELLS);
      const maxZ = Math.min(terrain.cellsZ, minZ + CHUNK_CELLS);
      tiles.push({ index: tileZ * chunksX + tileX, maxX, maxZ, minX, minZ });
    }
  }
  return tiles;
};

/** A random stream of its own per tile and purpose. */
export const createTileRandom = (seed: number, label: string, tile: RockTile): Random =>
  createCellRandom(deriveSeed(seed, label), tile.index);

/**
 * The island wide candidate grid (`offset + k * step`) between `from` (inclusive) and `to`
 * (exclusive): the same points whichever tiles are placed.
 */
export const listGridSteps = (from: number, to: number, step: number, offset = step / 2) => {
  const steps: number[] = [];
  for (let index = Math.max(0, Math.floor((from - offset) / step)); ; index += 1) {
    const point = offset + index * step;
    if (point >= to) return steps;
    if (point >= from) steps.push(point);
  }
};

/** Marks the rocks as placed by the tile (their mesh chunk and rebuild owner); returns them. */
export const claimForTile = (rocks: RockInstance[], tile: RockTile) => {
  for (const rock of rocks) rock.tile = tile.index;
  return rocks;
};

/** The chunk a rock belongs to: the tile that placed it, else the chunk under its centre. */
export const getRockChunk = ({ centre, tile }: RockInstance, chunksX: number) =>
  tile ?? Math.floor(centre[2] / CHUNK_CELLS) * chunksX + Math.floor(centre[0] / CHUNK_CELLS);
