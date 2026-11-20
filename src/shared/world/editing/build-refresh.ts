import { getTerrainCap, PROP_CLEARANCE, refreshBuildClassRegion } from "../build-class";
import { createRoughGround, isRockGroundCell, type RoughGround } from "../generation/rough-ground";
import { addPropWalkCost, getGroundWalkCost } from "../generation/walkability";
import { type CellRegion,expandRegion, forEachRegionCell } from "../grid-geometry";
import { somePropInCell } from "../prop-cell-index";
import { markWorldChanged } from "../save/world-change-journal";
import type { WorldData } from "../world-data";

/**
 * What the terrain cap reads that edits never change (rock skin, massif, river and rock
 * distances, harsh slopes), measured once; only the rock ground part of the rough test follows
 * the painted splat.
 */
export interface EditGround {
  base: RoughGround;
  /** Rough cells now (the base plus the current rock ground). */
  rough: Uint8Array;
}

/** The fixed ground of the world (without its splat), for the edits' build layer refresh. */
export const createEditGround = (world: WorldData): EditGround => {
  const base = createRoughGround(world, {
    heights: world.heights,
    riverDistance: world.riverDistance
  });
  const rough = Uint8Array.from(base.rough, (value, cell) =>
    value === 1 || isRockGroundCell(world, world.splat, cell) ? 1 : 0
  );
  return { base, rough };
};

/** Cells around a region the window of a ground refresh adds (rock reach, mountain reach). */
const GROUND_WINDOW = 8;

/** A vertex layer cropped to the window's vertices. */
const cropVertices = (world: WorldData, layer: Float32Array, window: CellRegion) => {
  const width = window.maxX - window.minX + 2;
  const height = window.maxZ - window.minZ + 2;
  const cropped = new Float32Array(width * height);
  for (let z = 0; z < height; z += 1) {
    const from = (window.minZ + z) * (world.cellsX + 1) + window.minX;
    cropped.set(layer.subarray(from, from + width), z * width);
  }
  return cropped;
};

/**
 * The fixed ground measured again around a region after its heights changed (map editor
 * terrain edits): computed on a window around the region, copied back for the region and its
 * clearance reach, so the rest of the island is not measured again.
 */
export const refreshEditGround = (world: WorldData, ground: EditGround, cells: CellRegion) => {
  const window = expandRegion(world, cells, GROUND_WINDOW);
  const grid = { cellsX: window.maxX - window.minX + 1, cellsZ: window.maxZ - window.minZ + 1 };
  const local = createRoughGround(grid, {
    heights: cropVertices(world, world.heights, window),
    riverDistance: cropVertices(world, world.riverDistance, window)
  });
  const inner = expandRegion(world, cells, PROP_CLEARANCE + 1);
  const layers = ["massif", "riverDistance", "rockDistance", "rough"] as const;
  forEachRegionCell(world, inner, (cell, x, z) => {
    const localCell = (z - window.minZ) * grid.cellsX + (x - window.minX);
    for (const layer of layers) ground.base[layer][cell] = local[layer][localCell]!;
    const isRock = isRockGroundCell(world, world.splat, cell);
    ground.rough[cell] = ground.base.rough[cell] === 1 || isRock ? 1 : 0;
  });
  return ground;
};

/**
 * Walk cost of the region's cells: the ground plus every prop standing in them, read per cell from
 * the prop cell index (the prop costs add up in any order, so the cell order gives the same cost).
 */
export const refreshWalkCost = (world: WorldData, region: CellRegion) => {
  const { props } = world;
  markWorldChanged(world, region);
  forEachRegionCell(world, region, (cell) => {
    let cost = getGroundWalkCost(world, cell);
    somePropInCell(world, cell, (index) => {
      cost = addPropWalkCost(cost, props.types[index]!);
      return false;
    });
    world.walkCost[cell] = cost;
  });
};

/** Rough cells of the region from the fixed ground and the current rock ground. */
export const refreshRoughCells = (world: WorldData, ground: EditGround, region: CellRegion) => {
  forEachRegionCell(world, region, (cell) => {
    const isRock = isRockGroundCell(world, world.splat, cell);
    ground.rough[cell] = ground.base.rough[cell] === 1 || isRock ? 1 : 0;
  });
};

/**
 * After a ground or mine land edit: the terrain cap (rock ground, mine land), the walk cost and
 * the build class around the region follow the new ground; `buildRevision` changes, so the
 * building spots overlay redraws.
 */
export const refreshBuildLayers = (world: WorldData, ground: EditGround, region: CellRegion) => {
  const { mineZone, slopeClass } = world;
  const layers = { ...ground.base, mineZone, rough: ground.rough, slopeClass };
  refreshRoughCells(world, ground, region);
  forEachRegionCell(world, region, (cell) => {
    world.buildCap[cell] = getTerrainCap(layers, cell);
  });
  refreshWalkCost(world, region);
  refreshBuildClassRegion(world, expandRegion(world, region, PROP_CLEARANCE));
};
