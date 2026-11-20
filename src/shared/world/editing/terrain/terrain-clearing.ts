import type { GridSize } from "../../grid-geometry";
import { NO_MINE_ZONE, PROP_REMOVED, type WorldData } from "../../world-data";
import type { EditRefusal } from "../edit-refusal";
import { removeMineLand } from "../mine-land";
import { removePropsAt } from "../prop-removal";
import type { TerrainEditState } from "./terrain-edit-state";
import { getFootprintRatio, getStampRadius, isLake, type TerrainStamp } from "./terrain-stamps";

/** Water deeper than this (world units) under a stamp's spine refuses it (shallows may rise). */
const DEEP_WATER = 1.5;
/** A footprint vertex this close to a river bed (cells) refuses the stamp. */
const RIVER_REACH = 1;

/** A lake clears its bed and the near shore (footprint ratio). */
const LAKE_CLEARED = 1.15;
/** Footprint ratio a stamp clears: a mountain its foot, a lake its shore as well. */
const getClearedRatio = (stamp: TerrainStamp) => (isLake(stamp) ? LAKE_CLEARED : 1);

/** Calls `visit` for every vertex inside the stamp's cleared footprint. */
const forEachFootprintVertex = (
  grid: GridSize,
  stamp: TerrainStamp,
  visit: (vertex: number, x: number, z: number) => void
) => {
  const limit = getClearedRatio(stamp);
  const reach = getStampRadius(stamp) * 1.3 * limit;
  const toX = stamp.toX ?? stamp.x;
  const toZ = stamp.toZ ?? stamp.z;
  const maxX = Math.min(grid.cellsX, Math.ceil(Math.max(stamp.x, toX) + reach));
  const maxZ = Math.min(grid.cellsZ, Math.ceil(Math.max(stamp.z, toZ) + reach));
  for (let z = Math.max(0, Math.floor(Math.min(stamp.z, toZ) - reach)); z <= maxZ; z += 1) {
    for (let x = Math.max(0, Math.floor(Math.min(stamp.x, toX) - reach)); x <= maxX; x += 1) {
      if (getFootprintRatio(stamp, x, z) < limit) visit(z * (grid.cellsX + 1) + x, x, z);
    }
  }
};

/** The water before any stamp (the editor's own lakes do not refuse their next level). */
export interface SiteWater {
  heights: Float32Array;
  waterSurface: Float32Array;
}

/** Original water depth under the stamp's spine. */
const getCentreDepth = (world: WorldData, water: SiteWater, stamp: TerrainStamp) => {
  const centre = Math.round(stamp.z) * (world.cellsX + 1) + Math.round(stamp.x);
  return Math.max(0, (water.waterSurface[centre] ?? 0) - (water.heights[centre] ?? 0));
};

/**
 * Why a stamp may not stand there: rivers and other fresh water in its footprint; deep water
 * under a mountain's spine (raising shallow sea into an islet is fine), any water under a
 * lake's (it is dug into land). Null when it may.
 */
export const checkStampSite = (
  world: WorldData,
  stamp: TerrainStamp,
  water: SiteWater = world
): EditRefusal | null => {
  const depth = getCentreDepth(world, water, stamp);
  if (isLake(stamp) && depth > 0) return "water";
  if (depth > DEEP_WATER) return "deepWater";
  let refusal: EditRefusal | null = null;
  forEachFootprintVertex(world, stamp, (vertex) => {
    const isFresh = water.waterSurface[vertex]! > world.seaLevel + 0.05;
    if (world.riverDistance[vertex]! < RIVER_REACH || isFresh) refusal = "river";
  });
  return refusal;
};

/** Props standing in the stamp's footprint (cell of the trunk inside it), minus `keep`. */
const listFootprintProps = (world: WorldData, stamp: TerrainStamp, keep: Set<number>) => {
  const { props } = world;
  const listed: number[] = [];
  const radius = getStampRadius(stamp);
  const limit = getClearedRatio(stamp);
  for (let index = 0; index < props.count; index += 1) {
    if (props.types[index] === PROP_REMOVED || keep.has(index)) continue;
    const ratio = getFootprintRatio(stamp, props.x[index]!, props.z[index]!);
    if (ratio < limit || ratio * radius < 1) listed.push(index);
  }
  return listed;
};

/** Mine cells in the stamp's footprint (deposits and gravel give way to the rock). */
const listFootprintMineCells = (world: WorldData, stamp: TerrainStamp) => {
  const cells: number[] = [];
  forEachFootprintVertex(world, stamp, (_, x, z) => {
    if (x >= world.cellsX || z >= world.cellsZ) return;
    const cell = z * world.cellsX + x;
    if (world.mineZone[cell] !== NO_MINE_ZONE) cells.push(cell);
  });
  return cells;
};

/**
 * Clears the stamp's footprint first (owner): every tree, plant, stone and placed prop on it is
 * removed (the stamp's own boulders stay), mine land and its deposits give way. Returns the
 * removed props and whether mine land changed.
 */
export const clearFootprint = (world: WorldData, state: TerrainEditState, stamp: TerrainStamp) => {
  const own = new Set([...state.stampProps.values()].flat());
  const removed = listFootprintProps(world, stamp, own);
  removePropsAt(world, removed);
  const mineCells = listFootprintMineCells(world, stamp);
  removeMineLand(world, mineCells);
  return { mineChanged: mineCells.length > 0, removed };
};
