import {
  markedNavigationBlocks,
  navigationChangeRevision,
  type TileRect,
  worldNavigationEpoch,
  worldTileRect
} from "../world/navigation-change-log";
import type { WalkabilityRecheck } from "./road-route-cache";
import type { OccupancyChanges, RoadPoint, RoadWorld } from "./road-types";

/**
 * Tiles round a half-grid node whose blocking a road step's samples can read: the samples lie within
 * half a step along and half the dirt width across the edge, so one tile suffices; two keep a margin.
 */
const ROAD_STEP_REACH = 2;

/**
 * Node tiles (`z * (cellsX + 1) + x`; node coordinates run to `cellsX` inclusive) within reach of a
 * changed cell. `isBlocked` reads `occupied[floor(z) * cellsX + floor(x)]`, so a sample on the east
 * border (x = cellsX) reads the first cell of the next row: that cell also counts as (cellsX, z - 1).
 */
const reachedNodeTiles = (world: RoadWorld, cells: readonly number[]) => {
  const { cellsX, cellsZ } = world, tiles = new Set<number>();
  const reach = (cellX: number, cellZ: number) => {
    const toX = Math.min(cellsX, cellX + ROAD_STEP_REACH), toZ = Math.min(cellsZ, cellZ + ROAD_STEP_REACH);
    for (let z = Math.max(0, cellZ - ROAD_STEP_REACH); z <= toZ; z++)
      for (let x = Math.max(0, cellX - ROAD_STEP_REACH); x <= toX; x++) tiles.add(z * (cellsX + 1) + x);
  };
  for (const cell of cells) {
    const cellX = cell % cellsX, cellZ = Math.floor(cell / cellsX);
    reach(cellX, cellZ);
    if (cellX === 0 && cellZ > 0) reach(cellsX, cellZ - 1);
  }
  return tiles;
};

const union = (first: number[], second: number[]) => {
  if (!first.length) return second;
  if (!second.length) return first;
  return [...new Set([...first, ...second])];
};

/**
 * The walkability recheck of the road route cache. World blocking changes (A03 part b: felling,
 * planting, boulders) test again only the memoized edges near the marked blocks; an unexplained world
 * counter move (navigation epoch) still clears everything. An occupancy change (A04b: field
 * reservations, field sites) also tests the memoized edges near the changed cells; an unknown one (no
 * tracked source, or a revision step without cells) clears everything.
 */
export const createWalkabilityRecheck = (world: RoadWorld, nodeSpan: number, point: (node: number) => RoadPoint,
  walkable: (start: RoadPoint, end: RoadPoint) => boolean) => {
  let epoch = worldNavigationEpoch(world), stamp = navigationChangeRevision(world);
  let occupancy: OccupancyChanges | undefined;
  const nodeTile = (key: number) => {
    const { x, z } = point(Math.floor(key / nodeSpan));
    return { tileX: Math.floor(x), tileZ: Math.floor(z) };
  };
  const nearBlocks = (key: number, blocks: readonly TileRect[]) => {
    const { tileX, tileZ } = nodeTile(key);
    return blocks.some(block => tileX >= block.minX - ROAD_STEP_REACH && tileX <= block.maxX + ROAD_STEP_REACH &&
      tileZ >= block.minZ - ROAD_STEP_REACH && tileZ <= block.maxZ + ROAD_STEP_REACH);
  };
  const restampBlocking = () => {
    epoch = worldNavigationEpoch(world);
    stamp = navigationChangeRevision(world);
  };
  const blockingAffected = (keys: readonly number[]) => {
    const unexplained = worldNavigationEpoch(world) !== epoch;
    const blocks = markedNavigationBlocks(world, worldTileRect(world), stamp);
    restampBlocking();
    if (unexplained) return null;
    return blocks.length ? keys.filter(key => nearBlocks(key, blocks)) : [];
  };
  const occupancyAffected = (keys: readonly number[]) => {
    const cells = occupancy?.changedCells() ?? null;
    occupancy?.mark();
    if (!cells) return null;
    if (!cells.length) return [];
    const tiles = reachedNodeTiles(world, cells);
    return keys.filter(key => {
      const { tileX, tileZ } = nodeTile(key);
      return tiles.has(tileZ * (world.cellsX + 1) + tileX);
    });
  };
  const recheck: WalkabilityRecheck = {
    // World blocking is always rechecked: before A04b any occupancy change cleared everything, so a
    // world change logged without a build revision move is still caught alongside it.
    affected: (keys, occupancyChanged) => {
      const blocking = blockingAffected(keys);
      const occupied = occupancyChanged ? occupancyAffected(keys) : [];
      if (!blocking || !occupied) return null;
      return union(blocking, occupied);
    },
    restamp: () => {
      restampBlocking();
      occupancy?.mark();
    },
    walkable: key => walkable(point(Math.floor(key / nodeSpan)), point(key % nodeSpan))
  };
  return {
    recheck,
    track: (changes: OccupancyChanges | undefined) => {
      occupancy = changes;
    }
  };
};
