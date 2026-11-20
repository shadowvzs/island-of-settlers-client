import { computeDistanceField } from "../shared/world/generation/distance-field";
import type { CellRegion } from "../shared/world/grid-geometry";
import { smoothstep } from "../shared/world/noise";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../shared/world/world-data";
import { GROUND_VARIANT_TUNING } from "./shaders/ground-variant-layers-glsl";

/**
 * Ground zones of the render-only ground detail (GROUND-PALETTE, ground-palette-3), two channels per world vertex
 * (0..1), derived from the splat and cached per world:
 * - mountain foot: closeness to the mountain ground (rock and mine land), so the grass turns into alpine meadow and
 *   lichen grass where it meets a massif, whatever the massif's height (the absolute height bands alone left a thin
 *   rim on low massifs);
 * - dune zone: closeness of sand to the grass, the band behind a beach where dune grass grows in clumps.
 * Render only: no gameplay rule reads it. The map editor patches the cache around an edit (refreshGroundZoneField).
 */
export const GROUND_ZONE_CHANNELS = 2;
export const GROUND_ZONE = { duneZone: 1, mountainFoot: 0 } as const;

/** Mountain ground (splat share) and the foot band's reach (cells: full up to `near`, none from `far`). */
const MOUNTAIN = { far: 10, ground: 0.5, near: 1 } as const;
/** Grass ground (splat share) and the dune band's reach behind it on the sand (cells). */
const DUNE = { far: 3.5, grass: 0.5, near: 0.5 } as const;

const shareOf = (world: WorldData, vertex: number, material: number) =>
  world.splat[vertex * MATERIAL_COUNT + material]! / 255;

const isMountainGround = (world: WorldData, vertex: number) =>
  shareOf(world, vertex, MATERIAL.rock) + shareOf(world, vertex, MATERIAL.mine) >= MOUNTAIN.ground;

const isGrassGround = (world: WorldData, vertex: number) =>
  shareOf(world, vertex, MATERIAL.grass) + shareOf(world, vertex, MATERIAL.lushGrass) >= DUNE.grass;

/**
 * Vertices (cells) an edit reaches: a splat change moves both zones only within the farther band reach, and a vertex
 * there finds every source that matters within the same reach (a chamfer path stays inside the box of its ends).
 */
const ZONE_REACH = Math.ceil(Math.max(MOUNTAIN.far, DUNE.far)) + 1;

/** Vertex window [minX, minZ] … [maxX, maxZ] (inclusive) on the world's vertex grid. */
interface VertexWindow { maxX: number; maxZ: number; minX: number; minZ: number; }

const growWindow = (world: WorldData, window: VertexWindow, margin: number): VertexWindow => ({
  maxX: Math.min(world.cellsX, window.maxX + margin),
  maxZ: Math.min(world.cellsZ, window.maxZ + margin),
  minX: Math.max(0, window.minX - margin),
  minZ: Math.max(0, window.minZ - margin)
});

/**
 * Writes both zone channels of the `target` vertices into `field`, from distance fields over `source` (the target
 * grown by the zones' reach, or the whole grid).
 */
const writeZones = (world: WorldData, field: Float32Array, source: VertexWindow, target: VertexWindow) => {
  const stride = world.cellsX + 1, width = source.maxX - source.minX + 1;
  const grid = { cellsX: width - 1, cellsZ: source.maxZ - source.minZ };
  const toVertex = (local: number) =>
    (source.minZ + Math.floor(local / width)) * stride + source.minX + local % width;
  const mountain = computeDistanceField(grid, local => isMountainGround(world, toVertex(local)));
  const grass = computeDistanceField(grid, local => isGrassGround(world, toVertex(local)));
  for (let z = target.minZ; z <= target.maxZ; z += 1) {
    for (let x = target.minX; x <= target.maxX; x += 1) {
      const local = (z - source.minZ) * width + x - source.minX;
      const at = (z * stride + x) * GROUND_ZONE_CHANNELS;
      field[at + GROUND_ZONE.mountainFoot] = 1 - smoothstep(MOUNTAIN.near, MOUNTAIN.far, mountain[local]!);
      field[at + GROUND_ZONE.duneZone] = 1 - smoothstep(DUNE.near, DUNE.far, grass[local]!);
    }
  }
};

/** Builds both zone channels of every world vertex. */
export const buildGroundZoneField = (world: WorldData) => {
  const field = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1) * GROUND_ZONE_CHANNELS);
  const whole = { maxX: world.cellsX, maxZ: world.cellsZ, minX: 0, minZ: 0 };
  writeZones(world, field, whole, whole);
  return field;
};

const cache = new WeakMap<WorldData, Float32Array>();

/** The world's ground zones (built on first use, shared by every chunk build). */
export const getGroundZoneField = (world: WorldData) => {
  const cached = cache.get(world);
  if (cached) return cached;
  const field = buildGroundZoneField(world);
  cache.set(world, field);
  return field;
};

/**
 * Ground was painted or reshaped in `cells` (map editor): patches the cached zones of the vertices the edit can reach
 * (the cells plus the zones' reach), from distance fields over that area plus the reach again (ground-palette-4: the
 * whole map was derived again after every edit). Without a cache the next chunk build derives the whole field.
 */
export const refreshGroundZoneField = (world: WorldData, cells: CellRegion) => {
  const field = cache.get(world);
  if (!field || cells.minX > cells.maxX || cells.minZ > cells.maxZ) return;
  const edited = { maxX: cells.maxX + 1, maxZ: cells.maxZ + 1, minX: cells.minX, minZ: cells.minZ };
  const target = growWindow(world, edited, ZONE_REACH);
  writeZones(world, field, growWindow(world, target, ZONE_REACH), target);
};

/** The main thread's zones for a worker build of the same world revision (the worker skips its own full build). */
export const peekGroundZoneField = (world: WorldData) => cache.get(world);

/** Installs zones derived elsewhere (the main thread's, sent with a worker rebuild request). */
export const installGroundZoneField = (world: WorldData, field: Float32Array) => {
  cache.set(world, field);
};

const zone = GROUND_VARIANT_TUNING;

/**
 * The grass zones of a world vertex without the shader's noise wobble (getAlpineZone of
 * ground-variant-layers-glsl.ts): [alpine meadow, lichen grass] 0..1, for the grass cover tufts.
 */
export const getAlpineZoneAt = (world: WorldData, vertex: number): readonly [number, number] => {
  // World height, like the shader's vWorld.y.
  const height = world.heights[vertex]!;
  const foot = getGroundZoneField(world)[vertex * GROUND_ZONE_CHANNELS + GROUND_ZONE.mountainFoot]!;
  const near = foot * smoothstep(zone.footHeight[0], zone.footHeight[1], height);
  return [
    Math.max(smoothstep(zone.alpineHeight[0], zone.alpineHeight[1], height),
      smoothstep(zone.alpineFoot[0], zone.alpineFoot[1], near)),
    Math.max(smoothstep(zone.lichenHeight[0], zone.lichenHeight[1], height),
      smoothstep(zone.lichenFoot[0], zone.lichenFoot[1], near))
  ];
};
