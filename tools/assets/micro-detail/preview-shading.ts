import type { AtlasMip } from "../../../src/render-common/baker/atlas-mips";
import { toByte } from "../../../src/render-common/color";
import { getMicroDetailAtlasUv,   MICRO_DETAIL_TILE_SIZE, MICRO_DETAIL_UNITS,type MicroClass } from "../../../src/render-common/materials/micro-detail";

/**
 * CPU mirror of the ground near band for the review previews (not a game capture, O9): base tile
 * texel, then either today's self-similar detail normal or the T06b micro detail, then a display
 * space wrapped-Lambert + sky light like `lightGround`.
 */

const SUN = (() => {
  const sun = [-0.42, 0.78, 0.46], length = Math.hypot(...sun);
  return sun.map(value => value / length) as [number, number, number];
})();
const SUN_LIGHT = 0.82;
const SKY_LIGHT = 0.42;
/** Today's near detail (`ground-glsl.ts`): the base normal at 3.3× under DETAIL_ROTATION. */
const DETAIL_SCALE = 3.3;
/** T06b card constants. */
const MICRO_NORMAL_STRENGTH = 0.6;
const MICRO_ALBEDO_STRENGTH = 0.5;
/** Centred cavity: occlusion × (1 + (height − 0.5) × strength), mean ×1.0 (heights average 0.5). */
const MICRO_CAVITY_STRENGTH = 0.18;
const MICRO_TEXELS_PER_UNIT = MICRO_DETAIL_TILE_SIZE / MICRO_DETAIL_UNITS;
const MAX_ANISOTROPY = 8;

export type NearMode = "micro" | "today";

const texelOf = (level: AtlasMip, x: number, y: number, wrap: boolean) => {
  const tx = wrap ? ((x % level.width) + level.width) % level.width : Math.min(level.width - 1, Math.max(0, x));
  const ty = wrap ? ((y % level.height) + level.height) % level.height : Math.min(level.height - 1, Math.max(0, y));
  return (ty * level.width + tx) * 4;
};

/** Bilinear RGBA 0..1 at texture uv; `wrap` repeats (tiles) or clamps (padded atlas). */
const sampleBilinear = (level: AtlasMip, u: number, v: number, wrap: boolean, out: Float32Array, weight: number) => {
  const x = u * level.width - 0.5, y = v * level.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = texelOf(level, x0, y0, wrap), b = texelOf(level, x0 + 1, y0, wrap);
  const c = texelOf(level, x0, y0 + 1, wrap), d = texelOf(level, x0 + 1, y0 + 1, wrap);
  for (let channel = 0; channel < 4; channel += 1) {
    const top = level.data[a + channel]! + (level.data[b + channel]! - level.data[a + channel]!) * fx;
    const bottom = level.data[c + channel]! + (level.data[d + channel]! - level.data[c + channel]!) * fx;
    out[channel] = out[channel]! + ((top + (bottom - top) * fy) / 255) * weight;
  }
};

/** Trilinear sample (mip `lod` clamped to the chain). */
export const sampleTrilinear = (levels: readonly AtlasMip[], u: number, v: number, lod: number, wrap: boolean,
  out: Float32Array) => {
  out.fill(0);
  const clamped = Math.min(levels.length - 1, Math.max(0, lod));
  const first = Math.floor(clamped), blend = clamped - first;
  sampleBilinear(levels[first]!, u, v, wrap, out, 1 - blend);
  if (blend > 0) sampleBilinear(levels[Math.min(levels.length - 1, first + 1)]!, u, v, wrap, out, blend);
  return out;
};

/** Mip level of an anisotropic sample: the major axis divided by the anisotropy ratio (max 8). */
export const anisotropicLod = (major: number, minor: number, texelsPerUnit: number) => {
  const ratio = Math.min(MAX_ANISOTROPY, major / Math.max(1e-9, minor));
  return Math.log2(Math.max(1e-9, (major / ratio) * texelsPerUnit));
};

/** The ground's near weight: footprint in world units per pixel (`ground-glsl.ts`). */
export const nearWeight = (footprint: number) => {
  const t = Math.min(1, Math.max(0, (footprint - 0.005) / 0.006));
  return 1 - t * t * (3 - 2 * t);
};

export interface BaseGround {
  albedo: readonly AtlasMip[];
  normal: readonly AtlasMip[];
  /** World units per repeat (MATERIAL_TILE_UNITS). */
  units: number;
}

export interface NearSampleInput {
  footprint: { major: number; minor: number };
  microAtlas: readonly AtlasMip[];
  microClass: MicroClass;
  mode: NearMode;
  x: number;
  z: number;
}

const scratch = { albedo: new Float32Array(4), detail: new Float32Array(4), normal: new Float32Array(4) };

const applyNear = (base: BaseGround, input: NearSampleInput, near: number, surface: number[], albedo: number[]) => {
  const { detail } = scratch, { major, minor } = input.footprint;
  if (input.mode === "today") {
    const u = (input.x / base.units) * DETAIL_SCALE, v = (input.z / base.units) * DETAIL_SCALE;
    const lod = anisotropicLod(major, minor, (base.albedo[0]!.width / base.units) * DETAIL_SCALE);
    sampleTrilinear(base.normal, 0.8 * u - 0.6 * v, 0.6 * u + 0.8 * v, lod, true, detail);
    surface[0] = surface[0]! + (detail[0]! * 2 - 1) * 0.6 * near;
    surface[1] = surface[1]! + (detail[1]! * 2 - 1) * 0.6 * near;
    surface[2] = surface[2]! * (1 + (detail[2]! - 1) * 0.35 * near);
    return;
  }
  const [u, v] = getMicroDetailAtlasUv(input.microClass, input.x, input.z);
  sampleTrilinear(input.microAtlas, u, v, anisotropicLod(major, minor, MICRO_TEXELS_PER_UNIT), false, detail);
  surface[0] = surface[0]! + (detail[0]! * 2 - 1) * MICRO_NORMAL_STRENGTH * near;
  surface[1] = surface[1]! + (detail[1]! * 2 - 1) * MICRO_NORMAL_STRENGTH * near;
  surface[2] = surface[2]! * (1 + (detail[3]! - 0.5) * MICRO_CAVITY_STRENGTH * near);
  const multiplier = 1 + (detail[2]! * 2 - 1) * MICRO_ALBEDO_STRENGTH * near;
  for (let channel = 0; channel < 3; channel += 1) albedo[channel] = albedo[channel]! * multiplier;
};

/** Lit display RGB bytes of one ground point, written to `out` at `offset`. */
export const shadeGroundPoint = (base: BaseGround, input: NearSampleInput, out: Uint8Array, offset: number) => {
  const { albedo: albedoSample, normal } = scratch, { major, minor } = input.footprint;
  const u = input.x / base.units, v = input.z / base.units;
  const lod = anisotropicLod(major, minor, base.albedo[0]!.width / base.units);
  sampleTrilinear(base.albedo, u, v, lod, true, albedoSample);
  sampleTrilinear(base.normal, u, v, lod, true, normal);
  const surface = [normal[0]! * 2 - 1, normal[1]! * 2 - 1, normal[2]!];
  const albedo = [albedoSample[0]!, albedoSample[1]!, albedoSample[2]!];
  const near = nearWeight(major);
  if (near > 0) applyNear(base, input, near, surface, albedo);
  const nx = surface[0]! * 0.95, nz = surface[1]! * 0.95, length = Math.hypot(nx, 1, nz);
  const diffuse = Math.max(0, (nx * SUN[0] + SUN[1] + nz * SUN[2]) / length);
  const occlusion = surface[2]!, cavity = 1 - 0.5 * (1 - occlusion);
  const light = SUN_LIGHT * diffuse + SKY_LIGHT * occlusion;
  for (let channel = 0; channel < 3; channel += 1) out[offset + channel] = toByte(albedo[channel]! * cavity * light);
  out[offset + 3] = 255;
};
