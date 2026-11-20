import { DMath } from "../../../math/deterministic-math";
import { getCircleRegion, sampleSmooth } from "../../grid-geometry";
import { readSplatWeights, writeSplatWeights } from "../../ground-buffer";
import { smoothstep } from "../../noise";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../world-data";
import { listPaintedCells } from "../brush";
import { blendTowardMaterial } from "../ground-paint";
import { removeMineLand } from "../mine-land";
import { removePropsInBrush } from "../prop-removal";
import type { TerrainEditState } from "./terrain-edit-state";
import { getStampBounds } from "./terrain-stamps";

export const TERRAIN_BRUSH_MODES = ["raise", "lower", "smooth", "roughen", "beach", "sea", "flatten"] as const;
export type TerrainBrushMode = typeof TERRAIN_BRUSH_MODES[number] | "reset";
export interface TerrainBrushStroke {
  x: number;
  z: number;
  radius: number;
  mode?: TerrainBrushMode;
  strength?: number;
  targetHeight?: number;
  protectCoast?: boolean;
}

/** Brush sculpting bakes intersecting procedural stamps, preserving their visible terrain. */
export const bakeTouchedStamps = (world: WorldData, state: TerrainEditState, brush: TerrainBrushStroke,
  editable?: (x: number, z: number) => boolean) => {
  const touched = state.stamps.filter(stamp => {
    const b = getStampBounds(stamp);
    if (b.minX > brush.x + brush.radius || b.maxX < brush.x - brush.radius ||
      b.minZ > brush.z + brush.radius || b.maxZ < brush.z - brush.radius) return false;
    if (!editable) return true;
    for (let z = Math.max(0, Math.floor(b.minZ)); z <= Math.min(world.cellsZ, Math.ceil(b.maxZ)); z++)
      for (let x = Math.max(0, Math.floor(b.minX)); x <= Math.min(world.cellsX, Math.ceil(b.maxX)); x++)
        if (editable(x, z)) return true;
    return false;
  });
  if (!touched.length) return;
  for (const stamp of touched) {
    const b = getStampBounds(stamp), stride = world.cellsX + 1;
    for (let z = Math.max(0, Math.floor(b.minZ)); z <= Math.min(world.cellsZ, Math.ceil(b.maxZ)); z++)
      for (let x = Math.max(0, Math.floor(b.minX)); x <= Math.min(world.cellsX, Math.ceil(b.maxX)); x++) {
        const i = z * stride + x;
        state.base!.heights[i] = world.heights[i]!;
        state.base!.waterSurface[i] = world.waterSurface[i]!;
        state.base!.splat.set(world.splat.subarray(i * MATERIAL_COUNT, (i + 1) * MATERIAL_COUNT), i * MATERIAL_COUNT);
        state.rise![i] = state.ring![i] = 0;
        state.lake![i] = 0;
      }
    state.stampProps.delete(stamp.id);
  }
  state.stamps = state.stamps.filter(stamp => !touched.includes(stamp));
};

/** Points inland, inferred from nearby elevations; works on rotated and irregular coastlines. */
const inlandDirection = (world: WorldData, brush: TerrainBrushStroke) => {
  let x = 0, z = 0;
  for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI / 16, dx = DMath.cos(angle), dz = DMath.sin(angle);
    const height = sampleSmooth(world, world.heights,
      Math.max(0, Math.min(world.cellsX, brush.x + dx * (brush.radius + 6))),
      Math.max(0, Math.min(world.cellsZ, brush.z + dz * (brush.radius + 6))));
    const vote = Math.max(-3, Math.min(3, height - world.seaLevel));
    x += dx * vote; z += dz * vote;
  }
  const length = DMath.hypot(x, z);
  return length > .01 ? { x: x / length, z: z / length } : null;
};

/** Native feathering reach, exposed for bounded editor previews before any mutation. */
export const terrainBrushBounds = (world: WorldData, brush: TerrainBrushStroke) => {
  const mode = brush.mode ?? "reset", shaped = mode === "reset" || mode === "beach" || mode === "sea";
  let bank = shaped ? 8 : 0;
  if (mode === "reset" || mode === "sea") {
    const target = world.seaLevel + (mode === "reset" ? 2 : -3);
    // Deep seabed or tall old cliffs need more transition room than shallow water.
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const height = sampleSmooth(world, world.heights,
        Math.max(0, Math.min(world.cellsX, brush.x + DMath.cos(angle) * (brush.radius + 8))),
        Math.max(0, Math.min(world.cellsZ, brush.z + DMath.sin(angle) * (brush.radius + 8))));
      bank = Math.max(bank, Math.ceil(Math.abs(height - target) * 3));
    }
  }
  const reach = brush.radius + bank;
  const cells = getCircleRegion(world, brush.x, brush.z, reach);
  return { cells, reach };
};

/**
 * Local editable heights, with the baseline, water and material kept in sync for save/undo.
 * `fade` (0..1 per vertex) scales the change, e.g. a taper towards protected ground.
 */
export const applyTerrainBrush = (world: WorldData, state: TerrainEditState, brush: TerrainBrushStroke,
  canEdit?: (x: number, z: number) => boolean, fade?: (x: number, z: number) => number) => {
  const mode = brush.mode ?? "reset", shaped = mode === "reset" || mode === "beach" || mode === "sea";
  const { cells, reach } = terrainBrushBounds(world, brush);
  const stride = world.cellsX + 1, width = cells.maxX - cells.minX + 2;
  const source = new Float32Array(width * (cells.maxZ - cells.minZ + 2));
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++)
    source.set(world.heights.subarray(z * stride + cells.minX, z * stride + cells.maxX + 2), (z - cells.minZ) * width);
  const read = (x: number, z: number) => source[(Math.max(cells.minZ, Math.min(cells.maxZ + 1, z)) - cells.minZ) * width +
    Math.max(cells.minX, Math.min(cells.maxX + 1, x)) - cells.minX]!;
  const edited = new Uint8Array(source.length);
  const editable = (x: number, z: number) => x >= cells.minX && x <= cells.maxX + 1 &&
    z >= cells.minZ && z <= cells.maxZ + 1 && !!edited[(z - cells.minZ) * width + x - cells.minX];
  const strength = Math.max(0, Math.min(2, brush.strength ?? 1));
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++) {
    const i = z * stride + x;
    if (strength <= 0 || (canEdit && !canEdit(x, z)) || DMath.hypot(x - brush.x, z - brush.z) >= reach ||
      (brush.protectCoast && (read(x, z) <= world.seaLevel + 1 || world.waterDepth[i]! > .05))) continue;
    edited[(z - cells.minZ) * width + x - cells.minX] = 1;
  }
  bakeTouchedStamps(world, state, { ...brush, radius: reach }, editable);
  // Cell effects require all corners to be editable, so a protected shore/wet corner is never erased indirectly.
  const editableCell = (x: number, z: number) => editable(x, z) && editable(x + 1, z) &&
    editable(x, z + 1) && editable(x + 1, z + 1);
  const inland = mode === "beach" ? inlandDirection(world, brush) : null;
  const weights = new Float32Array(MATERIAL_COUNT);
  let waterChanged = false;
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++) {
    const distance = DMath.hypot(x - brush.x, z - brush.z);
    if (!editable(x, z)) continue;
    const i = z * stride + x, previous = read(x, z);
    const weight = shaped ? 1 - smoothstep(brush.radius, reach, distance) : 1 - smoothstep(0, brush.radius, distance);
    let target = previous;
    if (mode === "flatten") target = brush.targetHeight ?? world.seaLevel + 2;
    if (mode === "reset") target = world.seaLevel + 2;
    if (mode === "sea") target = world.seaLevel - 3;
    if (mode === "raise" || mode === "lower") target += mode === "raise" ? .2 : -.2;
    if (mode === "roughen") target += .12 * DMath.sin(x * .47 + world.seed) * DMath.cos(z * .41 - world.seed);
    if (mode === "smooth") {
      let total = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) total += read(x + dx, z + dz);
      target = previous + (total / 25 - previous) * .65;
    }
    if (mode === "beach") {
      // A broad low beach between a flat dry foundation and deep offshore water.
      const along = inland ? (x - brush.x) * inland.x + (z - brush.z) * inland.z : brush.radius * .45 - distance;
      target = world.seaLevel + Math.max(-3, Math.min(1.8, .15 + along * .18));
    }
    const blend = (mode === "raise" || mode === "lower" || mode === "roughen" ? weight * strength :
      Math.min(1, weight * strength)) * (fade?.(x, z) ?? 1);
    const blended = previous + (target - previous) * blend;
    const height = brush.protectCoast ? Math.max(world.seaLevel + 1, blended) : blended;
    world.heights[i] = state.base!.heights[i] = height;
    state.rise![i] = state.ring![i] = 0;
    state.lake![i] = 0;
    const surface = shaped ? world.seaLevel : world.waterSurface[i]!;
    const depth = Math.max(0, surface - height);
    waterChanged ||= Math.abs(world.waterDepth[i]! - depth) > .00001 ||
      Math.abs(world.waterSurface[i]! - surface) > .00001 || (shaped && world.lakeWater![i] !== 0);
    world.waterSurface[i] = state.base!.waterSurface[i] = surface;
    world.waterDepth[i] = depth;
    if (shaped) world.lakeWater![i] = 0;
    if (mode === "reset" || mode === "beach" || mode === "sea") {
      readSplatWeights(world.splat, i, weights);
      blendTowardMaterial(weights, mode === "reset" ? MATERIAL.grass : MATERIAL.sand, weight);
      writeSplatWeights(world.splat, i, weights);
      state.base!.splat.set(world.splat.subarray(i * MATERIAL_COUNT, (i + 1) * MATERIAL_COUNT), i * MATERIAL_COUNT);
    }
  }
  const clear = mode === "beach" || mode === "sea";
  const removed = clear ? removePropsInBrush(world, { ...brush, radius: reach, softness: 0 }, index => {
    const x = world.props.x[index]!, z = world.props.z[index]!;
    return editableCell(Math.floor(x), Math.floor(z)) &&
      (DMath.hypot(x - brush.x, z - brush.z) <= brush.radius ||
        sampleSmooth(world, world.waterDepth, x, z) > .05);
  }).removed : [];
  const painted = shaped ? listPaintedCells(world, { ...brush, softness: 0 })
    .map(entry => entry.cell).filter(cell => editableCell(cell % world.cellsX, Math.floor(cell / world.cellsX))) : [];
  const mineChanged = painted.length > 0 && removeMineLand(world, painted).size > 0;
  return { cells, removed, waterChanged, mineChanged };
};
