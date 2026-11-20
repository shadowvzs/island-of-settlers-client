import { NOISE_LATTICE } from "../../../../render-common/noise-textures";
import { ROCK_PLANE_SECTOR, ROCK_PLANE_SECTORS, ROCK_PLANE_SOFTNESS,
  ROCK_PLANE_STRENGTH, ROCK_PLANE_TILT, ROCK_STONE_DETAIL_SCALE,
  ROCK_TILE } from "../../../../render-common/shaders/rock-tuning";
import { SNOW_PALETTE } from "../../../../render-common/snow-palette";
import { PREVAILING_WIND_DIRECTION } from "../../../../shared/world/prevailing-wind";
import { lightSurface, type LightingReferenceInputs } from "./lighting";
import { fbm3, valueNoise, valueNoise4 } from "./noise";

/** CPU mirrors of the TSL rock kernels (`webgpu/tsl/rock-*.ts`), for the parity bench. */
export type V3 = readonly [number, number, number];
type V2 = readonly [number, number];

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const fract = (value: number) => value - Math.floor(value);
export const glslMod = (value: number, modulus: number) =>
  value - modulus * Math.floor(value / modulus);
export const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const smoothstepDesc = (high: number, low: number, value: number) =>
  1 - smoothstep(low, high, value);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 =>
  [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: V3, b: V3): V3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length3 = (a: V3) => Math.hypot(...a);
const normalize3 = (a: V3): V3 => scale3(a, 1 / Math.max(length3(a), 1e-12));

export const hashRockId = (id: number) => fract(Math.sin(id * 12.9898 + 4.1) * 43758.5453);

const softSnap = (value: number) => {
  const tread = Math.floor(value);
  return tread + smoothstep(0.5 - ROCK_PLANE_SOFTNESS, 0.5 + ROCK_PLANE_SOFTNESS, value - tread);
};

const getPlaneTone = (sector: number) => {
  const tread = Math.floor(sector);
  const next = smoothstep(0.5 - ROCK_PLANE_SOFTNESS, 0.5 + ROCK_PLANE_SOFTNESS, sector - tread);
  return mix(hashRockId(glslMod(tread, ROCK_PLANE_SECTORS)),
    hashRockId(glslMod(tread + 1, ROCK_PLANE_SECTORS)), next);
};

const getRiser = (value: number) =>
  smoothstepDesc(ROCK_PLANE_SOFTNESS + 0.08, 0, Math.abs(fract(value) - 0.5));

export interface ReferencePlanes {
  edge: number;
  normal: V3;
  tone: number;
}

/** `getRockPlanes` (rock-form-glsl.ts): broad plane snapping of a normal (strength 0..1). */
export const getRockPlanes = (normalInput: V3, turn: number,
  strength: number): ReferencePlanes => {
  const normal = normalize3(normalInput);
  const offset = (turn - 0.5) * 2.4;
  const turnCos = Math.cos(offset);
  const turnSin = Math.sin(offset);
  const turnedX = turnCos * normal[0] - turnSin * normal[2];
  const turnedZ = turnSin * normal[0] + turnCos * normal[2];
  const sector = Math.atan2(turnedZ, turnedX) / ROCK_PLANE_SECTOR;
  const tilt = Math.atan2(normal[1], Math.hypot(normal[0], normal[2])) / ROCK_PLANE_TILT;
  const azimuth = mix(sector, softSnap(sector), strength) * ROCK_PLANE_SECTOR - offset;
  const elevation = mix(tilt, softSnap(tilt), strength) * ROCK_PLANE_TILT;
  const plane: V3 = [Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation),
    Math.sin(azimuth) * Math.cos(elevation)];
  const wall = 1 - smoothstep(0.75, 0.95, normal[1]);
  const edge = Math.max(getRiser(sector) * wall, getRiser(tilt));
  const tone = (getPlaneTone(sector) * 2 - 1) * wall;
  return { edge: edge * strength, normal: plane, tone: tone * strength };
};

export interface ReferenceStrata {
  band: number;
  lip: number;
  seam: number;
}

/**
 * `getStrata` with an explicit derivative footprint (the GLSL reads `fwidth(layer)`; the parity
 * bench passes the footprint the constant-sample rows produce).
 */
export const getStrata = (world: V3, normal: V3, warp: number, broken: number,
  footprintInput: number): ReferenceStrata => {
  const dip = (warp - 0.5) * 4 + world[0] * 0.06 - world[2] * 0.035 + normal[1] * 0.35;
  const height = world[1] + dip;
  const layer = height * 0.55 + Math.sin(height * 0.37 + 1.7) * 0.3;
  const index = Math.floor(layer);
  const within = layer - index;
  const band = mix(hashRockId(index), hashRockId(index + 1), smoothstep(0.86, 1, within));
  const footprint = Math.max(footprintInput, 1e-4);
  const width = 0.02 + hashRockId(index + 31) * 0.05;
  const present = smoothstep(0.4, 0.58, broken + hashRockId(index + 57) * 0.3 - 0.15);
  const distance = Math.min(within, 1 - within);
  const line = 1 - smoothstep(width - footprint, width + footprint, distance);
  const shade = 1 - smoothstep(0, width * 4 + footprint, within);
  const seam = (line * Math.min(width / footprint, 1) * 0.5 + shade * 0.5) * present;
  const lip = smoothstep(0.78, 0.94, within) * (1 - line) * present;
  return { band, lip, seam };
};

const SNOW_WIND = [PREVAILING_WIND_DIRECTION.x, PREVAILING_WIND_DIRECTION.z] as const;

export const getSnowLee = (normal: V3) => {
  const across = normalize3([normal[0] + 1e-4, 0, normal[2]]);
  return (across[0] * SNOW_WIND[0] + across[2] * SNOW_WIND[1]) * (1 - normal[1]);
};

/** `getSnowCover` with the snow line passed in (the material supplies it from the snow map). */
export const getSnowCover = (world: V3, normal: V3, mask: readonly [number, number, number, number],
  materials: readonly [number, number, number, number], patches: V2, snowLine: number) => {
  const lee = getSnowLee(normal);
  const line = snowLine + (patches[0] - 0.5) * 1.2 - lee * 0.3;
  const altitude = smoothstep(line - 0.12, line + 0.45, world[1]);
  if (altitude <= 0) return 0;
  const stone = (materials[1] - materials[0]) * 0.35;
  const hold = normal[1] + (patches[0] - 0.5) * 0.22 + lee * 0.14 + mask[3] * 0.06 + stone;
  const lying = smoothstep(0.72, 0.94, hold + (patches[1] - 0.5) * 0.25);
  const edge = lying * (1 - lying) * 4;
  const speckle = (materials[1] - 0.5) * 1.4 + (materials[2] - 0.5) * 0.6;
  const cover = smoothstep(0.3, 0.7, lying + speckle * edge * 0.9);
  const specks = smoothstep(0.56, 0.68, materials[1] + (patches[1] - 0.5) * 0.5);
  const dusting = smoothstep(0.65, 0.84, hold) * specks;
  return altitude * Math.max(cover, dusting * 0.5);
};

export const getSnowNormal = (normal: V3): V3 => normalize3([normal[0], normal[1] + 0.35, normal[2]]);

export const getSnowColor = (world: V3, normal: V3, patches: V2): V3 => {
  const warp = (patches[0] - 0.5) * 6 + (patches[1] - 0.5) * 4;
  const along = world[0] * SNOW_WIND[0] + world[2] * SNOW_WIND[1];
  const ripples = Math.sin(along * 3.1 + world[1] * 0.8 + warp) * 0.5 + 0.5;
  const tone = 0.54 + smoothstep(0.4, 0.7, patches[1]) * 0.05 - ripples * 0.035;
  const lee = clamp(getSnowLee(normal) * 2);
  const turned = 1 - smoothstep(0.75, 0.98, normal[1]);
  const snowTint = mix3([1, 1, 1], SNOW_PALETTE.rockLee, Math.max(lee * 0.6, turned * 0.7));
  return scale3(snowTint, tone);
};

/** `getStonePalette`: regional grey palette with the bed tone on top. */
export const getStonePalette = (tint: number, region: number, band: number): V3 => {
  const slate: V3 = [0.37, 0.39, 0.42];
  const warmGrey: V3 = [0.47, 0.46, 0.44];
  const brownGrey: V3 = [0.45, 0.4, 0.36];
  const mauve: V3 = [0.45, 0.42, 0.44];
  let stone = mix3(slate, warmGrey, smoothstep(0.15, 0.5, tint));
  stone = mix3(stone, brownGrey, smoothstep(0.6, 0.95, tint) * 0.6);
  stone = mix3(stone, mauve, smoothstep(0.5, 0.7, region) * 0.6);
  stone = mix3(stone, slate, smoothstepDesc(0.45, 0.28, region) * 0.6);
  const regionValue = 0.78 + smoothstep(0.3, 0.7, region) * 0.22;
  const bed = mix(0.72, 1.18, band);
  stone = mix3(stone, slate, smoothstepDesc(0.3, 0.05, band) * 0.4);
  const top = mix3(stone, scale3(warmGrey, 1.1), smoothstep(0.7, 0.95, band) * 0.4);
  return scale3(top, regionValue * bed);
};

export const decodeRockTint = (packedByte: number): V3 => {
  const packedTint = packedByte * 255;
  const detailed = packedTint >= 127.5 ? 1 : 0;
  const stoneByte = Math.floor(packedTint + 0.5) - 128;
  if (detailed < 0.5) return [packedTint / 127, 0, 0];
  return [glslMod(stoneByte, 16) / 15, 1, Math.floor(stoneByte / 16)];
};

export interface ReferenceZones {
  clean: number;
  loose: number;
  weathered: number;
}

export const getRockZones = (mask: readonly [number, number, number, number], weathering: number,
  materials: readonly [number, number, number, number], breakup: number): ReferenceZones => {
  const loose = smoothstep(0.22, 0.78, mask[2] + (materials[2] - 0.4) * 0.35 + breakup * 0.3);
  const weathered = smoothstep(0.2, 0.8,
    weathering + (0.5 - materials[0]) * 0.3 + materials[3] * 0.15) * (1 - loose);
  return { clean: 1 - weathered - loose, loose, weathered };
};

export const getCleanRock = (stone: V3, materials: readonly [number, number, number, number]) =>
  scale3(stone, 0.66 + materials[0] * 0.68);

export const getWeatheredRock = (stone: V3, materials: readonly [number, number, number, number],
  world: V3, normal: V3, mask: readonly [number, number, number, number], detailed: boolean) => {
  let color = scale3(mul3(stone, [0.9, 0.88, 0.85]), 0.74 + materials[1] * 0.52);
  if (!detailed) return color;
  const oxidation = smoothstep(0.66, 0.82,
    fbm3(world[0] * 0.13 + world[1] * 0.21, world[2] * 0.13 + world[1] * 0.21));
  color = mix3(color, scale3([0.6, 0.46, 0.3], 0.5 + materials[1]), oxidation * 0.25);
  const runoff = getRunoff(world, normal);
  return scale3(color, 1 - runoff * (0.14 + mask[1] * 0.1));
};

export const getLooseRock = (stone: V3, materials: readonly [number, number, number, number],
  mask: readonly [number, number, number, number]) => {
  const soil = mix3([0.43, 0.4, 0.35], [0.34, 0.36, 0.27], mask[1] * 0.6);
  const pebbles = smoothstep(0.25, 0.6, materials[2]);
  return scale3(mix3(soil, scale3(stone, 0.9), pebbles * 0.75), 0.8 + materials[2] * 0.35);
};

export const getZoneAlbedo = (stone: V3, materials: readonly [number, number, number, number],
  world: V3, normal: V3, mask: readonly [number, number, number, number], zones: ReferenceZones,
  detailed: boolean) => {
  const clean = scale3(getCleanRock(stone, materials), zones.clean);
  const weathered = scale3(getWeatheredRock(stone, materials, world, normal, mask, detailed),
    zones.weathered);
  const loose = scale3(getLooseRock(stone, materials, mask), zones.loose);
  return add3(add3(clean, weathered), loose);
};

export const applyPlaneValues = (albedo: V3, planes: ReferencePlanes, cavity: number): V3 => {
  const up = planes.normal[1];
  let toned = scale3(albedo, mix(0.74, 1.12, smoothstep(-0.4, 0.85, up)));
  const dust = scale3([0.58, 0.56, 0.52], 0.85 + dot3(albedo, [0.33, 0.33, 0.33]) * 0.4);
  toned = mix3(toned, dust, smoothstep(0.6, 0.95, up) * 0.18);
  toned = mix3(toned, mul3(toned, [0.74, 0.77, 0.86]), smoothstepDesc(-0.05, -0.55, up));
  return scale3(toned, 1 + planes.tone * 0.16 + planes.edge * (1 - cavity) * 0.1);
};

export const applyShelfGrowth = (albedo: V3, normal: V3,
  mask: readonly [number, number, number, number], patches: number, breakup: number): V3 => {
  const shelf = smoothstep(0.6, 0.88, normal[1]);
  const sheltered = clamp(mask[1] * 0.9 + mask[3] * 0.6);
  const growth = smoothstep(0.42, 0.7,
    shelf * sheltered + (patches - 0.5) * 0.6 + breakup * 0.2);
  const cover = scale3(mix3([0.3, 0.35, 0.24], [0.39, 0.43, 0.3],
    smoothstep(0.42, 0.62, patches)), 0.85 + breakup * 0.3);
  return mix3(albedo, cover, growth * shelf * 0.65);
};

export const applyWetRock = (albedo: V3, normal: V3, wetness: number, breakup: number): V3 => {
  if (wetness <= 0) return albedo;
  const darker = mix3(albedo, mul3(albedo, [0.8, 0.81, 0.84]), wetness);
  const patches = smoothstep(0.62, 0.9, wetness * 0.7 + breakup + 0.35);
  const moss = patches * smoothstep(0.1, 0.6, normal[1]) * smoothstep(0.3, 0.7, wetness);
  return mix3(darker, mul3(darker, [0.72, 0.86, 0.6]), moss * 0.6);
};

export const applyStrata = (albedo: V3, strata: ReferenceStrata, layered: number): V3 => {
  const shade = (1 + strata.lip * 0.1) * (1 - strata.seam * 0.32);
  return scale3(albedo, mix(1, shade, layered));
};

export const getFormNormal = (normal: V3, macro: readonly [number, number, number, number],
  macroForm: number): V3 =>
  normalize3(mix3(normal, [macro[0], macro[1], macro[2]], 0.5 * macroForm * macro[3]));

/** `getFineGrain`: the two grain octaves and the sparse specks, faded by the footprint. */
export const getFineGrain = (uv: { weights: V3; x: V2; y: V2; z: V2 }, loose: number,
  footprint: number) => {
  const fade = 1 - smoothstep(0.015, 0.06, footprint);
  if (fade <= 0) return 1;
  const sample = (scale: number, point: V2) =>
    valueNoise(point[0] * scale, point[1] * scale) * uv.weights[0] +
    valueNoise(uv.y[0] * scale, uv.y[1] * scale) * uv.weights[1] +
    valueNoise(uv.z[0] * scale, uv.z[1] * scale) * uv.weights[2];
  const grain = sample(38, uv.x) * 0.6 + sample(97, uv.x) * 0.4 - 0.5;
  const speck = smoothstep(0.78, 0.95, sample(160, uv.x));
  const detail = grain * 0.2 + speck * 0.04;
  return 1 + detail * fade * (1 - loose * 0.6);
};

export const getRunoff = (world: V3, normal: V3) => {
  const across = normalize3([-normal[2] + 0.0001, 0, normal[0]]);
  const streak = valueNoise(world[0] * across[0] * 3.2 + world[2] * across[2] * 3.2,
    world[1] * 0.14);
  const broken = valueNoise(world[0] * across[0] * 0.6 + world[2] * across[2] * 0.6,
    world[1] * 0.5);
  const steep = 1 - smoothstep(0.35, 0.7, Math.abs(normal[1]));
  return smoothstep(0.6, 0.85, streak) * smoothstep(0.25, 0.6, broken) * steep;
};

/** The packed rock texture is sampled nearest/repeat, as the parity bench uploads it. */
export type RockSample = (u: number, v: number) => readonly [number, number, number, number];

/** Deterministic packed rock pixels (R clean, G weathered, B gravel, A cavity) for the bench. */
export const ROCK_TEST_SIZE = 16;

export const createRockTestPixels = () => {
  const pixels = new Uint8Array(ROCK_TEST_SIZE * ROCK_TEST_SIZE * 4);
  for (let y = 0; y < ROCK_TEST_SIZE; y += 1) {
    for (let x = 0; x < ROCK_TEST_SIZE; x += 1) {
      const offset = (y * ROCK_TEST_SIZE + x) * 4;
      pixels[offset] = (x * 37 + y * 11) % 251;
      pixels[offset + 1] = (x * 17 + y * 29 + 13) % 241;
      pixels[offset + 2] = (x * 53 + y * 7 + 71) % 239;
      pixels[offset + 3] = (x * 3 + y * 61 + 29) % 233;
    }
  }
  return pixels;
};

/** Nearest/repeat sampling of the bench's packed rock pixels. */
export const sampleRockTestTexture = (pixels: Uint8Array): RockSample => (u, v) => {
  const wrap = (value: number) => ((value % 1) + 1) % 1;
  const x = Math.min(ROCK_TEST_SIZE - 1, Math.floor(wrap(u) * ROCK_TEST_SIZE));
  const y = Math.min(ROCK_TEST_SIZE - 1, Math.floor(wrap(v) * ROCK_TEST_SIZE));
  const offset = (y * ROCK_TEST_SIZE + x) * 4;
  return [pixels[offset]! / 255, pixels[offset + 1]! / 255, pixels[offset + 2]! / 255,
    pixels[offset + 3]! / 255] as const;
};

export interface ReferenceRockUv {
  weights: V3;
  x: V2;
  y: V2;
  z: V2;
}

/** `getRockUv` with ROCK_TILE baked in by the caller (the bench passes the tile scale). */
export const getRockUv = (world: V3, normal: V3, tile: number): ReferenceRockUv => {
  const raw: V3 = [Math.abs(normal[0]) ** 2.5, Math.abs(normal[1]) ** 2.5, Math.abs(normal[2]) ** 2.5];
  const total = raw[0] + raw[1] + raw[2];
  return {
    weights: [raw[0] / total, raw[1] / total, raw[2] / total],
    x: [world[2] * tile, world[1] * tile],
    y: [world[0] * tile, world[2] * tile],
    z: [world[0] * tile, world[1] * tile]
  };
};

/** `sampleRockTriplanar`: the height-aware blend of the three projections. */
export const sampleRockTriplanar = (uv: ReferenceRockUv,
  sample: RockSample): readonly [number, number, number, number] => {
  const x = sample(uv.x[0], uv.x[1]);
  const y = sample(uv.y[0], uv.y[1]);
  const z = sample(uv.z[0], uv.z[1]);
  const weights: V3 = [uv.weights[0] * (x[0] * 0.8 + 0.6), uv.weights[1] * (y[0] * 0.8 + 0.6),
    uv.weights[2] * (z[0] * 0.8 + 0.6)];
  const total = weights[0] + weights[1] + weights[2];
  const channel = (index: number) =>
    (x[index]! * weights[0] + y[index]! * weights[1] + z[index]! * weights[2]) / total;
  return [channel(0), channel(1), channel(2), channel(3)];
};

export const applyStoneDetail = (albedo: V3, world: V3, normal: V3, breakup: number,
  sample: RockSample, detailScale: number): V3 => {
  const fineUv = getRockUv(scale3(world, detailScale), normal, 0.19);
  const fine = sampleRockTriplanar(fineUv, sample);
  const mottle = valueNoise(world[0] * 0.9 + world[1] * 0.7 + 3.1, world[2] * 0.9 + world[1] * 0.7 + 3.1);
  let stone = scale3(albedo, mix(0.86, 1.12, mottle) * (0.8 + fine[0] * 0.45));
  const speckLight = smoothstep(0.66, 0.82, fine[1]);
  const speckDark = smoothstepDesc(0.34, 0.2, fine[2]);
  stone = mix3(stone, add3(scale3(stone, 1.25), [0.04, 0.04, 0.04]), speckLight * 0.35);
  stone = scale3(stone, 1 - speckDark * 0.18 - fine[3] * 0.45);
  stone = mix3(stone, add3(scale3(stone, 1.12), [0.03, 0.03, 0.03]),
    smoothstep(0.35, 0.9, normal[1]) * 0.5);
  const lichenNoise = valueNoise(world[0] * 3.3 + world[1] * 2.1, world[2] * 3.3 + world[1] * 2.1);
  const lichen = smoothstep(0.74, 0.82, lichenNoise + breakup * 0.2) *
    smoothstep(0, 0.6, normal[1]);
  stone = mix3(stone, add3(mul3(stone, [1.08, 1.06, 0.96]), [0.03, 0.03, 0.03]), lichen * 0.35);
  const mossSide = smoothstepDesc(0.1, -0.7, normal[2]) * 0.6 + smoothstep(0.5, 0.95, normal[1]) * 0.4;
  const moss = smoothstep(0.55, 0.75,
    valueNoise(world[0] * 1.7 + 8.3, world[2] * 1.7 + 8.3) + breakup * 0.3) * mossSide;
  return mix3(stone, mul3(stone, [0.82, 0.9, 0.74]), moss * 0.4);
};

export const applyMountainDetail = (albedo: V3, world: V3, normal: V3, zones: ReferenceZones,
  breakup: number, sample: RockSample): V3 => {
  const uv = getRockUv([world[0] * 2.35 + 11.7, world[1] * 2.35 + 3.1, world[2] * 2.35 - 8.4],
    normal, 0.19);
  const detail = sampleRockTriplanar(uv, sample);
  const exposed = 1 - zones.loose * 0.8;
  const mineral = detail[0] * 0.65 + detail[1] * 0.35;
  let color = scale3(albedo, 0.72 + mineral * 0.56);
  color = scale3(color, 1 - detail[3] * 0.22 * exposed);
  const patina = mix3([0.96, 0.98, 1.01], [1.03, 1, 0.96], smoothstep(-0.2, 0.2, breakup));
  return mix3(albedo, mul3(color, patina), exposed * 0.8);
};

/** `applyOreStone`: the four surveyed ore looks (coal, iron, gold, granite). */
export const applyOreStone = (albedo: V3, world: V3, ore: number, time: number): V3 => {
  const luma = dot3(albedo, [0.3, 0.59, 0.11]);
  const grain = fbm3(world[0] * 2.4 + world[1] * 1.7, world[2] * 2.4 + world[1] * 1.7);
  if (ore === 1) {
    const seam = Math.abs(Math.sin(world[1] * 11 + world[0] * 2 + grain * 7));
    return mix3(scale3(albedo, 0.8), [0.08, 0.075, 0.07], smoothstepDesc(0.45, 0.15, seam));
  }
  if (ore === 2) {
    const rust = smoothstep(0.52, 0.7, grain + (0.5 - fract(world[1] * 0.9)) * 0.08);
    return mix3(albedo, scale3([0.47, 0.26, 0.15], 0.75 + luma), rust * 0.6);
  }
  if (ore === 3) {
    const vein = Math.abs(Math.sin(world[0] * 6 - world[2] * 4.5 + world[1] * 3 + grain * 8));
    const quartz = mix3(albedo, [0.86, 0.84, 0.78], smoothstepDesc(0.22, 0.06, vein));
    const speck = fract(Math.sin(Math.floor(world[0] * 26) * 12.9898 +
      Math.floor(world[1] * 26) * 78.233 + Math.floor(world[2] * 26) * 37.719) * 43758.5453);
    const flash = 0.6 + 0.4 * Math.sin(time * 3 + speck * 40);
    const glint = (speck >= 0.92 ? 1 : 0) * (vein <= 0.3 ? 1 : 0);
    return mix3(quartz, scale3([1, 0.78, 0.25], 1 + flash), glint);
  }
  if (ore === 4) {
    const fleck = fract(Math.sin(Math.floor(world[0] * 34) * 39.3 +
      Math.floor(world[1] * 34) * 11.7 + Math.floor(world[2] * 34) * 83.1) * 43758.5453);
    let flecked = scale3([0.8, 0.78, 0.75], 0.85 + luma * 0.3);
    if (fleck > 0.84) flecked = [0.7, 0.55, 0.5];
    if (fleck > 0.9) flecked = [0.14, 0.14, 0.15];
    return mix3(albedo, flecked, 0.8);
  }
  return albedo;
};

/** The deposit close-up patterns of `createDepositDetailNodes`, keyed by stone family. */
export const applyDepositDetail = (family: string, albedo: V3, world: V3,
  footprint: number): V3 => {
  const fadeRange = family === "granite" ? [0.012, 0.05]
    : family === "marble" ? [0.02, 0.08] : [0.02, 0.085];
  const fade = 1 - smoothstep(fadeRange[0]!, fadeRange[1]!, footprint);
  if (family === "basalt") {
    const crack = (0.5 + 0.5 * Math.sin(world[0] * 8 + world[2] * 6.3 +
      Math.sin(world[1] * 5.1))) ** 28;
    return mix3(albedo, mul3(albedo, [0.9, 0.95, 1.06]), crack * 0.35 * fade);
  }
  if (family === "granite") {
    const grains = valueNoise4(world[0] * 17 + world[1] * 11, world[2] * 17 + world[1] * 11);
    const mica = smoothstep(0.72, 0.92, grains[0]);
    const feldspar = smoothstep(0.76, 0.95, grains[1]);
    let stone = mix3(albedo, mul3(albedo, [0.58, 0.63, 0.72]), mica * 0.55 * fade);
    stone = mix3(stone, mul3(albedo, [1.16, 0.95, 0.9]), feldspar * 0.4 * fade);
    const tone = valueNoise(world[0] * 3.7 + world[1] * 2.9, world[2] * 3.7 + world[1] * 2.9);
    return scale3(stone, 1 + (tone - 0.5) * 0.09 * fade);
  }
  if (family === "limestone") {
    const beddingNoise = valueNoise(world[0] * 2.1 + world[1] * 1.5, world[2] * 2.1 + world[1] * 1.5);
    const bedding = 0.5 + 0.5 * Math.sin(world[1] * 30 + beddingNoise * 3.2);
    const beds = smoothstep(0.72, 0.97, bedding);
    const stone = mul3(albedo, mix3([1, 1, 1], [0.78, 0.68, 0.5], beds * 0.22 * fade));
    const tone = valueNoise(world[0] * 9 + world[1] * 6, world[2] * 9 + world[1] * 6);
    return scale3(stone, 1 + (tone - 0.5) * 0.07 * fade);
  }
  const band = Math.sin(world[0] * 4.1 + world[2] * 3.3 + Math.sin(world[1] * 3.1) * 1.4);
  const thread = Math.sin(world[0] * 9.7 - world[2] * 7.3 + world[1] * 3.9);
  const vein = smoothstep(0.9, 0.995, band * 0.65 + thread * 0.35);
  const stone = mix3(albedo, mul3(albedo, [0.72, 0.78, 0.87]), vein * 0.6 * fade);
  const tone = valueNoise(world[0] * 5 + world[1] * 3.5, world[2] * 5 + world[1] * 3.5);
  return scale3(stone, 1 + (tone - 0.5) * 0.06 * fade);
};

const max2 = (a: V2, b: V2): V2 => [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const dot2 = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];

/** One joint set of `createJointCleft`; `uFootprint` replaces the shader's `fwidth(u)`. */
const getJointCleft = (world: V3, normal: V3, across: V2, shape: V3, wiggle: number,
  uFootprint: number): V2 => {
  const spacing = shape[0];
  const u = dot2([world[0], world[2]], across) / spacing + (wiggle - 0.5) * 0.4
    + world[1] * shape[2];
  const footprint = Math.max(uFootprint * spacing, 1e-4);
  const joint = Math.floor(u + 0.5);
  const open = hashRockId(joint + spacing * 7.3) >= 1 - shape[1] ? 1 : 0;
  const alongPoint: V2 = [joint * 3.7 + spacing,
    world[1] * 0.28 + dot2([world[0], world[2]], [across[1], across[0]]) * 0.1];
  const along = valueNoise(alongPoint[0], alongPoint[1]);
  const width = (0.04 + along * 0.1) * spacing * 0.2 + footprint;
  const offset = (u - joint) * spacing;
  const core = 1 - smoothstep(0, width, Math.abs(offset));
  const wall = 1 - smoothstep(0, width * 3.5, -offset);
  const lipEdge = smoothstep(width * 1.4, width * 3, offset);
  const lip = smoothstep(width * 0.6, width * 1.4, offset) * (1 - lipEdge);
  const facing = 1 - smoothstep(0.55, 0.9, Math.abs(normal[0] * across[0] + normal[2] * across[1]));
  const shown = open * smoothstep(0.35, 0.5, along) * facing;
  const darkness = Math.max(core * 0.9, wall * (offset <= 0 ? 1 : 0) * 0.55);
  return [darkness * shown, lip * shown];
};

/** `createRockFormNodes` `getFractures`: clefts (x darkness, y lit lip), two or three sets. */
export const getFractures = (world: V3, normal: V3, turn: number, detailed: boolean,
  uFootprint: number): V2 => {
  const strike = turn * 1.6;
  const acrossA: V2 = [Math.cos(strike), Math.sin(strike)];
  const acrossB: V2 = [Math.cos(strike + 1.3), Math.sin(strike + 1.3)];
  const wiggle = valueNoise4((world[0] + world[2]) * 0.3 + 5.1, world[1] * 1.6 * 0.3 + 5.1);
  let major = max2(
    getJointCleft(world, normal, acrossA, [7.5, 0.55, 0.04], wiggle[0], uFootprint),
    getJointCleft(world, normal, acrossB, [9.5, 0.5, -0.06], wiggle[1], uFootprint)
  );
  if (detailed) {
    const acrossC: V2 = [Math.cos(strike + 0.6), Math.sin(strike + 0.6)];
    const minor = getJointCleft(world, normal, acrossC, [2.6, 0.25, 0.45], wiggle[2], uFootprint);
    major = [Math.max(major[0], minor[0] * 0.35), Math.max(major[1], minor[1] * 0.35)];
  }
  const tops = smoothstep(0.75, 0.95, normal[1]);
  return [major[0] * (1 - tops * 0.6), major[1] * (1 - tops * 0.6)];
};

/** `getRockNoise`: regional (x turn, y strata warp, z zones, w snow), meso and region. */
export const getRockNoise = (world: V3) => ({
  meso: valueNoise4(world[0] * 0.6 + world[1] * 0.45, world[2] * 0.6 + world[1] * 0.45),
  region: fbm3(world[0] * 0.02 + world[1] * 0.03, world[2] * 0.02 + world[1] * 0.03),
  regional: valueNoise4(world[0] * 0.035 + world[1] * 0.02 + 2.7,
    world[2] * 0.035 + world[1] * 0.02 + 2.7)
});

/** A sampled normal-map texel (RG rock slopes, BA gravel slopes), 0..1. */
export type RockNormalSample = (u: number, v: number) => readonly [number, number, number, number];

export const ROCK_NORMAL_TEST_SIZE = 16;

/** Deterministic packed rock normal pixels for the assembled bench case. */
export const createRockNormalTestPixels = () => {
  const pixels = new Uint8Array(ROCK_NORMAL_TEST_SIZE * ROCK_NORMAL_TEST_SIZE * 4);
  for (let y = 0; y < ROCK_NORMAL_TEST_SIZE; y += 1) {
    for (let x = 0; x < ROCK_NORMAL_TEST_SIZE; x += 1) {
      const offset = (y * ROCK_NORMAL_TEST_SIZE + x) * 4;
      pixels[offset] = (x * 29 + y * 43 + 7) % 251;
      pixels[offset + 1] = (x * 59 + y * 13 + 31) % 241;
      pixels[offset + 2] = (x * 11 + y * 67 + 53) % 239;
      pixels[offset + 3] = (x * 47 + y * 23 + 17) % 233;
    }
  }
  return pixels;
};

/** Nearest/repeat sampling of the bench's packed rock normal pixels. */
export const sampleRockTestNormal = (pixels: Uint8Array): RockNormalSample => (u, v) => {
  const wrap = (value: number) => ((value % 1) + 1) % 1;
  const x = Math.min(ROCK_NORMAL_TEST_SIZE - 1, Math.floor(wrap(u) * ROCK_NORMAL_TEST_SIZE));
  const y = Math.min(ROCK_NORMAL_TEST_SIZE - 1, Math.floor(wrap(v) * ROCK_NORMAL_TEST_SIZE));
  const offset = (y * ROCK_NORMAL_TEST_SIZE + x) * 4;
  return [pixels[offset]! / 255, pixels[offset + 1]! / 255, pixels[offset + 2]! / 255,
    pixels[offset + 3]! / 255] as const;
};

const decodeNormal4 = (sample: readonly [number, number, number, number]):
readonly [number, number, number, number] =>
  [sample[0] * 2 - 1, sample[1] * 2 - 1, sample[2] * 2 - 1, sample[3] * 2 - 1];

/** `getRockDetailNormal`: the whiteout blend of the two detail slope sets. */
export const getRockDetailNormal = (normal: V3, uv: ReferenceRockUv, zones: ReferenceZones,
  fade: number, sampleNormal: RockNormalSample): V3 => {
  const slopesX = decodeNormal4(sampleNormal(uv.x[0], uv.x[1]));
  const slopesY = decodeNormal4(sampleNormal(uv.y[0], uv.y[1]));
  const slopesZ = decodeNormal4(sampleNormal(uv.z[0], uv.z[1]));
  const nx: V2 = [mix(slopesX[0], slopesX[2], zones.loose), mix(slopesX[1], slopesX[3], zones.loose)];
  const ny: V2 = [mix(slopesY[0], slopesY[2], zones.loose), mix(slopesY[1], slopesY[3], zones.loose)];
  const nz: V2 = [mix(slopesZ[0], slopesZ[2], zones.loose), mix(slopesZ[1], slopesZ[3], zones.loose)];
  // vec3(0, nx.y, nx.x) * wx + vec3(ny.x, 0, ny.y) * wy + vec3(nz.x, nz.y, 0) * wz.
  const detail: V3 = [
    ny[0] * uv.weights[1] + nz[0] * uv.weights[2],
    nx[1] * uv.weights[0] + nz[1] * uv.weights[2],
    nx[0] * uv.weights[0] + ny[1] * uv.weights[1]
  ];
  const strength = zones.clean * 0.3 + zones.weathered * 0.34 + zones.loose * 0.2;
  return normalize3(add3(normal, scale3(detail, strength * fade)));
};

/** `applyStoneDetailNormal`: the finer detail normal of standalone stones close up. */
export const applyStoneDetailNormal = (normal: V3, world: V3, surfaceNormal: V3,
  detailed: number, fade: number, sampleNormal: RockNormalSample, detailScale: number): V3 => {
  if (detailed <= 0.5 || fade <= 0) return surfaceNormal;
  const uv = getRockUv(scale3(world, detailScale), normal, ROCK_TILE);
  const slopesX = decodeNormal4(sampleNormal(uv.x[0], uv.x[1]));
  const slopesY = decodeNormal4(sampleNormal(uv.y[0], uv.y[1]));
  const slopesZ = decodeNormal4(sampleNormal(uv.z[0], uv.z[1]));
  // vec3(0, sX.y, sX.x) * wx + vec3(sY.x, 0, sY.y) * wy + vec3(sZ.x, sZ.y, 0) * wz.
  const detail: V3 = [
    slopesY[0] * uv.weights[1] + slopesZ[0] * uv.weights[2],
    slopesX[1] * uv.weights[0] + slopesZ[1] * uv.weights[2],
    slopesX[0] * uv.weights[0] + slopesY[1] * uv.weights[1]
  ];
  return normalize3(add3(surfaceNormal, scale3(detail, 0.2 * fade)));
};

export interface ReferenceRockSurface {
  albedo: V3;
  detailed: number;
  normal: V3;
  occlusion: number;
  roughness: number;
  snow: number;
  zones: ReferenceZones;
}

/** Inputs shared by the CPU surface references; derivatives are explicit. */
export interface RockSurfaceReferenceInputs {
  detailed: boolean;
  /** `fwidth(u)` of the joint kernels, passed like the parity bench does. */
  fractureFootprint: number;
  macroNormal: readonly [number, number, number, number];
  normalSample: RockNormalSample;
  rockSample: RockSample;
  snowLine: number;
  /** `fwidth(layer)` of the strata kernel. */
  strataFootprint: number;
  time: number;
  /** `length(fwidth(world))`. */
  worldFootprint: number;
}

const applyKindDetail = (albedo: V3, world: V3, normal: V3, tint: V3, zones: ReferenceZones,
  breakup: number, inputs: RockSurfaceReferenceInputs): V3 => {
  let result = albedo;
  if (tint[1] > 0.5)
    result = applyStoneDetail(scale3(result, 1.08), world, normal, breakup, inputs.rockSample,
      ROCK_STONE_DETAIL_SCALE);
  if (tint[2] > 0) return applyOreStone(result, world, tint[2], inputs.time);
  if (inputs.detailed)
    result = applyMountainDetail(result, world, normal, zones, breakup, inputs.rockSample);
  return result;
};

/** `getRockSurface`: the shared albedo, form and occlusion (no detail normal). */
export const getRockSurface = (world: V3, normalInput: V3, mask: readonly [number, number, number, number],
  extra: readonly [number, number, number, number],
  inputs: RockSurfaceReferenceInputs): ReferenceRockSurface => {
  const normal = normalize3(normalInput);
  const wetness = extra[3];
  const uv = getRockUv(world, normal, ROCK_TILE);
  const materials = sampleRockTriplanar(uv, inputs.rockSample);
  const tint = decodeRockTint(mask[0]);
  const noise = getRockNoise(world);
  const breakup = noise.meso[0] - 0.5;
  const weathering = extra[2] + (noise.regional[2] - 0.5) * 0.9 + breakup * 0.25;
  const zones = getRockZones(mask, weathering, materials, breakup);
  const formed = 1 - tint[1];
  const form = getFormNormal(normal, inputs.macroNormal, extra[0]);
  const planes = getRockPlanes(form, noise.regional[0], ROCK_PLANE_STRENGTH * formed);
  const exposed = (1 - zones.loose) * formed;
  const layered = (1 - smoothstep(0.55, 0.85, form[1])) * exposed;
  const strata = getStrata(world, form, noise.regional[1], noise.meso[1], inputs.strataFootprint);
  const stone = getStonePalette(tint[0], noise.region, mix(0.45, strata.band, layered));
  let albedo = getZoneAlbedo(stone, materials, world, normal, mask, zones, inputs.detailed);
  if (inputs.detailed) albedo = scale3(albedo, getFineGrain(uv, zones.loose, inputs.worldFootprint));
  const crevice = smoothstep(0.3, 0.9, mask[3]);
  albedo = applyPlaneValues(albedo, planes, crevice);
  albedo = applyStrata(albedo, strata, layered);
  const rawClefts = getFractures(world, form, noise.regional[0], inputs.detailed,
    inputs.fractureFootprint);
  const fractures = rawClefts[0] * exposed;
  const litLip = rawClefts[1] * exposed;
  albedo = scale3(albedo, (1 - fractures * 0.5) * (1 + litLip * 0.12));
  albedo = applyKindDetail(albedo, world, normal, tint, zones, breakup, inputs);
  albedo = applyShelfGrowth(albedo, normal, mask, noise.meso[3], breakup);
  albedo = applyWetRock(albedo, normal, wetness, breakup);
  const snowPatches: V2 = [noise.regional[3], noise.meso[2]];
  const snowSlope = normalize3(mix3(form, normal, 0.65));
  const snow = getSnowCover(world, snowSlope, mask, materials, snowPatches, inputs.snowLine)
    * (1 - wetness);
  albedo = mix3(albedo, getSnowColor(world, form, snowPatches), snow);
  albedo = scale3(albedo, 1 - crevice * 0.16 * (1 - snow));
  const cavity = materials[3] * (0.16 + zones.weathered * 0.1) * (1 - zones.loose);
  const formShade = (1 - fractures * 0.4) * (1 - strata.seam * layered * 0.25);
  const surfaceNormal = normalize3(mix3(planes.normal, getSnowNormal(form), snow));
  const occlusion = mix((1 - crevice * 0.45) * (1 - cavity) * formShade, 1, snow * 0.7);
  const dryRoughness = zones.clean * 0.8 + zones.weathered * 0.88 + zones.loose * 0.95
    + breakup * 0.12;
  const roughness = mix(mix(dryRoughness, 0.6, snow), 0.45, wetness * 0.6);
  return { albedo, detailed: tint[1], normal: surfaceNormal, occlusion, roughness, snow, zones };
};

/** `getRockDetailSurface`: the surface plus the detail normals and damp/moss roughness. */
export const getRockDetailSurface = (world: V3, normalInput: V3,
  mask: readonly [number, number, number, number], extra: readonly [number, number, number, number],
  inputs: RockSurfaceReferenceInputs): ReferenceRockSurface => {
  const normal = normalize3(normalInput);
  const surface = getRockSurface(world, normal, mask, extra, inputs);
  const smoothNormal = surface.normal;
  const nearFade = 1 - smoothstep(0.02, 0.08, inputs.worldFootprint);
  let detailNormal = getRockDetailNormal(surface.normal, getRockUv(world, normal, ROCK_TILE),
    surface.zones, nearFade, inputs.normalSample);
  const damp = mask[3] * smoothstep(0.3, 0.8, mask[1]);
  let roughness = mix(surface.roughness, 0.7, damp * 0.5);
  const moss = smoothstep(0.5, 0.8, mask[1]) * surface.zones.weathered;
  roughness = mix(roughness, 0.95, moss);
  detailNormal = applyStoneDetailNormal(normal, world, detailNormal, surface.detailed, nearFade,
    inputs.normalSample, ROCK_STONE_DETAIL_SCALE);
  detailNormal = normalize3(mix3(detailNormal, smoothNormal, surface.snow * 0.85));
  roughness = mix(roughness, 0.55, surface.snow);
  return { ...surface, normal: detailNormal, roughness };
};

/** The rock-only light of `ROCK_FILL_GLSL`; `lighting` is the shared surface light. */
export interface RockLightReferenceInputs {
  ambientGround: V3;
  ambientSky: V3;
  highlight: number;
  sunColor: V3;
  sunDirection: V3;
  viewDirection: V3;
}

export const getRockPlaneContrast = (surface: ReferenceRockSurface, sunLit: number,
  sunDirection: V3): V3 => {
  const lit = smoothstep(-0.1, 0.6, dot3(surface.normal, sunDirection)) * mix(0.35, 1, sunLit);
  const push = mix3([0.72, 0.75, 0.85], [1.05, 1.03, 1], lit);
  const strength = (1 - surface.snow * 0.8) * (1 - surface.detailed * 0.6);
  return mix3([1, 1, 1], push, strength);
};

export const getRockFill = (albedo: V3, normal: V3, sunLit: number, occlusion: number,
  inputs: RockLightReferenceInputs): V3 => {
  const shade = 1 - sunLit * clamp(dot3(normal, inputs.sunDirection) * 1.5 + 0.3);
  const sky = scale3(inputs.ambientSky, smoothstep(-0.3, 0.8, normal[1]));
  const bounce = scale3(mul3(inputs.ambientGround, [1.15, 1, 0.85]),
    smoothstepDesc(0.4, -0.6, normal[1]));
  const ambient = scale3(add3(scale3(sky, 0.3), scale3(bounce, 0.4)),
    shade * mix(0.6, 1, occlusion));
  return mul3(albedo, ambient);
};

export const getRockSpecular = (normal: V3, roughness: number, sunLit: number,
  inputs: RockLightReferenceInputs): V3 => {
  const halfway = normalize3(add3(inputs.sunDirection, inputs.viewDirection));
  const gloss = 1 - roughness;
  const glint = Math.max(dot3(normal, halfway), 0) ** mix(6, 40, gloss);
  return scale3(inputs.sunColor, glint * gloss * gloss * 0.6 * sunLit * inputs.highlight);
};

/** `three-rocks.ts` main(): the full rock colour before fog and the colour tail. */
export const assembleRockShading = (albedo: V3, surface: ReferenceRockSurface, sunLit: number,
  xz: V2, lighting: LightingReferenceInputs, rockLight: RockLightReferenceInputs): V3 => {
  const lit = lightSurface(albedo, surface.normal, sunLit, surface.occlusion, xz, lighting);
  const fill = getRockFill(albedo, surface.normal, sunLit, surface.occlusion, rockLight);
  const specular = mul3(getRockSpecular(surface.normal, surface.roughness, sunLit, rockLight),
    albedo);
  const sum = add3(add3(lit, fill), specular);
  return mul3(sum, getRockPlaneContrast(surface, sunLit, rockLight.sunDirection));
};

export const NOISE_LATTICE_PERIOD = NOISE_LATTICE;
