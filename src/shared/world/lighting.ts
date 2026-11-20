import { DMath } from "../math/deterministic-math";
import { getVertexCount, type GridSize,readVertex, sampleBilinear } from "./grid-geometry";
import { clamp } from "./noise";
import type { SunDirection } from "./world-data";

const SHADOW_STEP = 0.5;
const SHADOW_DISTANCE = 48;
const SHADOW_SOFTNESS = 0.8;
const AO_DIRECTIONS = 8;
const AO_DISTANCES = [1, 2, 4, 7] as const;

/** Default sun: from the upper left of the screen (towards -x), 40 degrees high. */
export const DEFAULT_SUN: SunDirection = {
  azimuthX: -0.94,
  azimuthZ: -0.34,
  elevation: (40 * Math.PI) / 180
};

/** Slopes are lit as if steeper: stronger light / shade contrast reads height better. */
const NORMAL_EXAGGERATION = 1.8;

/** Smooth vertex normals (x, y, z per vertex) from central differences; one cell = one unit. */
export const refreshNormals = (
  grid: GridSize,
  heights: Float32Array,
  normals: Float32Array,
  bounds = { minX: 0, minZ: 0, maxX: grid.cellsX, maxZ: grid.cellsZ }
) => {
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const dx =
        ((readVertex(grid, heights, x + 1, z) - readVertex(grid, heights, x - 1, z)) *
          NORMAL_EXAGGERATION) /
        2;
      const dz =
        ((readVertex(grid, heights, x, z + 1) - readVertex(grid, heights, x, z - 1)) *
          NORMAL_EXAGGERATION) /
        2;
      const length = DMath.hypot(dx, 1, dz),
        index = (z * (grid.cellsX + 1) + x) * 3;
      normals[index] = -dx / length;
      normals[index + 1] = 1 / length;
      normals[index + 2] = -dz / length;
    }
  }
};

export const computeNormals = (grid: GridSize, heights: Float32Array) => {
  const normals = new Float32Array(getVertexCount(grid) * 3);
  refreshNormals(grid, heights, normals);
  return normals;
};

/** Soft terrain self shadow: marches towards the sun and measures how far the ray is blocked. */
const getSunVisibility = (
  grid: GridSize,
  surface: Float32Array,
  sun: SunDirection,
  x: number,
  z: number
) => {
  const start = readVertex(grid, surface, x, z) + 0.05;
  const rise = DMath.tan(sun.elevation);
  let blocked = 0;
  for (let distance = SHADOW_STEP; distance < SHADOW_DISTANCE; distance += SHADOW_STEP) {
    const sampleX = x + sun.azimuthX * distance;
    const sampleZ = z + sun.azimuthZ * distance;
    if (sampleX < 0 || sampleZ < 0 || sampleX > grid.cellsX || sampleZ > grid.cellsZ) break;
    const excess = sampleBilinear(grid, surface, sampleX, sampleZ) - (start + distance * rise);
    blocked = Math.max(blocked, excess / (1 + distance * 0.08));
  }
  return clamp(1 - blocked / SHADOW_SOFTNESS, 0, 1);
};

/** Horizon based ambient occlusion: valleys, gullies and cliff bases get darker. */
const getAmbientOcclusion = (grid: GridSize, surface: Float32Array, x: number, z: number) => {
  const base = readVertex(grid, surface, x, z);
  let occlusion = 0;
  for (let direction = 0; direction < AO_DIRECTIONS; direction += 1) {
    const angle = (direction / AO_DIRECTIONS) * Math.PI * 2;
    let horizon = 0;
    for (const distance of AO_DISTANCES) {
      const sample = sampleBilinear(
        grid,
        surface,
        x + DMath.cos(angle) * distance,
        z + DMath.sin(angle) * distance
      );
      horizon = Math.max(horizon, (sample - base) / DMath.hypot(sample - base, distance));
    }
    occlusion += horizon;
  }
  return clamp(1 - (occlusion / AO_DIRECTIONS) * 1.1, 0.25, 1);
};

/** Unit directions of the AO horizon search (the same order as getAmbientOcclusion's angles). */
const AO_DIRECTION_VECTORS = Array.from({ length: AO_DIRECTIONS }, (_, direction) => {
  const angle = (direction / AO_DIRECTIONS) * Math.PI * 2;
  return [DMath.cos(angle), DMath.sin(angle)] as const;
});

/**
 * What getAmbientOcclusion bakes for a perfect plane of this gradient: the horizon is measured from
 * the horizontal, so a plain slope counts its own uphill side as occluder (0..1).
 */
const getPlanarAmbientOcclusion = (gradientX: number, gradientZ: number) => {
  let occlusion = 0;
  for (const [directionX, directionZ] of AO_DIRECTION_VECTORS) {
    const rise = gradientX * directionX + gradientZ * directionZ;
    if (rise > 0) occlusion += rise / DMath.hypot(rise, 1);
  }
  return clamp(1 - (occlusion / AO_DIRECTIONS) * 1.1, 0.25, 1);
};

/**
 * WALL-PATCHES: a baked occlusion byte with the share of a plain slope removed. The sky light
 * already falls off with the surface normal (skyIrradiance), so the bake's slope share counted the
 * tilt twice: every steeper strip of a mountain face read as a dark streak, worst in rain and
 * overcast light, where the sky light is nearly all the light. Valleys, gullies and cliff feet stay
 * occluded (they rise above their own tangent plane). `normal` is a vertex normal of `computeNormals`
 * (its slope exaggerated by NORMAL_EXAGGERATION); render-side, saved worlds keep their bake.
 */
export const removePlanarOcclusion = (occlusion: number, normalX: number, normalY: number, normalZ: number) => {
  if (normalY <= 0) return occlusion;
  const scale = 1 / (normalY * NORMAL_EXAGGERATION);
  const planar = getPlanarAmbientOcclusion(-normalX * scale, -normalZ * scale);
  return Math.min(255, occlusion / planar);
};

/** The dry surface the light is baked on: terrain or water surface, whichever is higher. */
const createLightSurface = (heights: Float32Array, waterSurface: Float32Array) =>
  Float32Array.from(heights, (height, index) => Math.max(height, waterSurface[index]!));

/** Baked light bytes per vertex. */
export interface TerrainLight {
  ambientOcclusion: Uint8Array;
  sunShadow: Uint8Array;
  /** World terrain revision, when the light owner has one: detects non-editor terrain changes. */
  terrainRevision?: number;
}

/** Inclusive vertex bounds of a partial bake. */
interface VertexBounds {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/**
 * Refresh enough rows around an edit that every surface value the partial bake reads is current.
 * The bake expands the changed bounds by the shadow reach (48) plus AO (7), then marches towards
 * the sun from every expanded vertex (another shadow distance); `+3` covers the ceil and the
 * bilinear neighbours.
 */
const SURFACE_REFRESH_MARGIN = SHADOW_DISTANCE * 2 + AO_DISTANCES[AO_DISTANCES.length - 1]! + 3;

/**
 * A world's light surface, kept in sync with terrain edits instead of allocating and reducing the
 * whole map for every bake. `minimums` keeps the lowest surface value per vertex row: the global
 * minimum then costs one row scan rather than a full-surface reduce, while staying exact.
 */
interface LightSurfaceCache {
  cellsX: number;
  cellsZ: number;
  heights: Float32Array;
  minimums: Float32Array;
  /** Terrain revision seen at the last bake (editor bakes advance it exactly once). */
  revision: number;
  surface: Float32Array;
  waterSurface: Float32Array;
}

const lightSurfaceCaches = new WeakMap<TerrainLight, LightSurfaceCache>();

/** Forgets the cached surface of a world (map load/regeneration, undo or redo of terrain spans). */
export const clearTerrainLightCache = (light: TerrainLight) => {
  lightSurfaceCaches.delete(light);
};

const createLightSurfaceCache = (
  grid: GridSize,
  heights: Float32Array,
  waterSurface: Float32Array,
  revision: number
): LightSurfaceCache => {
  const surface = new Float32Array(getVertexCount(grid));
  const minimums = new Float32Array(grid.cellsZ + 1);
  const stride = grid.cellsX + 1;
  for (let vertexZ = 0; vertexZ <= grid.cellsZ; vertexZ += 1) {
    const row = vertexZ * stride;
    let minimum = Infinity;
    for (let vertexX = 0; vertexX <= grid.cellsX; vertexX += 1) {
      const value = Math.max(heights[row + vertexX]!, waterSurface[row + vertexX]!);
      surface[row + vertexX] = value;
      minimum = Math.min(minimum, value);
    }
    minimums[vertexZ] = minimum;
  }
  return { cellsX: grid.cellsX, cellsZ: grid.cellsZ, heights, minimums, revision, surface, waterSurface };
};

const getLightSurfaceCache = (
  grid: GridSize,
  heights: Float32Array,
  waterSurface: Float32Array,
  light: TerrainLight
) => {
  const cached = lightSurfaceCaches.get(light);
  const revision = light.terrainRevision ?? 0;
  const revisionMatches = cached !== undefined && (
    cached.revision === revision || revision === cached.revision + 1
  );
  if (cached && revisionMatches && cached.cellsX === grid.cellsX && cached.cellsZ === grid.cellsZ &&
    cached.heights === heights && cached.waterSurface === waterSurface) {
    cached.revision = revision;
    return cached;
  }
  const cache = createLightSurfaceCache(grid, heights, waterSurface, revision);
  lightSurfaceCaches.set(light, cache);
  return cache;
};

/** Rewrites whole rows of the cached surface and their minima (the row minimum reads all columns). */
const refreshLightSurface = (
  grid: GridSize,
  cache: LightSurfaceCache,
  bounds: VertexBounds
) => {
  const { heights, minimums, surface, waterSurface } = cache;
  const stride = grid.cellsX + 1;
  const minZ = Math.max(0, bounds.minZ);
  const maxZ = Math.min(grid.cellsZ, bounds.maxZ);
  for (let vertexZ = minZ; vertexZ <= maxZ; vertexZ += 1) {
    const row = vertexZ * stride;
    let minimum = Infinity;
    for (let vertexX = 0; vertexX <= grid.cellsX; vertexX += 1) {
      const value = Math.max(heights[row + vertexX]!, waterSurface[row + vertexX]!);
      surface[row + vertexX] = value;
      minimum = Math.min(minimum, value);
    }
    minimums[vertexZ] = minimum;
  }
};

const getLightSurfaceMinimum = (minimums: Float32Array) => {
  let minimum = Infinity;
  for (let row = 0; row < minimums.length; row += 1)
    minimum = Math.min(minimum, minimums[row]!);
  return minimum;
};

const bakeVertices = (
  grid: GridSize,
  surface: Float32Array,
  sun: SunDirection,
  bounds: VertexBounds,
  light: TerrainLight
) => {
  const stride = grid.cellsX + 1;
  for (let vertexZ = bounds.minZ; vertexZ <= bounds.maxZ; vertexZ += 1) {
    for (let vertexX = bounds.minX; vertexX <= bounds.maxX; vertexX += 1) {
      const index = vertexZ * stride + vertexX;
      light.sunShadow[index] = Math.round(
        getSunVisibility(grid, surface, sun, vertexX, vertexZ) * 255
      );
      light.ambientOcclusion[index] = Math.round(
        getAmbientOcclusion(grid, surface, vertexX, vertexZ) * 255
      );
    }
  }
};

/**
 * Bakes sun visibility and ambient occlusion per vertex into bytes. Uses the dry surface
 * (terrain or water surface, whichever is higher) so water casts no odd shadows on the seabed.
 */
export const bakeTerrainLight = (
  grid: GridSize,
  heights: Float32Array,
  waterSurface: Float32Array,
  sun: SunDirection
): TerrainLight => {
  const count = getVertexCount(grid);
  const light = { ambientOcclusion: new Uint8Array(count), sunShadow: new Uint8Array(count) };
  const bounds = { maxX: grid.cellsX, maxZ: grid.cellsZ, minX: 0, minZ: 0 };
  bakeVertices(grid, createLightSurface(heights, waterSurface), sun, bounds, light);
  return light;
};

/** Highest surface in the bounds and lowest of the island: how long a shadow can fall. */
const getShadowReach = (
  grid: GridSize,
  surface: Float32Array,
  sun: SunDirection,
  bounds: VertexBounds,
  highestBefore: number,
  lowest: number
) => {
  let highest = highestBefore;
  for (let vertexZ = bounds.minZ; vertexZ <= bounds.maxZ; vertexZ += 1) {
    for (let vertexX = bounds.minX; vertexX <= bounds.maxX; vertexX += 1) {
      highest = Math.max(highest, surface[vertexZ * (grid.cellsX + 1) + vertexX]!);
    }
  }
  const fall = (highest - lowest) / Math.max(0.05, DMath.tan(sun.elevation));
  return Math.min(SHADOW_DISTANCE, Math.ceil(fall) + 1);
};

/**
 * Re-bakes the light of the vertices a height change in `bounds` (vertices) can reach (map
 * editor): the bounds themselves plus the shadow they can cast away from the sun (as long as
 * their height, or `highestBefore` (the ground before the change), lets it fall, at most
 * SHADOW_DISTANCE).
 */
export const rebakeTerrainLight = (
  grid: GridSize,
  heights: Float32Array,
  waterSurface: Float32Array,
  sun: SunDirection,
  bounds: VertexBounds,
  light: TerrainLight,
  highestBefore = -Infinity
) => {
  const cache = getLightSurfaceCache(grid, heights, waterSurface, light);
  refreshLightSurface(grid, cache, {
    maxX: Math.min(grid.cellsX, bounds.maxX + SURFACE_REFRESH_MARGIN),
    maxZ: Math.min(grid.cellsZ, bounds.maxZ + SURFACE_REFRESH_MARGIN),
    minX: Math.max(0, bounds.minX - SURFACE_REFRESH_MARGIN),
    minZ: Math.max(0, bounds.minZ - SURFACE_REFRESH_MARGIN)
  });
  const surface = cache.surface;
  const reach = getShadowReach(
    grid,
    surface,
    sun,
    bounds,
    highestBefore,
    getLightSurfaceMinimum(cache.minimums)
  );
  const shadowX = -sun.azimuthX * reach;
  const shadowZ = -sun.azimuthZ * reach;
  const ao = AO_DISTANCES[AO_DISTANCES.length - 1]!;
  const expanded = {
    maxX: Math.min(grid.cellsX, Math.ceil(bounds.maxX + Math.max(0, shadowX)) + ao),
    maxZ: Math.min(grid.cellsZ, Math.ceil(bounds.maxZ + Math.max(0, shadowZ)) + ao),
    minX: Math.max(0, Math.floor(bounds.minX + Math.min(0, shadowX)) - ao),
    minZ: Math.max(0, Math.floor(bounds.minZ + Math.min(0, shadowZ)) - ao)
  };
  bakeVertices(grid, surface, sun, expanded, light);
  return expanded;
};
