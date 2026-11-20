import { DMath } from "../shared/math/deterministic-math";
import { THEME_COUNT } from "../shared/world/generation/island-themes";
import { createThemeSampler } from "../shared/world/generation/theme-field";
import { sampleSmooth } from "../shared/world/grid-geometry";
import { GROUND_VARIANT_COUNT } from "../shared/world/ground-variants";
import { removePlanarOcclusion } from "../shared/world/lighting";
import { clamp } from "../shared/world/noise";
import { FOG, MATERIAL_COUNT, type WorldData } from "../shared/world/world-data";
import { getCanopyField, getLitterField, LITTER_CHANNELS } from "./canopy-field";
import { getGroundZoneField, GROUND_ZONE_CHANNELS } from "./ground-zone-field";
import { getMineVertexField, type MineVertexField } from "./mine-field";
import { createFaceUpright, type FaceUpright, type VertexRegion } from "./rocks/face-upright";
import { getRockContact, shiftToRockBuffer } from "./rocks/rock-contact";
import { getSurfaceMask, SURFACE_CHANNELS } from "./surface-mask";

/** Render mesh vertices per gameplay cell edge (2 = four render quads per cell). */
export const RENDER_SUBDIVISION = 2;

const FOG_BLUR = 2;

/** Surface used for vertex heights: "terrain" the ground, "water" the water surface mesh. */
export type SurfaceMode = "terrain" | "water";

/** Per vertex render attributes in flat arrays (the terrain and water chunk layout). */
export interface VertexAttributes {
  normals: Float32Array;
  positions: Float32Array;
  /** sun visibility, ambient occlusion, fog visibility, canopy shade (bytes). */
  shading: Uint8Array;
  splatA: Uint8Array;
  splatB: Uint8Array;
  /** Mine ground weight, ore code (mine-field.ts), ore left, spare (bytes). */
  splatC: Uint8Array;
  /** Surface mask (surface-mask.ts): wetness, coast type, talus, dryness (bytes; zero on water meshes). */
  surface: Uint8Array;
  /**
   * Island theme weights of the first three themes (ISLAND_THEMES order, bytes; the snowy weight is the rest of 255,
   * getThemeWeights) and, in w, the editor's tilled-soil paint (zero on water meshes). Packed so the ground keeps its
   * vertex buffer count (WebGPU allows 8 buffers).
   */
  theme: Uint8Array;
  /** Editor-painted photo-tile ground variants (ground-variants.ts; zero without paint and on water meshes). */
  variant: Uint8Array;
  /**
   * Crown litter (canopy-field.ts: pine needles, broadleaf litter) and the ground zones (ground-zone-field.ts:
   * mountain foot, dune zone); terrain surface only.
   */
  litter: Uint8Array;
  /** signed water depth (negative on land, so the shoreline interpolates), coast, flow x, z. */
  water: Float32Array;
}

export const createVertexAttributes = (count: number): VertexAttributes => ({
  normals: new Float32Array(count * 3),
  positions: new Float32Array(count * 3),
  shading: new Uint8Array(count * 4),
  splatA: new Uint8Array(count * 4),
  splatB: new Uint8Array(count * 4),
  splatC: new Uint8Array(count * 4),
  surface: new Uint8Array(count * SURFACE_CHANNELS),
  theme: new Uint8Array(count * THEME_COUNT),
  variant: new Uint8Array(count * 4),
  litter: new Uint8Array(count * 4),
  water: new Float32Array(count * 4)
});

export interface VertexFogWorkspace {
  vertices: Float32Array;
  sums: Uint32Array;
}

/** The same clipped box blur, using four summed-area reads instead of 36 cell reads per vertex. */
export const createVertexFog = (world: WorldData, workspace?: VertexFogWorkspace) => {
  const stride = world.cellsX + 1;
  const count = stride * (world.cellsZ + 1);
  const fog = workspace?.vertices ?? new Float32Array(count);
  const sums = workspace?.sums ?? new Uint32Array(count);
  if (fog.length !== count || sums.length !== count) throw new Error("Invalid vertex fog workspace");
  if (world.fogDisplayDisabled) { fog.fill(1); return fog; }
  sums.fill(0, 0, stride);
  for (let z = 0; z < world.cellsZ; z++) {
    const row = (z + 1) * stride;
    let total = 0;
    sums[row] = 0;
    for (let x = 0; x < world.cellsX; x++) {
      total += world.fog[z * world.cellsX + x]!;
      sums[row + x + 1] = sums[row - stride + x + 1]! + total;
    }
  }
  for (let vertexZ = 0; vertexZ <= world.cellsZ; vertexZ += 1) {
    const top = Math.max(0, vertexZ - FOG_BLUR - 1);
    const bottom = Math.min(world.cellsZ, vertexZ + FOG_BLUR + 1);
    for (let vertexX = 0; vertexX <= world.cellsX; vertexX += 1) {
      const left = Math.max(0, vertexX - FOG_BLUR - 1);
      const right = Math.min(world.cellsX, vertexX + FOG_BLUR + 1);
      const samples = (right - left) * (bottom - top);
      const sum = sums[bottom * stride + right]! - sums[top * stride + right]!
        - sums[bottom * stride + left]! + sums[top * stride + left]!;
      fog[vertexZ * stride + vertexX] = samples > 0 ? sum / FOG.visible / samples : 0;
    }
  }
  return fog;
};

interface Bilinear {
  i00: number;
  i01: number;
  i10: number;
  i11: number;
  w00: number;
  w01: number;
  w10: number;
  w11: number;
}

const getBilinear = (world: WorldData, x: number, z: number, out: Bilinear) => {
  const stride = world.cellsX + 1;
  const cx = clamp(x, 0, world.cellsX - 1e-4);
  const cz = clamp(z, 0, world.cellsZ - 1e-4);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fz = cz - z0;
  out.i00 = z0 * stride + x0;
  out.i10 = out.i00 + 1;
  out.i01 = out.i00 + stride;
  out.i11 = out.i01 + 1;
  out.w00 = (1 - fx) * (1 - fz);
  out.w10 = fx * (1 - fz);
  out.w01 = (1 - fx) * fz;
  out.w11 = fx * fz;
};

const mixValue = (values: ArrayLike<number>, b: Bilinear, stride = 1, offset = 0) =>
  (values[b.i00 * stride + offset] as number) * b.w00 +
  (values[b.i10 * stride + offset] as number) * b.w10 +
  (values[b.i01 * stride + offset] as number) * b.w01 +
  (values[b.i11 * stride + offset] as number) * b.w11;

const getSurfaceY = (mode: SurfaceMode, ground: number, water: number) =>
  mode === "water" ? water : ground;

const writeNormal = (target: Float32Array, offset: number, world: WorldData, b: Bilinear) => {
  const x = mixValue(world.normals, b, 3, 0);
  const y = mixValue(world.normals, b, 3, 1);
  const z = mixValue(world.normals, b, 3, 2);
  const length = DMath.hypot(x, y, z) || 1;
  target[offset] = x / length;
  target[offset + 1] = y / length;
  target[offset + 2] = z / length;
};

/** Splat weights of the vertex being sampled (reused, no allocation per vertex). */
const splatScratch = new Float32Array(MATERIAL_COUNT);

/** Mixes the world splat weights at the sampled point into the scratch weights. */
const mixSplat = (world: WorldData, b: Bilinear) => {
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    splatScratch[material] = mixValue(world.splat, b, MATERIAL_COUNT, material);
  }
};

/** splatA / splatB / splatC hold four materials each, in material order. */
const SPLAT_TARGETS = ["splatA", "splatB", "splatC"] as const;

/** Writes the scratch weights as bytes (clamped: a rounded 255.5 must not wrap to 0). */
const writeSplat = (attributes: VertexAttributes, local: number) => {
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    const weight = Math.min(255, Math.round(splatScratch[material]!));
    attributes[SPLAT_TARGETS[material >> 2]!][local * 4 + (material & 3)] = weight;
  }
};

/** Ore code and ore left of the nearest zone vertex (constant over a zone, no blending). */
const writeMineData = (
  attributes: VertexAttributes,
  local: number,
  mine: MineVertexField,
  b: Bilinear
) => {
  const nearest = [b.i00, b.i10, b.i01, b.i11][
    [b.w00, b.w10, b.w01, b.w11].reduce((best, w, i, all) => (w > all[best]! ? i : best), 0)
  ]!;
  attributes.splatC[local * 4 + 1] = mine.ore[nearest]!;
  attributes.splatC[local * 4 + 2] = Math.round(mixValue(mine.amount, b));
  attributes.splatC[local * 4 + 3] = Math.round(mixValue(mine.glint, b));
};

/** Mixes the surface mask (terrain surface only: the water mesh does not read it). */
const writeSurface = (attributes: VertexAttributes, local: number, mask: Uint8Array, b: Bilinear) => {
  for (let channel = 0; channel < SURFACE_CHANNELS; channel += 1) {
    attributes.surface[local * SURFACE_CHANNELS + channel] =
      Math.round(mixValue(mask, b, SURFACE_CHANNELS, channel));
  }
};

/** Mixes the first three theme weights of the ground palette (terrain surface only); w is the tilled paint. */
const writeTheme = (attributes: VertexAttributes, local: number, weights: Uint8Array, b: Bilinear) => {
  for (let channel = 0; channel < THEME_COUNT - 1; channel += 1) {
    attributes.theme[local * 4 + channel] = Math.round(mixValue(weights, b, THEME_COUNT, channel));
  }
  attributes.theme[local * 4 + 3] = 0;
};

/** Mixes the editor's painted ground variants: the photo tiles into variant, the tilled soil into theme.w. */
const writeVariant = (attributes: VertexAttributes, local: number, variants: Uint8Array, b: Bilinear) => {
  for (let channel = 0; channel < GROUND_VARIANT_COUNT; channel += 1) {
    const value = Math.round(mixValue(variants, b, GROUND_VARIANT_COUNT, channel));
    if (channel < 4) attributes.variant[local * 4 + channel] = value;
    else attributes.theme[local * 4 + 3] = value;
  }
};

/** Mixes the crown litter and the ground zones after it (terrain surface only). */
const writeLitter = (attributes: VertexAttributes, local: number, litter: Float32Array, zones: Float32Array,
  b: Bilinear) => {
  for (let channel = 0; channel < LITTER_CHANNELS; channel += 1) {
    attributes.litter[local * 4 + channel] = Math.round(mixValue(litter, b, LITTER_CHANNELS, channel) * 255);
  }
  for (let channel = 0; channel < GROUND_ZONE_CHANNELS; channel += 1) {
    attributes.litter[local * 4 + LITTER_CHANNELS + channel] =
      Math.round(mixValue(zones, b, GROUND_ZONE_CHANNELS, channel) * 255);
  }
};

/** No rock contact: a quick preview of edited terrain (the worker rebuild brings the band). */
const NO_ROCK_CONTACT = { contact: () => 0, mountain: () => 0, rockness: () => 0 };

/**
 * Upright rock faces of the terrain surface (render only, rocks/face-upright.ts): a full build of
 * a region's ground; water surfaces and the editor's instant preview keep the plain heightfield.
 */
const getFaceUpright = (world: WorldData, mode: SurfaceMode, preview: boolean, region?: VertexRegion) =>
  mode === "terrain" && !preview && region ? createFaceUpright(world, region) : undefined;

/** Moves a terrain vertex by the upright field and bends its normal to the moved surface. */
const applyFaceUpright = (
  upright: FaceUpright,
  world: WorldData,
  attributes: VertexAttributes,
  local: number,
  shift: Float32Array
) => {
  const x = attributes.positions[local * 3]!, z = attributes.positions[local * 3 + 2]!;
  upright.shift(x, z, shift);
  attributes.positions[local * 3] = x + shift[0]!;
  attributes.positions[local * 3 + 2] = z + shift[1]!;
  upright.bendNormal(x, z, (u, v) => sampleSmooth(world, world.heights, u, v), attributes.normals, local * 3);
};

/**
 * Creates a sampler that fills one render vertex at fractional world coordinates; `preview`
 * leaves the rock contact band out (map editor: an instant look at new heights). `region` (the
 * chunk's vertices) enables the upright rock faces of the terrain surface.
 */
export const createVertexSampler = (
  world: WorldData,
  fog: Float32Array,
  mode: SurfaceMode,
  preview = false,
  region?: VertexRegion
) => {
  const bilinear: Bilinear = { i00: 0, i01: 0, i10: 0, i11: 0, w00: 0, w01: 0, w10: 0, w11: 0 };
  const canopy = getCanopyField(world);
  const litter = getLitterField(world);
  const zones = getGroundZoneField(world);
  const rockContact = preview ? NO_ROCK_CONTACT : getRockContact(world);
  const theme = createThemeSampler(world, world.themeWeights);
  const mine = getMineVertexField(world);
  const upright = getFaceUpright(world, mode, preview, region);
  const surface = mode === "terrain" ? getSurfaceMask(world, preview) : undefined;
  const shift = new Float32Array(2);
  return (attributes: VertexAttributes, local: number, x: number, z: number) => {
    getBilinear(world, x, z, bilinear);
    const ground = sampleSmooth(world, world.heights, x, z);
    const water = mixValue(world.waterSurface, bilinear);
    attributes.positions[local * 3] = x;
    attributes.positions[local * 3 + 1] = getSurfaceY(mode, ground, water);
    attributes.positions[local * 3 + 2] = z;
    writeNormal(attributes.normals, local * 3, world, bilinear);
    const occlusion = removePlanarOcclusion(mixValue(world.ambientOcclusion, bilinear),
      attributes.normals[local * 3]!, attributes.normals[local * 3 + 1]!, attributes.normals[local * 3 + 2]!);
    if (upright?.active) applyFaceUpright(upright, world, attributes, local, shift);
    mixSplat(world, bilinear);
    const contact = rockContact.contact(x, z);
    // Where rock meets the ground, green turns into pebbles and soil (the ground chain).
    if (contact > 0) {
      shiftToRockBuffer(splatScratch, contact, theme.at(x, z).rockBuffer, rockContact.mountain(x, z));
    }
    writeSplat(attributes, local);
    writeMineData(attributes, local, mine, bilinear);
    if (surface) {
      writeSurface(attributes, local, surface, bilinear);
      writeTheme(attributes, local, world.themeWeights, bilinear);
      if (world.groundVariants) writeVariant(attributes, local, world.groundVariants, bilinear);
      writeLitter(attributes, local, litter, zones, bilinear);
    }
    attributes.shading[local * 4] = Math.round(mixValue(world.sunShadow, bilinear));
    attributes.shading[local * 4 + 1] = Math.round(occlusion);
    attributes.shading[local * 4 + 2] = Math.round(mixValue(fog, bilinear) * 255);
    attributes.shading[local * 4 + 3] = Math.round(mixValue(canopy, bilinear) * 255);
    attributes.water[local * 4] = water - ground;
    attributes.water[local * 4 + 1] = mixValue(world.coastDistance, bilinear);
    attributes.water[local * 4 + 2] = mixValue(world.flow, bilinear, 2, 0);
    attributes.water[local * 4 + 3] = mixValue(world.flow, bilinear, 2, 1);
  };
};
