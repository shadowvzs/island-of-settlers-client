import { refreshBuildClassRegion } from "../world/build-class";
import { refreshWalkCost } from "../world/editing/build-refresh";
import { getCellTerrain } from "../world/generation/gameplay";
import { refreshNormals } from "../world/lighting";
import { bumpTerrainRevision, markWorldChanged } from "../world/save/world-change-journal";
import { BLOCKING, HEIGHT_LEVEL_STEP, type WorldData } from "../world/world-data";
import type { SettlementBuilding } from "./settlement-types";

const APRON = 3;
const LEVEL_MARGIN = 1;
const containsVertex = (building: SettlementBuilding, x: number, z: number) =>
  Math.abs(x - building.x) <= building.width / 2 && Math.abs(z - building.z) <= building.depth / 2;

interface FoundationRegion { minX: number; minZ: number; maxX: number; maxZ: number }

export const refreshFoundationTerrain = (world: WorldData, bounds: FoundationRegion) => {
  markWorldChanged(world,
    { maxX: bounds.maxX + 1, maxZ: bounds.maxZ + 1, minX: bounds.minX - 1, minZ: bounds.minZ - 1 });
  const normals = {
    minX: Math.max(0, bounds.minX - 1),
    minZ: Math.max(0, bounds.minZ - 1),
    maxX: Math.min(world.cellsX, bounds.maxX + 1),
    maxZ: Math.min(world.cellsZ, bounds.maxZ + 1)
  };
  if (world.normals) refreshNormals(world, world.heights, world.normals, normals);
  const cells = {
    ...normals,
    maxX: Math.min(world.cellsX - 1, normals.maxX),
    maxZ: Math.min(world.cellsZ - 1, normals.maxZ)
  };
  if (world.slopeClass && world.waterDepth) {
    for (let z = cells.minZ; z <= cells.maxZ; z++)
      for (let x = cells.minX; x <= cells.maxX; x++) {
        const cell = z * world.cellsX + x,
          terrain = getCellTerrain(world, world, x, z);
        world.slopeClass[cell] = terrain.slopeClass;
        if (world.blocking[cell] !== BLOCKING.prop) world.blocking[cell] = terrain.blocking;
      }
    refreshWalkCost(world, cells);
    refreshBuildClassRegion(world, cells);
  }
  return cells;
};

/** Flatten only the four terrain vertices belonging to this worked tile. */
export const levelBuildingFoundationTile = (
  world: WorldData, building: SettlementBuilding, x: number, z: number,
  existing: readonly SettlementBuilding[]
) => {
  const bounds = { minX: x, minZ: z, maxX: x + 1, maxZ: z + 1 };
  let changed = false;
  for (let vertexZ = z; vertexZ <= z + 1; vertexZ++)
    for (let vertexX = x; vertexX <= x + 1; vertexX++) {
      const vertex = vertexZ * (world.cellsX + 1) + vertexX;
      if ((world.waterDepth?.[vertex] ?? 0) > 0 ||
        existing.some(plot => containsVertex(plot, vertexX, vertexZ))) continue;
      const height = Math.fround(building.y);
      if (height === world.heights[vertex]) continue;
      world.heights[vertex] = height;
      if (world.heightLevels) world.heightLevels[vertex] = Math.max(0, Math.floor((height + .5) / HEIGHT_LEVEL_STEP));
      changed = true;
    }
  if (!changed) return null;
  bumpTerrainRevision(world, bounds);
  return refreshFoundationTerrain(world, bounds);
};

/** Distance (cells) of a vertex outside the plot's edge, 0 inside. */
const plotDistance = (building: SettlementBuilding, x: number, z: number) =>
  Math.max(Math.abs(x - building.x) - building.width / 2, Math.abs(z - building.z) - building.depth / 2, 0);

/** Every editable vertex of the plot and its level margin already stands exactly at the plot height. */
const isFoundationLevelled = (world: WorldData, building: SettlementBuilding, bounds: FoundationRegion,
  isLevelVertex: (x: number, z: number) => boolean) => {
  let levelled = 0;
  for (let z = bounds.minZ; z <= bounds.maxZ; z++)
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (plotDistance(building, x, z) > LEVEL_MARGIN || !isLevelVertex(x, z)) continue;
      if (world.heights[z * (world.cellsX + 1) + x] !== building.y) return false;
      levelled++;
    }
  return levelled > 0;
};

/** A level construction plot with a dry, gently blended apron; existing foundations stay fixed. */
export const levelBuildingFoundation = (
  world: WorldData,
  building: SettlementBuilding,
  existing: readonly SettlementBuilding[]
) => {
  building.y = Math.fround(building.y);
  const left = building.x - building.width / 2,
    top = building.z - building.depth / 2;
  const right = left + building.width,
    bottom = top + building.depth;
  const bounds = {
    minX: Math.max(0, Math.floor(left - APRON)),
    minZ: Math.max(0, Math.floor(top - APRON)),
    maxX: Math.min(world.cellsX, Math.ceil(right + APRON)),
    maxZ: Math.min(world.cellsZ, Math.ceil(bottom + APRON))
  };
  const isLevelVertex = (x: number, z: number) => {
    const vertex = z * (world.cellsX + 1) + x;
    return (world.waterDepth?.[vertex] ?? 0) <= 0 && !existing.some((plot) => containsVertex(plot, x, z));
  };
  // A saved map or game already holds this level plot and its blended apron: blending the apron
  // again would pull it a further step towards the plot height on every load.
  if (isFoundationLevelled(world, building, bounds, isLevelVertex)) return null;
  let changed = false;
  for (let z = bounds.minZ; z <= bounds.maxZ; z++)
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const vertex = z * (world.cellsX + 1) + x;
      if (!isLevelVertex(x, z)) continue;
      const distance = plotDistance(building, x, z);
      // Smooth terrain sampling uses the neighboring vertex beyond the plot's outer edge.
      const cover = Math.max(0, 1 - Math.max(0, distance - LEVEL_MARGIN) / (APRON - LEVEL_MARGIN));
      const blend = cover * cover * (3 - 2 * cover);
      const height = Math.fround(
        world.heights[vertex]! + (building.y - world.heights[vertex]!) * blend
      );
      if (height === world.heights[vertex]) continue;
      world.heights[vertex] = height;
      if (world.heightLevels)
        world.heightLevels[vertex] = Math.max(0, Math.floor((height + 0.5) / HEIGHT_LEVEL_STEP));
      changed = true;
    }
  if (!changed) return null;
  bumpTerrainRevision(world, bounds);
  return refreshFoundationTerrain(world, bounds);
};
