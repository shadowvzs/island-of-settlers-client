import { float, Fn, int, texture, texture3D, vec2, vec3, vec4 } from "three/tsl";
import {
  Data3DTexture,
  DataTexture,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  RepeatWrapping,
  type Texture,
  UnsignedByteType
} from "three/webgpu";

import { EXPLORATION_CLOUD } from "../../src/render-common/atmosphere/exploration-sky-constants";
import {
  createSkyModelInputs,
  writeSkyModelRadiance
} from "../../src/render-common/atmosphere/sky-model";
import { GRASS_RING_EDGE_NOISE_SCALE } from "../../src/render-common/grass/grass-ring-layout";
import {
  ROCK_SNOW_LINE,
  ROCK_STONE_DETAIL_SCALE,
  ROCK_TILE,
  ROCK_WINTER_SNOW_LINE_DROP
} from "../../src/render-common/shaders/rock-tuning";
import { grassHoleKeepAt, grassKeepAt } from "../../src/renderers/three/grass-range";
import {
  colorAgxToneMap,
  colorFinishDisplay,
  colorGrade,
  colorNeutralToneMap,
  colorSceneToRadiance,
  colorSrgbDecode,
  colorSrgbEncode,
  colorToneMap,
  colorToneMapInverse
} from "../../src/renderers/webgpu/tsl/color-output";
import { createFogNodes } from "../../src/renderers/webgpu/tsl/fog";
import { createLightingNodes } from "../../src/renderers/webgpu/tsl/lighting";
import { createNoiseNodes } from "../../src/renderers/webgpu/tsl/noise";
import { createGrassKeepNodes } from "../../src/renderers/webgpu/tsl/prop-grass";
import * as colorReference from "../../src/renderers/webgpu/tsl/reference/color-output";
import * as fogReference from "../../src/renderers/webgpu/tsl/reference/fog";
import * as lightingReference from "../../src/renderers/webgpu/tsl/reference/lighting";
import * as noiseReference from "../../src/renderers/webgpu/tsl/reference/noise";
import * as roadReference from "../../src/renderers/webgpu/tsl/reference/road";
import * as shipClothReference from "../../src/renderers/webgpu/tsl/reference/ship-cloth";
import { trafficWheelTrack } from "../../src/renderers/webgpu/tsl/road";
import * as rockReference from "../../src/renderers/webgpu/tsl/reference/rock";
import * as waterGroundReference from "../../src/renderers/webgpu/tsl/reference/water-ground";
import * as waterReference from "../../src/renderers/webgpu/tsl/reference/water";
import * as windReference from "../../src/renderers/webgpu/tsl/reference/wind";
import {
  explorationLowCloudOpacity,
  skyCloudPhase,
  skyHeightFraction,
  skyRemap,
  skyShellDistance
} from "../../src/renderers/webgpu/tsl/sky/clouds";
import { skyLightTangentOffset } from "../../src/renderers/webgpu/tsl/sky/disc";
import { createSkyModelNodes } from "../../src/renderers/webgpu/tsl/sky/sky-model";
import { starMilkyWay } from "../../src/renderers/webgpu/tsl/sky/stars";
import {
  applyMountainDetail,
  applyOreStone,
  applyStoneDetail,
  createDepositDetailNodes,
  getFineGrain,
  getRockDetailNormal,
  getRunoff
} from "../../src/renderers/webgpu/tsl/rock-detail";
import {
  createRockFormNodes,
  getRockPlanes,
  getSnowColor,
  getSnowCover,
  getSnowLee,
  getSnowNormal
} from "../../src/renderers/webgpu/tsl/rock-form";
import { createRockLightNodes, createRockShadingNodes } from "../../src/renderers/webgpu/tsl/rock-light";
import { createShipClothNormal, createShipClothOffset } from "../../src/renderers/webgpu/tsl/ship-cloth";
import { getRockUv, sampleRockTriplanar } from "../../src/renderers/webgpu/tsl/rock-uv";
import {
  applyPlaneValues,
  applyShelfGrowth,
  applyStrata,
  applyWetRock,
  createRockSurfaceNodes,
  decodeRockTint,
  getCleanRock,
  getFormNormal,
  getLooseRock,
  getRockZones,
  getStonePalette,
  getWeatheredRock
} from "../../src/renderers/webgpu/tsl/rock-surface";
import { createWaterGroundNodes } from "../../src/renderers/webgpu/tsl/water-ground";
import { createWaterMathNodes } from "../../src/renderers/webgpu/tsl/water-math";
import { createWindNodes } from "../../src/renderers/webgpu/tsl/wind";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type Row = readonly number[];
type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

/**
 * WG-FIX-C (D): the TSL graphs and their CPU references on the same input tables. Each case is one
 * draw: sample `i` reads its vec4 input rows from column `i` of a float texture, the graph writes
 * up to four output components, and the bench compares them with `cpu(rows)`.
 */
export interface TslParityCase {
  cpu: (rows: readonly Row[]) => readonly number[];
  gpu: (input: (row: number) => TslNode) => TslNode;
  name: string;
  samples: readonly (readonly Row[])[];
  /** Output components compared (1..4). */
  size: 1 | 2 | 3 | 4;
}

const v2 = (row: Row, offset = 0): V2 => [row[offset]!, row[offset + 1]!];
const v3 = (row: Row, offset = 0): V3 => [row[offset]!, row[offset + 1]!, row[offset + 2]!];
const v4 = (row: Row): readonly [number, number, number, number] =>
  [row[0]!, row[1]!, row[2]!, row[3]!];

const COLOURS: readonly Row[] = [
  [0.5, 0.25, 1.2], [0.3, 0.2, 0.1], [0.02, 0.01, 0.03], [2, 1.5, 0.4], [0.7, 0.75, 0.74],
  [5, 5, 5], [0.9, 0.05, 0.3]
];
const POINTS: readonly Row[] = [
  [3.2, 7.1], [31.9, 1.3], [12.31, 4.77], [-5.43, 20.07], [100.37, -33.61], [0.53, 0.57]
];
/** Tonemapped display values in [0, 1]: the inverse maps are defined on scene-target pixels. */
const DISPLAY_COLOURS: readonly Row[] = [
  [0.5, 0.25, 0.8], [0.3, 0.2, 0.1], [0.02, 0.01, 0.03], [0.9, 0.75, 0.4], [0.7, 0.75, 0.74]
];

const colourCases = (): TslParityCase[] => [
  { cpu: ([c]) => colorReference.neutralToneMap(v3(c!)), gpu: input => colorNeutralToneMap(input(0).xyz),
    name: "colour/neutral", samples: COLOURS.map(c => [c]), size: 3 },
  { cpu: ([c]) => colorReference.agxToneMap(v3(c!)), gpu: input => colorAgxToneMap(input(0).xyz),
    name: "colour/agx", samples: COLOURS.map(c => [c]), size: 3 },
  { cpu: ([c, p]) => colorReference.toneMap(v3(c!), p![0]!, p![1]!),
    gpu: input => colorToneMap(input(0).xyz, input(1).x, input(1).y), name: "colour/tone-map",
    samples: COLOURS.flatMap(c => [[c, [1, 0]], [c, [1.4, 0.35]], [c, [0.8, 1]]]), size: 3 },
  { cpu: ([c, p]) => colorReference.toneMapInverse(v3(c!), p![0]!, p![1]!),
    gpu: input => colorToneMapInverse(input(0).xyz, input(1).x, input(1).y),
    name: "colour/tone-map-inverse",
    samples: DISPLAY_COLOURS.flatMap(c => [[c, [1, 0]], [c, [1.4, 1]], [c, [0.8, 0.5]]]), size: 3 },
  { cpu: ([c, p]) => colorReference.sceneToRadiance(v3(c!), p![0]!, p![1]!, p![2]!, p![3]!),
    gpu: input => colorSceneToRadiance(input(0).xyz, input(1).x, input(1).y, input(1).z, input(1).w),
    name: "colour/scene-to-radiance",
    samples: DISPLAY_COLOURS.flatMap(c => [[c, [1, 0, 0, 1]], [c, [1.4, 1, 0.2, 0.4]],
      [c, [0.8, 0.5, 0, 0.7]]]), size: 3 },
  { cpu: ([c]) => colorReference.srgbDecode(v3(c!)), gpu: input => colorSrgbDecode(input(0).xyz),
    name: "colour/srgb-decode", samples: COLOURS.slice(0, 5).map(c => [c]), size: 3 },
  { cpu: ([c]) => colorReference.srgbEncode(v3(c!)), gpu: input => colorSrgbEncode(input(0).xyz),
    name: "colour/srgb-encode", samples: COLOURS.slice(0, 5).map(c => [c]), size: 3 },
  { cpu: ([c, p]) => colorReference.grade(v3(c!), p![0]!, p![1]!, p![2]!),
    gpu: input => colorGrade(input(0).xyz, input(1).x, input(1).y, input(1).z), name: "colour/grade",
    samples: [[[0.5, 0.25, 0.8], [0.2, 0.15, 0.4]], [[0.1, 0.6, 0.3], [0, 0.3, 0]],
      [[0.9, 0.9, 0.2], [1, 0, 1]]], size: 3 },
  { cpu: ([c, p]) => colorReference.finishDisplay(v3(c!), p![0]!, p![1]!, p![2]!, p![3]!, c![3]!),
    gpu: input => colorFinishDisplay(input(0).xyz, input(1).xy, input(1).z, input(1).w, input(0).w),
    name: "colour/finish-display",
    samples: [[[0.5, 0.25, 0.8, 0.4], [123.5, 45.5, 0.2, 0.15]],
      [[0.1, 0.6, 0.3, 0], [640.5, 360.5, 0, 0.3]]], size: 3 }
];

const noiseCases = (noise: ReturnType<typeof createNoiseNodes>): TslParityCase[] => [
  { cpu: ([p]) => noiseReference.valueNoise4(p![0]!, p![1]!), gpu: input => noise.valueNoise4(input(0).xy),
    name: "noise/value-noise4", samples: POINTS.map(p => [p]), size: 4 },
  { cpu: ([p]) => [noiseReference.fbm3(p![0]!, p![1]!)], gpu: input => noise.fbm3(input(0).xy),
    name: "noise/fbm3", samples: POINTS.map(p => [p]), size: 1 }
];

const windCases = (wind: ReturnType<typeof createWindNodes>): TslParityCase[] => [
  { cpu: ([a, b]) => windReference.windDisplacement(v2(a!), a![2]!, a![3]!, v2(b!), v2(b!, 2)),
    gpu: input => wind.windDisplacement(input(0).xy, input(0).z, input(0).w, input(1).xy, input(1).zw),
    name: "wind/displacement", samples: [[[12.5, 4.2, 0.7, 3.1], [1.2, 0.4, 2.5, 7.1]],
      [[-8.3, 17.9, 2.1, 41.7], [0.3, -0.9, 11.2, 3.3]], [[3.3, 3.3, 0, 0.2], [0, 0, 0, 0]]], size: 2 },
  { cpu: ([a]) => windReference.flutterOffset(v3(a!), a![3]!, 3.1),
    gpu: input => wind.flutterOffset(input(0).xyz, input(0).w, float(3.1)), name: "wind/flutter",
    samples: [[[1, 2, 3, 0.7]], [[-4.2, 0.3, 9.9, 5.1]]], size: 3 },
  { cpu: ([a, b]) => windReference.branchSway(v3(a!), a![3]!, b![2]!, v2(b!)),
    gpu: input => wind.branchSway(input(0).xyz, input(0).w, input(1).z, input(1).xy), name: "wind/branch",
    samples: [[[1, 2, 3, 0.7], [1.2, 0.4, 3.1]], [[-4.2, 0.3, 9.9, 5.1], [0, 0.8, 27.3]]], size: 3 }
];

/** Rows: position xyz + cloth angle; cloth depth/flutter/normal-share + local wind x; wind z, time, strength, phase. */
const SHIP_CLOTH_SAMPLES: readonly (readonly Row[])[] = [
  [[0.2, 1.1, 0.4, 0.6], [0.8, 0.4, 0.9, 0.2], [1, 0.7, 0.8, 0.4]],
  [[-0.4, 0.3, 1.2, 2.1], [0.2, 0.7, 0.4, -0.6], [-0.4, 3.3, 0.2, 1.7]],
  [[0.8, 2.4, -0.6, -1.2], [1.1, 0.1, 0.2, 0.9], [0.3, 7.9, 1, 2.4]],
  [[0, 0.2, 0, 0.4], [0.5, 0.6, 0.3, 0.3], [0.8, 1.4, 0.5, 0.1]]
];

const shipClothCases = (): TslParityCase[] => {
  const offset = createShipClothOffset();
  const normal = createShipClothNormal();
  const stateOf = (b: Row, c: Row) => ({
    localX: b[3]!, localZ: c[0]!, phase: c[3]!, strength: c[2]!, time: c[1]!
  });
  const clothOf = (a: Row, b: Row) => [a[3]!, b[0]!, b[1]!, b[2]!] as const;
  return [
    {
      cpu: ([a, b, c]) => shipClothReference.shipClothOffset(v3(a!), clothOf(a!, b!), stateOf(b!, c!)),
      gpu: input => offset(input(0).xyz, vec4(input(0).w, input(1).x, input(1).y, input(1).z),
        vec2(input(1).w, input(2).x), input(2).y, input(2).z, input(2).w),
      name: "ship/cloth-offset", samples: SHIP_CLOTH_SAMPLES, size: 3
    },
    {
      cpu: ([a, b, c, n]) => shipClothReference.shipClothNormal(v3(a!), clothOf(a!, b!), stateOf(b!, c!), v3(n!)),
      gpu: input => normal(input(0).xyz, vec4(input(0).w, input(1).x, input(1).y, input(1).z),
        vec2(input(1).w, input(2).x), input(2).y, input(2).z, input(2).w, input(3).xyz),
      name: "ship/cloth-normal",
      samples: SHIP_CLOTH_SAMPLES.map((rows, index) => [...rows,
        [0.35 + index * 0.1, 0.85, 0.4 - index * 0.12]]),
      size: 3
    }
  ];
};

/** Rows: [root, phase, -], [eye x/z, fade start, fade end] (ring hole off). */
const GRASS_KEEP_SAMPLES: readonly (readonly Row[])[] = [
  [[10, 10, 0.4], [12, 9, 6, 10]], [[20, 4, 3.9], [12, 9, 6, 10]], [[20, 9, Math.PI], [12, 9, 6, 10]],
  [[19, 9, 5.9], [12, 9, 6, 10]], [[15.3, 8.1, 5.6], [12, 9, 6, 10]],
  [[2, 2, 1.2], [0, 0, 1e9, 1e9]], [[40, 40, 6.1], [12, 9, 6, 10]]
];
/** Ring shape (density, full density, radius, tuft cover) and hole rows: [root, -], [eye x/z, radius, blend]. */
const GRASS_RING_SHAPE = { bands: [], density: 1, fullDensity: 3, radius: 16, tuftCover: 0.78 } as const;
const GRASS_HOLE_SAMPLES: readonly (readonly Row[])[] = [
  [[1, 2], [0, 0, 16, 1]], [[5.5, 3.2], [0, 0, 16, 1]], [[11.7, 4.4], [0, 0, 16, 0.5]],
  [[14.1, 3.3], [0, 0, 16, 1]], [[30, 1], [0, 0, 16, 1]], [[3, 3], [0, 0, 16, 0]]
];

const grassCases = (noise: ReturnType<typeof createNoiseNodes>): TslParityCase[] => {
  const grass = createGrassKeepNodes(noise.valueNoise);
  const { density, fullDensity, radius, tuftCover } = GRASS_RING_SHAPE;
  const shape = vec4(density, fullDensity, radius, tuftCover);
  return [
    { cpu: ([a, r]) => [grassKeepAt(Math.hypot(a![0]! - r![0]!, a![1]! - r![1]!),
      (a![2]! / (2 * Math.PI)) % 1, r![2]!, r![3]!)],
    gpu: input => grass.grassKeep(input(1), vec4(0), shape, input(0).xy, input(0).z),
    name: "grass/keep", samples: GRASS_KEEP_SAMPLES, size: 1 },
    { cpu: ([a, h]) => [grassHoleKeepAt(GRASS_RING_SHAPE, Math.hypot(a![0]! - h![0]!, a![1]! - h![1]!), h![3]!,
      noiseReference.valueNoise(a![0]! * GRASS_RING_EDGE_NOISE_SCALE, a![1]! * GRASS_RING_EDGE_NOISE_SCALE))],
    gpu: input => grass.holeKeep(input(1), shape, input(0).xy), name: "grass/hole-keep",
    samples: GRASS_HOLE_SAMPLES, size: 1 }
  ];
};

const FOG_COLOR: V3 = [0.12, 0.18, 0.24];

/** Rows: [color, visibility], [xz, time, exploration], [view, lit], [sun, rain], [sun colour]. */
const FOG_CLOUD_SAMPLES: readonly (readonly Row[])[] = [
  [0.28, 0, 0], [0.28, 0, 1], [0.6, 0, 1], [0.96, 0, 1], [0.28, 1, 1], [0.28, 0.5, 1], [0.05, 0, 1]
].map(([visibility, exploration, lit]) => [[0.4, 0.5, 0.3, visibility!], [12.5, 4.2, 3.1, exploration!],
  [0, 0.3, 1, lit!], [0.3, 0.8, 0.2, 0.2], [1, 0.9, 0.7]]);

const fogCases = (fog: ReturnType<typeof createFogNodes>): TslParityCase[] => [
  { cpu: ([a]) => [fogReference.fogVisibilityFade(a![0]!)], gpu: input => fog.fogVisibilityFade(input(0).x),
    name: "fog/visibility-fade", samples: [[[0.05]], [[0.28]], [[0.4]], [[0.9]]], size: 1 },
  { cpu: ([a]) => [fogReference.fogCoverPuffs(v2(a!), a![2]!)],
    gpu: input => fog.fogCoverPuffs(input(0).xy, input(0).z), name: "fog/cover-puffs",
    samples: POINTS.map(p => [[p[0]!, p[1]!, 3.1]]), size: 1 },
  { cpu: ([a]) => fogReference.fogCoverColor(a![0]!, FOG_COLOR),
    gpu: input => fog.fogCoverColor(input(0).x, vec3(...FOG_COLOR)), name: "fog/cover-colour",
    samples: [[[0.1]], [[0.62]], [[0.9]]], size: 3 },
  { cpu: ([a, b, c, d]) => fogReference.litFogCover(a![0]!, v2(a!, 1), a![3]!, v3(b!), v3(c!), v3(d!),
    b![3]!, FOG_COLOR),
  gpu: input => fog.litFogCover(input(0).x, input(0).yz, input(0).w, input(1).xyz, input(2).xyz,
    input(3).xyz, input(1).w, vec3(...FOG_COLOR)), name: "fog/lit-cover",
  samples: [[[0.62, 12.5, 4.2, 3.1], [0, 0.3, 1, 0.2], [0.3, 0.8, 0.2], [1, 0.9, 0.7]],
    [[0.3, -20.7, 61.3, 17.9], [0.4, 0.9, -0.2, 0], [-0.5, 0.4, 0.7], [0.4, 0.5, 0.9]]], size: 3 },
  { cpu: ([a, b, c, d, e]) => fogReference.applyFogClouds(v3(a!), a![3]!, v2(b!), b![2]!, b![3]!, c![3]!,
    FOG_COLOR, d![3]!, v3(c!), v3(d!), v3(e!)),
  gpu: input => fog.applyFogClouds(input(0).xyz, input(0).w, input(1).xy, input(1).z, input(1).w,
    input(2).w, vec3(...FOG_COLOR), input(3).w, input(2).xyz, input(3).xyz, input(4).xyz),
  name: "fog/apply-clouds", samples: FOG_CLOUD_SAMPLES, size: 3 },
  { cpu: ([a, b]) => fogReference.applyMapEdge(v3(a!), v2(b!), v2(b!, 2)),
    gpu: input => fog.applyMapEdge(input(0).xyz, input(1).xy, input(1).zw), name: "fog/map-edge",
    samples: [[2, 2, 128, 128], [64, 64, 128, 128], [-30, 40, 128, 128], [-30, 2, 0, 0]]
      .map(row => [[0.4, 0.5, 0.3], row]), size: 3 },
  { cpu: ([a]) => [fogReference.getMapInterior(v2(a!), v2(a!, 2))],
    gpu: input => fog.getMapInterior(input(0).xy, input(0).zw), name: "fog/map-interior",
    samples: [[[2, 2, 128, 128]], [[64, 3.5, 128, 128]], [[5, 5, 0, 0]]], size: 1 }
];

/** A tiny RG8 volume whose red channel encodes the x texel: validates sampler3D support. */
const NOISE3D_SIZE = 4;
const createNoise3D = () => {
  const pixels = new Uint8Array(NOISE3D_SIZE ** 3 * 2);
  for (let z = 0; z < NOISE3D_SIZE; z++)
    for (let y = 0; y < NOISE3D_SIZE; y++)
      for (let x = 0; x < NOISE3D_SIZE; x++) {
        const offset = ((z * NOISE3D_SIZE + y) * NOISE3D_SIZE + x) * 2;
        pixels[offset] = x * 60;
        pixels[offset + 1] = y * 60;
      }
  const volume = new Data3DTexture(pixels, NOISE3D_SIZE, NOISE3D_SIZE, NOISE3D_SIZE);
  volume.format = RGFormat;
  volume.magFilter = volume.minFilter = LinearFilter;
  volume.unpackAlignment = 1;
  volume.needsUpdate = true;
  return volume;
};
const NOISE_3D = createNoise3D();

/** The 2D control: a 4x4 RGBA texture whose red channel encodes the x texel. */
const createNoise2D = () => {
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) pixels[(y * 4 + x) * 4] = x * 60;
  const plane = new DataTexture(pixels, 4, 4, RGBAFormat, UnsignedByteType);
  plane.magFilter = plane.minFilter = LinearFilter;
  plane.needsUpdate = true;
  return plane;
};
const NOISE_2D = createNoise2D();

/** Red channel of the texel the unit coordinate lands in, as the CPU mirror. */
const cpuNoise3D = (point: readonly number[]) => {
  const texel = (value: number) => Math.min(NOISE3D_SIZE - 1,
    Math.max(0, Math.floor(value * NOISE3D_SIZE)));
  return [texel(point[0]!) * 60 / 255];
};

const fract = (value: number) => value - Math.floor(value);
const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** CPU mirrors of the pure possessed-sky helpers (GLSL formulas). */

const cpuMilkyWay = (direction: readonly number[]): number => {
  const axis = [0.32, 0.55, 0.77];
  const axisLength = Math.hypot(...axis);
  const latitude = direction.reduce((sum, value, index) => sum + value * axis[index]! / axisLength, 0);
  const band = Math.exp(-latitude * latitude / 0.05);
  const clumps = 0.65 + 0.35 * Math.sin(direction[0]! * 9 + 1.3)
    * Math.sin(direction[2]! * 7 + 0.4);
  const rift = 1 - 0.45 * Math.exp(-((latitude - 0.03) ** 2) / 0.002);
  return band * clumps * rift;
};

const cpuShellDistance = (direction: readonly number[], cameraAltitude: number,
  altitude: number) => {
  const { planetRadius } = EXPLORATION_CLOUD;
  const originRadius = planetRadius + cameraAltitude;
  const shellRadius = planetRadius + altitude;
  const projected = originRadius * direction[1]!;
  const radiusDifference = (shellRadius - originRadius) * (shellRadius + originRadius);
  return radiusDifference / (Math.sqrt(projected * projected + radiusDifference) + projected);
};

const cpuHeightFraction = (point: readonly number[]) => {
  const { bottom, planetRadius, top } = EXPLORATION_CLOUD;
  const altitude = Math.hypot(point[0]!, point[1]! + planetRadius, point[2]!) - planetRadius;
  return (altitude - bottom) / (top - bottom);
};

const cpuTangentOffset = (direction: readonly number[], light: readonly number[]) => {
  const scale = 1 / Math.max(1 + light[1]!, 0.00001);
  const xz = -light[0]! * light[2]! * scale;
  const right = [1 - light[0]! * light[0]! * scale, -light[0]!, xz];
  const up = [xz, -light[2]!, 1 - light[2]! * light[2]! * scale];
  return [
    direction[0]! * right[0]! + direction[1]! * right[1]! + direction[2]! * right[2]!,
    direction[0]! * up[0]! + direction[1]! * up[1]! + direction[2]! * up[2]!
  ];
};

const SKY_DIRECTIONS: readonly V3[] = [[0, 1, 0], [0.5, 0.5, 0.7], [-0.6, 0.2, -0.77],
  [0.3, 0.9, 0.3], [0, 0.1, 1], [0.8, -0.2, 0.55]];
const SKY_LIGHTS: readonly V3[] = [[0.6, 0.6, 0.3], [0, 0.14, 1], [-0.5, 0.8, 0.2]];
const SKY_POINTS: readonly V3[] = [[120, 1500, -80], [0, 2200, 0], [-400, 900, 1500],
  [100, 50, 100], [30, 3600, 40]];

const hashScaled = Fn(([p]: [TslNode]) =>
  p.mul(vec3(0.1031, 0.103, 0.0973)).fract());
const cpuHashScaled = (p: readonly number[]) =>
  p.map((value, index) => fract(value * [0.1031, 0.103, 0.0973][index]!));

const skyCases = (): TslParityCase[] => [
  {
    cpu: rows => {
      const inputs = createSkyModelInputs();
      inputs.daylight = rows[0]![3]!;
      inputs.fog.set(rows[3]!.slice(0, 3));
      inputs.sky.set(rows[2]!.slice(0, 3));
      inputs.sun.set(rows[1]!.slice(0, 3));
      inputs.sunColor.set(rows[4]!.slice(0, 3));
      const target = new Float64Array(3);
      writeSkyModelRadiance(inputs, rows[0]![0]!, rows[0]![1]!, rows[0]![2]!, target);
      return [...target];
    },
    gpu: input => createSkyModelNodes({ ambientSky: input(2).xyz, fogColor: input(3).xyz,
      lutTexture: null, sunColor: input(4).xyz }).radiance(input(0).xyz, input(1).xyz,
      input(0).w),
    name: "sky/model",
    samples: SKY_DIRECTIONS.map((direction, index) => [[...direction, 0.2 + index * 0.14],
      SKY_LIGHTS[index % SKY_LIGHTS.length]!, [0.52, 0.6, 0.72], [0.74, 0.78, 0.84],
      [1.08, 0.98, 0.84]]),
    size: 3
  },
  {
    cpu: ([p]) => cpuHashScaled(p!),
    gpu: input => hashScaled(input(0).xyz), name: "sky/hash-scaled",
    samples: SKY_POINTS.map(point => [point]), size: 3
  },
  // `starHash` itself is not a parity case: its dot product reaches ~37^2 before the final
  // fract, so an f64 CPU reference cannot reproduce the GPU's f32 result (the TSL and the GLSL
  // share the formula and the shader's float semantics; only the noise pattern matters).
  {
    cpu: ([p]) => [cpuMilkyWay(p!)],
    gpu: input => starMilkyWay(input(0).xyz), name: "sky/star-milky-way",
    samples: SKY_DIRECTIONS.map(direction => [direction]), size: 1
  },
  {
    cpu: ([p]) => cpuNoise3D(p!),
    gpu: input => texture3D(NOISE_3D, input(0).xyz).r, name: "sky/noise-3d",
    samples: [[[0.125, 0.125, 0.125]], [[0.375, 0.375, 0.375]], [[0.625, 0.625, 0.625]],
      [[0.875, 0.875, 0.875]]], size: 1
  },
  {
    cpu: ([p]) => cpuNoise3D(p!),
    gpu: input => texture(NOISE_2D, input(0).xy).r, name: "sky/noise-2d",
    samples: [[[0.125, 0.125, 0]], [[0.375, 0.375, 0]], [[0.625, 0.625, 0]],
      [[0.875, 0.875, 0]]], size: 1
  },
  {
    // Scaled by 1/1000: f32 precision at 10-40 km would exceed the absolute tolerance.
    cpu: ([a, b]) => [cpuShellDistance(a!, a![3]!, b![0]!) / 1000],
    gpu: input => skyShellDistance(input(0).xyz, input(0).w, input(1).x).div(1000),
    name: "sky/cloud-shell",
    samples: SKY_DIRECTIONS.map((direction, index) =>
      [[...direction, index * 40], [1000 + index * 300]]), size: 1
  },
  {
    cpu: ([p]) => [cpuHeightFraction(p!)],
    gpu: input => skyHeightFraction(input(0).xyz), name: "sky/cloud-height",
    samples: SKY_POINTS.map(point => [point]), size: 1
  },
  {
    cpu: ([p]) => [Math.min(1, Math.max(0, (p![0]! - p![1]!) / Math.max(p![2]! - p![1]!, 0.0001)))],
    gpu: input => skyRemap(input(0).x, input(0).y, input(0).z), name: "sky/remap",
    samples: [[[0.3, 0.2, 0.9]], [[0.1, 0.4, 0.2]], [[0.8, 0.8, 0.8]], [[0.5, 0.1, 0.6]]],
    size: 1
  },
  {
    cpu: ([a]) => {
      const denominator = 1 + a![1]! * a![1]! - 2 * a![1]! * a![0]!;
      return [(1 - a![1]! * a![1]!) / (denominator * Math.sqrt(denominator))];
    },
    gpu: input => skyCloudPhase(input(0).x, input(0).y), name: "sky/cloud-phase",
    samples: [[[0.9, 0.5]], [[0.2, 0.78]], [[-0.4, 0.7]], [[0.99, 0.2]]], size: 1
  },
  {
    cpu: ([a]) => [(1 - a![1]!) * smooth(-0.01, 0.035, a![0]!)],
    gpu: input => explorationLowCloudOpacity(input(0).y, input(0).x),
    name: "sky/cloud-low-opacity",
    samples: [[[0.2, 0.1]], [[-0.02, 0.4]], [[0.5, 0.9]], [[0.01, 0]]], size: 1
  },
  {
    cpu: ([a, b]) => cpuTangentOffset(a!, b!),
    gpu: input => skyLightTangentOffset(input(0).xyz, input(1).xyz), name: "sky/tangent-offset",
    samples: SKY_DIRECTIONS.map((direction, index) =>
      [direction, SKY_LIGHTS[index % SKY_LIGHTS.length]!]), size: 2
  }
];

/** The shared table case (tests/webgpu-tsl-reference.test.ts) with a tilted SH9 sky. */
const LIGHTING: lightingReference.LightingReferenceInputs = {
  ambientSky: [0.5, 0.6, 0.8],
  cloudCover: 0.6,
  cloudDrift: [3.5, 1.25],
  highlight: 0.8,
  rain: 0.4,
  skyIrradiance: [0.35, 0.39, 0.45, 0.15, 0.25, 0.35, 0.01, 0.02, 0.03, 0.04, 0, 0.01, 0.02, 0.03, 0.04,
    0, 0.01, 0.02, 0.03, 0.04, 0, 0.01, 0.02, 0.03, 0.04, 0, 0.01],
  sunColor: [1, 0.92, 0.8],
  sunDirection: [0.48, 0.8, 0.36],
  viewDirection: [0, 0.6, 0.8]
};
const NORMALS: readonly Row[] = [[0.6, 0.64, 0.48], [0, 1, 0], [0, -1, 0], [-0.8, 0.6, 0], [0.36, 0.48, -0.8]];

const createLighting = (fbm3: (point: TslNode) => TslNode, lowOrderSky: boolean) => {
  const { ambientSky, cloudCover, cloudDrift, highlight, rain, skyIrradiance, sunColor, sunDirection,
    viewDirection } = LIGHTING;
  return createLightingNodes({
    ambientSky: vec3(...ambientSky), cloudCover: float(cloudCover), cloudDrift: vec2(...cloudDrift), fbm3,
    highlight: float(highlight), lowOrderSky, rain: float(rain),
    skyIrradiance: Array.from({ length: 9 }, (_, index) =>
      vec3(skyIrradiance[index * 3]!, skyIrradiance[index * 3 + 1]!, skyIrradiance[index * 3 + 2]!)),
    sunColor: vec3(...sunColor), sunDirection: vec3(...sunDirection), viewDirection: vec3(...viewDirection)
  });
};

const lightingCases = (fbm3: (point: TslNode) => TslNode): TslParityCase[] => {
  const full = createLighting(fbm3, false);
  const lowOrder = createLighting(fbm3, true);
  return [
    { cpu: ([n]) => lightingReference.skyIrradiance(LIGHTING.skyIrradiance, v3(n!)),
      gpu: input => full.skyIrradiance(input(0).xyz), name: "lighting/sky-irradiance",
      samples: NORMALS.map(n => [n]), size: 3 },
    { cpu: ([n]) => lightingReference.skyIrradiance(LIGHTING.skyIrradiance, v3(n!), true),
      gpu: input => lowOrder.skyIrradiance(input(0).xyz), name: "lighting/sky-irradiance-l1",
      samples: NORMALS.map(n => [n]), size: 3 },
    { cpu: ([p]) => [lightingReference.cloudShadow(v2(p!), LIGHTING)], gpu: input => full.cloudShadow(input(0).xy),
      name: "lighting/cloud-shadow", samples: [...POINTS, [40, 22]].map(p => [p]), size: 1 },
    { cpu: ([a, n, p]) => lightingReference.lightSurface(v3(a!), v3(n!), a![3]!, n![3]!, v2(p!), LIGHTING),
      gpu: input => full.lightSurface(input(0).xyz, input(1).xyz, input(0).w, input(1).w, input(2).xy),
      name: "lighting/light-surface",
      samples: NORMALS.map((n, index) => [[0.4, 0.5, 0.3, 0.9 - index * 0.1], [...n, 0.85], POINTS[index]!]),
      size: 3 }
  ];
};

const ROCK_WORLDS: readonly V3[] = [
  [12.5, 4.2, -3.1], [-8.3, 7.9, 17.4], [0.5, 2.2, 0.6], [31.7, 11.3, -22.9], [-4.1, 9.9, 8.8]
];
const ROCK_DIRECTIONS: readonly V3[] = [
  [0.6, 0.64, 0.48], [0, 1, 0], [-0.8, 0.6, 0], [0.36, 0.48, -0.8], [0.2, 0.1, 0.97]
];
const ROCK_ALBEDOS: readonly V3[] = [
  [0.4, 0.42, 0.45], [0.6, 0.5, 0.36], [0.2, 0.22, 0.2], [0.55, 0.55, 0.6], [0.8, 0.7, 0.55]
];
const ROCK_MATERIALS: readonly (readonly [number, number, number, number])[] = [
  [0.5, 0.5, 0.5, 0.5], [0.8, 0.2, 0.7, 0.3], [0.1, 0.9, 0.2, 0.8], [0.35, 0.65, 0.45, 0.55],
  [0.65, 0.35, 0.85, 0.25]
];
const ROCK_PATCHES: readonly V2[] = [[0.2, 0.8], [0.5, 0.5], [0.75, 0.3], [0.95, 0.6], [0.35, 0.1]];
const ROCK_TURNS: readonly number[] = [0.1, 0.5, 0.9, 0.35, 0.7];
const ROCK_TILE_SCALE = { detail: ROCK_STONE_DETAIL_SCALE, tile: ROCK_TILE } as const;

/** The packed rock texture of the parity bench: nearest/repeat, no mipmaps. */
const createRockTexture = () => {
  const texture = new DataTexture(rockReference.createRockTestPixels(),
    rockReference.ROCK_TEST_SIZE, rockReference.ROCK_TEST_SIZE, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** The packed normal map of the assembled rock case: nearest/repeat, no mipmaps. */
const createRockNormalTexture = () => {
  const texture = new DataTexture(rockReference.createRockNormalTestPixels(),
    rockReference.ROCK_NORMAL_TEST_SIZE, rockReference.ROCK_NORMAL_TEST_SIZE, RGBAFormat,
    UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** The rock-only light inputs (ROCK_FILL_GLSL); the shared light uses the LIGHTING table. */
const ROCK_LIGHT: rockReference.RockLightReferenceInputs = {
  ambientGround: [0.35, 0.31, 0.26],
  ambientSky: LIGHTING.ambientSky,
  highlight: LIGHTING.highlight,
  sunColor: LIGHTING.sunColor,
  sunDirection: LIGHTING.sunDirection,
  viewDirection: LIGHTING.viewDirection
};

/**
 * Rows of the assembled rock cases: world+footprint, normal, mask, extra, macro normal, snow
 * map+time, strata/joint footprints, light xz.
 */
const ROCK_ASSEMBLED_SAMPLES: readonly (readonly Row[])[] = ROCK_WORLDS.map((world, index) => [
  [...world, 0.03 + index * 0.015],
  [...ROCK_DIRECTIONS[index]!, 0.3],
  [0.55, 0.2 + index * 0.15, 0.15 + index * 0.17, 0.1 + index * 0.2],
  [1, 0, 0.25 + index * 0.15, index === 1 ? 0 : 0.2 + index * 0.18],
  [0.15, 0.9, -0.25, 0.7],
  [index * 0.12, 0.5 + index * 1.3],
  [0.002, 0.0015],
  [12.5 + index * 3.1, 4.2 - index * 1.7]
]);

const rockCases = (noise: ReturnType<typeof createNoiseNodes>): TslParityCase[] => {
  const rockTexture = createRockTexture();
  const rockNormalTexture = createRockNormalTexture();
  const sample = rockReference.sampleRockTestTexture(rockReference.createRockTestPixels());
  const normalSample = rockReference.sampleRockTestNormal(
    rockReference.createRockNormalTestPixels());
  const deposits = createDepositDetailNodes(noise.valueNoise, noise.valueNoise4);
  const planeSamples = ROCK_DIRECTIONS.map((normal, index) => [[...normal, ROCK_TURNS[index]!]]);
  const uvCases = ROCK_WORLDS.map((world, index) => [[...world, 0], [...ROCK_DIRECTIONS[index]!, 0]]);
  const form = createRockFormNodes(noise.valueNoise, noise.valueNoise4, true);
  const lightingNodes = createLighting(noise.fbm3, false);
  const rockLightNodes = createRockLightNodes({
    ambientGround: vec3(...ROCK_LIGHT.ambientGround),
    ambientSky: vec3(...ROCK_LIGHT.ambientSky),
    highlight: float(ROCK_LIGHT.highlight),
    sunColor: vec3(...ROCK_LIGHT.sunColor),
    sunDirection: vec3(...ROCK_LIGHT.sunDirection),
    viewDirection: vec3(...ROCK_LIGHT.viewDirection)
  });
  const shadingNodes = createRockShadingNodes(lightingNodes, rockLightNodes);
  const assembledSurface = (input: (row: number) => TslNode) => createRockSurfaceNodes({
    detailed: true,
    fbm3: noise.fbm3,
    fractureFootprint: input(6).y,
    getFractures: form.getFractures,
    macroNormal: () => input(4),
    rockNormal: rockNormalTexture,
    rockTexture,
    snowAt: () => input(5).x,
    strataFootprint: input(6).x,
    time: input(5).y,
    valueNoise: noise.valueNoise,
    valueNoise4: noise.valueNoise4
  }).getRockDetailSurface(input(0).xyz, input(1).xyz, input(2), input(3), input(0).w);
  const assembledInputs = (rows: readonly Row[]): rockReference.RockSurfaceReferenceInputs => {
    const snowAt = rows[5]![0]!;
    const warmLine = ROCK_SNOW_LINE;
    const snowLine = rows[0]![1]! < warmLine - ROCK_WINTER_SNOW_LINE_DROP - 1
      ? warmLine
      : warmLine - snowAt * ROCK_WINTER_SNOW_LINE_DROP;
    return {
      detailed: true,
      fractureFootprint: rows[6]![1]!,
      macroNormal: [rows[4]![0]!, rows[4]![1]!, rows[4]![2]!, rows[4]![3]!],
      normalSample,
      rockSample: sample,
      snowLine,
      strataFootprint: rows[6]![0]!,
      time: rows[5]![1]!,
      worldFootprint: rows[0]![3]!
    };
  };
  return [
    // hashRockId multiplies by 43758.5, which amplifies the f32-vs-f64 sine difference past
    // 1e-4; the plane *normal* is parity-tested, the hash tone is verified by the captures.
    { cpu: ([a = []]) => [...rockReference.getRockPlanes(v3(a), a[3]!, 0.7).normal],
      gpu: input => getRockPlanes(input(0).xyz, input(0).w, 0.7).normal,
      name: "rock/planes", samples: planeSamples, size: 3 },
    { cpu: ([a = []]) => [rockReference.getRockPlanes(v3(a), a[3]!, 0.7).edge],
      gpu: input => getRockPlanes(input(0).xyz, input(0).w, 0.7).edge,
      name: "rock/planes-edge", samples: planeSamples, size: 1 },
    { cpu: ([a = []]) => [rockReference.getSnowLee(v3(a))],
      gpu: input => getSnowLee(input(0).xyz),
      name: "rock/snow-lee", samples: ROCK_DIRECTIONS.map(n => [[...n, 0]]), size: 1 },
    { cpu: ([a = []]) => rockReference.getSnowNormal(v3(a)),
      gpu: input => getSnowNormal(input(0).xyz),
      name: "rock/snow-normal", samples: ROCK_DIRECTIONS.map(n => [[...n, 0]]), size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.getSnowColor(v3(a), v3(b), [a[3]!, b[3]!]),
      gpu: input => getSnowColor(input(0).xyz, input(1).xyz, vec2(input(0).w, input(1).w)),
      name: "rock/snow-color", samples: ROCK_WORLDS.map((world, index) =>
        [[...world, ROCK_PATCHES[index]![0]], [...ROCK_DIRECTIONS[index]!, ROCK_PATCHES[index]![1]]]),
      size: 3 },
    { cpu: ([a = [], b = [], c = [], d = []]) => [rockReference.getSnowCover(v3(a), v3(b),
        [0, 0, 0, b[3]!], [c[0]!, c[1]!, c[2]!, c[3]!], [d[0]!, d[1]!], a[3]!)],
      gpu: input => getSnowCover(input(0).xyz, input(1).xyz, vec4(0, 0, 0, input(1).w), input(2),
        vec2(input(3).x, input(3).y), input(0).w),
      name: "rock/snow-cover", samples: ROCK_WORLDS.map((world, index) =>
        [[...world, 6 + index * 0.4], [...ROCK_DIRECTIONS[index]!, 0.4], [...ROCK_MATERIALS[index]!],
          [...ROCK_PATCHES[index]!]]), size: 1 },
    { cpu: ([a = []]) => rockReference.getStonePalette(a[0]!, a[1]!, a[2]!),
      gpu: input => getStonePalette(input(0).x, input(0).y, input(0).z), name: "rock/palette",
      samples: [[[0.2, 0.4, 0.3]], [[0.7, 0.6, 0.9]], [[0.9, 0.2, 0.1]], [[0.45, 0.55, 0.6]]], size: 3 },
    { cpu: ([a = []]) => rockReference.decodeRockTint(a[0]!),
      gpu: input => decodeRockTint(input(0).x), name: "rock/decode-tint",
      samples: [[[0.2]], [[0.5]], [[0.65]], [[0.9]]], size: 3 },
    { cpu: ([a = [], b = [], c = []]) => {
        const z = rockReference.getRockZones([a[0]!, a[1]!, a[2]!, a[3]!], b[0]!,
          [c[0]!, c[1]!, c[2]!, c[3]!], b[1]!);
        return [z.clean, z.weathered, z.loose]; },
      gpu: input => { const z = getRockZones(input(0), input(1).x, input(2), input(1).y);
        return vec3(z.clean, z.weathered, z.loose); }, name: "rock/zones",
      samples: ROCK_MATERIALS.map((materials, index) =>
        [[0.3 + index * 0.1, 0.2, 0.6 - index * 0.1, 0.4], [0.5 - index * 0.1, 0.1 + index * 0.15],
          [...materials]]), size: 3 },
    { cpu: ([a = []]) => rockReference.getCleanRock(v3(a), [a[3]!, 0, 0, 0]),
      gpu: input => getCleanRock(input(0).xyz, vec4(input(0).w, 0, 0, 0)),
      name: "rock/clean", samples: ROCK_ALBEDOS.map((albedo, index) => [[...albedo, index * 0.25]]),
      size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.getLooseRock(v3(a), [0, 0, a[3]!, 0],
        [0, b[2]!, 0, 0]),
      gpu: input => getLooseRock(input(0).xyz, vec4(0, 0, input(0).w, 0),
        vec4(0, input(1).z, 0, 0)), name: "rock/loose",
      samples: ROCK_ALBEDOS.map((albedo, index) =>
        [[...albedo, index * 0.2], [0, 0, 0.15 + index * 0.2]]), size: 3 },
    { cpu: ([a = [], b = [], c = []]) => rockReference.getWeatheredRock(v3(a), [0, a[3]!, 0, 0],
        v3(b), v3(c), [0, b[3]!, 0, 0], true),
      gpu: input => getWeatheredRock(input(0).xyz, vec4(0, input(0).w, 0, 0), input(1).xyz,
        input(2).xyz, vec4(0, input(1).w, 0, 0), true, noise.valueNoise, noise.fbm3),
      name: "rock/weathered", samples: ROCK_ALBEDOS.map((albedo, index) =>
        [[...albedo, index * 0.22], [...ROCK_WORLDS[index]!, 0.2 + index * 0.15],
          [...ROCK_DIRECTIONS[index]!, 0]]), size: 3 },
    { cpu: ([a = [], b = [], c = []]) => rockReference.applyPlaneValues(v3(a),
        { edge: c[0]!, normal: v3(b), tone: b[3]! }, a[3]!),
      gpu: input => applyPlaneValues(input(0).xyz,
        { edge: input(2).x, normal: input(1).xyz, tone: input(1).w }, input(0).w),
      name: "rock/plane-values", samples: ROCK_ALBEDOS.map((albedo, index) =>
        [[...albedo, index * 0.2], [...ROCK_DIRECTIONS[index]!, index * 0.2 - 0.4],
          [index * 0.15, 0, 0]]), size: 3 },
    { cpu: ([a = [], b = [], c = []]) => rockReference.applyShelfGrowth(v3(a), v3(b),
        [0, c[0]!, 0, c[1]!], a[3]!, b[3]!),
      gpu: input => applyShelfGrowth(input(0).xyz, input(1).xyz, vec4(0, input(2).x, 0, input(2).y),
        input(0).w, input(1).w),
      name: "rock/shelf-growth", samples: ROCK_ALBEDOS.map((albedo, index) =>
        [[...albedo, ROCK_PATCHES[index]![0]], [...ROCK_DIRECTIONS[index]!, 0.2 - index * 0.1],
          [0.3 + index * 0.15, 0.5 - index * 0.08]]), size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.applyWetRock(v3(a), v3(b), a[3]!, b[3]!),
      gpu: input => applyWetRock(input(0).xyz, input(1).xyz, input(0).w, input(1).w),
      name: "rock/wet-rock", samples: ROCK_ALBEDOS.map((albedo, index) =>
        [[...albedo, index * 0.25], [...ROCK_DIRECTIONS[index]!, 0.15 * index]]), size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.applyStrata(v3(a),
        { lip: b[0]!, seam: b[1]!, band: 0 }, a[3]!),
      gpu: input => applyStrata(input(0).xyz, { lip: input(1).x, seam: input(1).y },
        input(0).w), name: "rock/strata-shade",
      samples: ROCK_ALBEDOS.map((albedo, index) =>
        [[...albedo, index * 0.2], [0.1 + index * 0.15, 0.3 - index * 0.05]]), size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.getFormNormal(v3(a),
        [b[0]!, b[1]!, b[2]!, b[3]!], a[3]!),
      gpu: input => getFormNormal(input(0).xyz, input(1).xyz, input(0).w, () => input(1)),
      name: "rock/form-normal", samples: ROCK_DIRECTIONS.map((normal, index) =>
        [[...normal, index * 0.25], [0.2 + index * 0.1, 0.9 - index * 0.2, -0.1, 1 - index * 0.15]]),
      size: 3 },
    { cpu: ([a = [], b = []]) => [rockReference.getFineGrain(
        rockReference.getRockUv(v3(a), v3(b), ROCK_TILE_SCALE.tile), a[3]!, b[3]!)],
      gpu: input => getFineGrain(getRockUv(input(0).xyz, input(1).xyz), input(0).w, input(1).w,
        noise.valueNoise), name: "rock/fine-grain", samples: ROCK_WORLDS.map((world, index) =>
        [[...world, index * 0.2], [...ROCK_DIRECTIONS[index]!, 0.002 + index * 0.02]]), size: 1 },
    { cpu: ([a = [], b = []]) => [rockReference.getRunoff(v3(a), v3(b))],
      gpu: input => getRunoff(input(0).xyz, input(1).xyz, noise.valueNoise), name: "rock/runoff",
      samples: uvCases, size: 1 },
    { cpu: ([a = [], b = []]) => [...rockReference.getRockUv(v3(a), v3(b),
        ROCK_TILE_SCALE.tile).weights],
      gpu: input => getRockUv(input(0).xyz, input(1).xyz).weights, name: "rock/uv-weights",
      samples: uvCases, size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.sampleRockTriplanar(
        rockReference.getRockUv(v3(a), v3(b), ROCK_TILE_SCALE.tile), sample),
      gpu: input => sampleRockTriplanar(rockTexture, getRockUv(input(0).xyz, input(1).xyz)),
      name: "rock/triplanar", samples: uvCases, size: 4 },
    { cpu: ([a = [], b = [], c = []]) => rockReference.applyStoneDetail(v3(a), v3(b), v3(c),
        a[3]!, sample, ROCK_TILE_SCALE.detail),
      gpu: input => applyStoneDetail(input(0).xyz, input(1).xyz, input(2).xyz, input(0).w,
        noise.valueNoise, rockTexture), name: "rock/stone-detail",
      samples: ROCK_WORLDS.map((world, index) => [[...ROCK_ALBEDOS[index]!, 0.3 - index * 0.1],
        [...world, 0], [...ROCK_DIRECTIONS[index]!, 0]]), size: 3 },
    { cpu: ([a = [], b = [], c = [], d = []]) => rockReference.applyMountainDetail(v3(a), v3(b),
        v3(c), { clean: 1 - d[0]!, loose: d[0]!, weathered: 0 }, a[3]!, sample),
      gpu: input => applyMountainDetail(input(0).xyz, input(1).xyz, input(2).xyz,
        { clean: float(1).sub(input(3).x), loose: input(3).x, weathered: float(0) },
        input(0).w, rockTexture), name: "rock/mountain-detail",
      samples: ROCK_WORLDS.map((world, index) => [[...ROCK_ALBEDOS[index]!, 0.2 - index * 0.08],
        [...world, 0], [...ROCK_DIRECTIONS[index]!, 0], [index * 0.2, 0, 0, 0]]), size: 3 },
    { cpu: ([a = [], b = []]) => rockReference.applyOreStone(v3(a), v3(b), a[3]!, b[3]!),
      gpu: input => Fn(() => applyOreStone(input(0).xyz, input(1).xyz, int(input(0).w),
        input(1).w, noise.fbm3))(), name: "rock/ore-stone",
      // Gold's glint is a 43758.5-amplified hash threshold: not f32/f64 parity-stable.
      samples: [0, 1, 2, 4].map((ore, index) => [[...ROCK_ALBEDOS[index]!, ore],
        [...ROCK_WORLDS[index]!, 0.5 + index * 1.3]]), size: 3 },
    { cpu: ([a = []]) => [...normalSample(a[0]!, a[1]!)], name: "rock/normal-texture",
      gpu: input => texture(rockNormalTexture, input(0).xy), samples: uvCases.map(([world]) => [world!]),
      size: 4 },
    { cpu: ([a = [], b = [], c = [], d = []]) => rockReference.getRockDetailNormal(v3(a),
        rockReference.getRockUv(v3(b), v3(c), ROCK_TILE_SCALE.tile),
        { clean: d[0]!, loose: d[2]!, weathered: d[1]! }, a[3]!, normalSample),
      gpu: input => getRockDetailNormal(input(0).xyz, getRockUv(input(1).xyz, input(2).xyz),
        { clean: input(3).x, loose: input(3).z, weathered: input(3).y }, input(0).w,
        rockNormalTexture), name: "rock/detail-normal",
      samples: ROCK_WORLDS.map((world, index) => [
        [...ROCK_DIRECTIONS[index]!, 0.9 - index * 0.15],
        [...world, 0],
        [...ROCK_DIRECTIONS[index]!, 0],
        [0.2 + index * 0.15, 0.5 - index * 0.08, 0.1 + index * 0.1]
      ]), size: 3 },
    // The assembled surface + light: a fixed world/normal/mask/light through the same
    // `getRockDetailSurface` and `assembleRockShading` the material uses, so wiring bugs (a
    // surface normal not reaching the light, a missing fill or specular term) fail the bench.
    { cpu: (rows) => rockReference.getRockDetailSurface(v3(rows[0]!), v3(rows[1]!),
        v4(rows[2]!), v4(rows[3]!), assembledInputs(rows)).normal,
      gpu: input => Fn(() => assembledSurface(input).normal)(), name: "rock/assembled-normal",
      samples: ROCK_ASSEMBLED_SAMPLES, size: 3 },
    { cpu: (rows) => {
        const surface = rockReference.getRockDetailSurface(v3(rows[0]!), v3(rows[1]!),
          v4(rows[2]!), v4(rows[3]!), assembledInputs(rows));
        return rockReference.assembleRockShading(surface.albedo, surface, 1, v2(rows[7]!),
          LIGHTING, ROCK_LIGHT);
      },
      gpu: input => Fn(() => {
        const surface = assembledSurface(input);
        return shadingNodes.assembleRockShading(surface.albedo, surface, float(1), input(7).xy);
      })(), name: "rock/assembled-shading", samples: ROCK_ASSEMBLED_SAMPLES, size: 3 },
    ...(["basalt", "granite", "limestone", "marble"] as const).map((family): TslParityCase => ({
      cpu: ([a = [], b = []]) => rockReference.applyDepositDetail(family, v3(a), v3(b), a[3]!),
      gpu: input => deposits[family](input(0).xyz, input(1).xyz, input(0).w),
      name: `rock/deposit-${family}`,
      samples: ROCK_WORLDS.map((world, index) => [[...ROCK_ALBEDOS[index]!, 0.01 + index * 0.02],
        [...world, 0]]),
      size: 3 as const
    }))
  ];
};


const WATER_SWELL_SAMPLES: readonly (readonly Row[])[] = [
  [[3.2, 7.1], [2.3, 0.4]], [[31.9, 1.3], [7.7, 0.9]], [[-5.43, 20.07], [0.4, 0.1]],
  [[100.37, -33.61], [12.1, 0.2]], [[0.53, 0.57], [3.3, 1]]
];
const WATER_DEPTH_SAMPLES: readonly (readonly Row[])[] = [
  [[0.1, 0, 0]], [[0.45, 0.3, 0]], [[1.2, 0, 0]], [[3.4, 0.05, 0.02]], [[8, 2, 1]]
];
const WATER_SURF_SAMPLES: readonly (readonly Row[])[] = [
  [[3.2, 7.1], [1.2], [2.3, 0.4]], [[31.9, 1.3], [-4.7], [7.7, 0.9]],
  [[-5.43, 20.07], [0.2], [0.4, 0.1]], [[12.31, 4.77], [6.1], [12.1, 0.2]]
];

const waterCases = (): TslParityCase[] => [
  { cpu: ([point, clock]) => waterReference.getSwell(v2(point!), clock![0]!),
    gpu: input => createWaterMathNodes({ highlight: input(1).y, time: input(1).x }).swell(input(0).xy),
    name: "water/swell", samples: WATER_SWELL_SAMPLES, size: 3 },
  { cpu: ([row]) => [waterReference.getSwellCalm(row![0]!, [row![1]!, row![2]!])],
    gpu: input => createWaterMathNodes({ highlight: input(0).x, time: float(0) })
      .swellCalm(input(0).x, input(0).yz), name: "water/swell-calm", samples: WATER_DEPTH_SAMPLES, size: 1 },
  { cpu: ([row]) => [waterReference.getSwellSlopeWeight(row![0]!, [row![1]!, row![2]!])],
    gpu: input => createWaterMathNodes({ highlight: input(0).x, time: float(0) })
      .swellSlopeWeight(input(0).x, input(0).yz), name: "water/swell-slope-weight",
    samples: WATER_DEPTH_SAMPLES, size: 1 },
  { cpu: ([row]) => [waterReference.waterShadowFloor(row![0]!)],
    gpu: input => createWaterMathNodes({ highlight: input(0).x, time: float(0) })
      .waterShadowFloor(input(0).x), name: "water/shadow-floor", samples: WATER_DEPTH_SAMPLES, size: 1 },
  { cpu: ([row]) => [waterReference.waterFresnel(row![0]!)],
    gpu: input => createWaterMathNodes({ highlight: input(0).x, time: float(0) })
      .waterFresnel(input(0).x), name: "water/fresnel",
    samples: [[[0]], [[0.2]], [[0.55]], [[0.9]], [[1]]], size: 1 },
  { cpu: ([row]) => [waterReference.foamGlare(row![0]!)],
    gpu: input => createWaterMathNodes({ highlight: input(0).x, time: float(0) }).foamGlare(),
    name: "water/foam-glare", samples: [[[0]], [[0.25]], [[0.7]], [[1]]], size: 1 },
  { cpu: ([xz, coast, clock]) => [waterReference.surfAge(v2(xz!), coast![0]!, clock![0]!)],
    gpu: input => createWaterMathNodes({ highlight: input(2).y, time: input(2).x })
      .surfAge(input(0).xy, input(1).x), name: "water/surf-age", samples: WATER_SURF_SAMPLES, size: 1 },
  { cpu: ([row]) => [waterReference.surfFreshness(row![0]!)],
    gpu: input => createWaterMathNodes({ highlight: input(0).x, time: float(0) })
      .surfFreshness(input(0).x), name: "water/surf-freshness",
    samples: [[[0]], [[0.04]], [[0.2]], [[0.8]], [[1]]], size: 1 },
  { cpu: ([xz, clock]) => [waterReference.surfSections(v2(xz!), clock![0]!)],
    gpu: input => createWaterMathNodes({ highlight: input(1).y, time: input(1).x })
      .surfSections(input(0).xy), name: "water/surf-sections",
    samples: WATER_SWELL_SAMPLES, size: 1 }
];


const WATER_SUN: V3 = [0.3, 0.8, 0.2];
const WATER_SUN_COLOUR: V3 = [1, 0.9, 0.7];
const WATER_GROUND_SAMPLES: readonly (readonly Row[])[] = [
  [[0.3, 0.8, 0.2]], [[-0.4, 0.6, -0.7]], [[0.05, 0.95, 0.31]]
];
const WATER_CAUSTIC_SAMPLES: readonly (readonly Row[])[] = [
  [[3.2, 7.1, 2.3]], [[31.9, 1.3, 7.7]], [[-5.43, 20.07, 0.4]], [[12.31, 4.77, 12.1]]
];
const WATER_GROUND_LIT_SAMPLES: readonly (readonly Row[])[] = [
  [[0.4, 0.35, 0.25, 1.2], [3.2, 7.1, 2.3, 0]], [[0.1, 0.4, 0.35, 0.5], [31.9, 1.3, 7.7, 0]],
  [[0.6, 0.55, 0.4, 3.4], [-5.43, 20.07, 0.4, 0]], [[0.2, 0.2, 0.2, 0.08], [12.31, 4.77, 12.1, 0]]
];

const waterGroundCases = (noise: ReturnType<typeof createNoiseNodes>): TslParityCase[] => {
  const make = (time: TslNode) => createWaterGroundNodes({
    cloudShadow: () => float(1),
    sunColor: vec3(...WATER_SUN_COLOUR),
    sunDirection: vec3(...WATER_SUN),
    sunVisibility: float(1),
    time,
    valueNoise: noise.valueNoise
  });
  return [
    { cpu: ([row]) => waterGroundReference.refractedSunOffset([row![0]!, row![2]!]),
      gpu: input => createWaterGroundNodes({ cloudShadow: () => float(1), sunColor: vec3(...WATER_SUN_COLOUR),
        sunDirection: vec3(input(0).x, input(0).y, input(0).z), sunVisibility: float(1), time: float(0),
        valueNoise: noise.valueNoise }).refractedSunOffset(), name: "water/refracted-sun-offset",
      samples: WATER_GROUND_SAMPLES, size: 2 },
    { cpu: ([row]) => [waterGroundReference.caustics([row![0]!, row![1]!], row![2]!)],
      gpu: input => make(input(0).z).caustics(input(0).xy), name: "water/caustics",
      samples: WATER_CAUSTIC_SAMPLES, size: 1 },
    { cpu: ([lit, point]) => waterGroundReference.waterlineGround(v3(lit!), lit![3]!, v2(point!),
        point![2]!, WATER_SUN, WATER_SUN_COLOUR),
      gpu: input => make(input(1).z).waterlineGround(input(0).xyz, input(0).w, input(1).xy),
      name: "water/waterline-ground", samples: WATER_GROUND_LIT_SAMPLES, size: 3 }
  ];
};


const ROAD_WHEEL_SAMPLES: readonly (readonly Row[])[] = [
  [[0.12, 0.25, 0.012]], [[0.31, 0.03, 0.008]], [[-0.18, 0.06, 0.02]],
  [[0.46, 0.09, 0.01]], [[0.02, 0.1, 0.004]]
];

const roadCases = (): TslParityCase[] => [
  { cpu: ([row]) => [roadReference.trafficWheelTrack(row![0]!, row![1]!, row![2]!)],
    gpu: input => trafficWheelTrack(input(0).x, input(0).y, input(0).z),
    name: "road/wheel-track", samples: ROAD_WHEEL_SAMPLES, size: 1 }
];

/** Every case group of the parity bench, built on one shared noise texture. */
export const createTslParityCases = (noiseTexture: Texture): TslParityCase[] => {
  const noise = createNoiseNodes(noiseTexture);
  const fog = createFogNodes({ fbm3: noise.fbm3, noiseTexture });
  return [
    ...colourCases(),
    ...noiseCases(noise),
    ...windCases(createWindNodes(noise.valueNoise)),
    ...shipClothCases(),
    ...grassCases(noise),
    ...fogCases(fog),
    ...lightingCases(noise.fbm3),
    ...rockCases(noise),
    ...waterCases(),
    ...waterGroundCases(noise),
    ...roadCases(),
    ...skyCases()
  ];
};

/** Pads a 1–4 component graph to the vec4 the float target stores. */
export const toVec4 = (node: TslNode, size: TslParityCase["size"]): TslNode => {
  if (size === 1) return vec4(node, 0, 0, 0);
  if (size === 2) return vec4(node, 0, 0);
  if (size === 3) return vec4(node, 0);
  return vec4(node);
};
