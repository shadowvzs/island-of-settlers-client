import { smoothstep } from "../../shared/world/noise";
import { toByte } from "../color";
import { createPeriodicNoise, type PeriodicNoise } from "../materials/periodic-noise";
import type { PaintedTexture } from "../trees/atlas-canvas";

/** Tileable rock material texture (512 px, about 4 world units per tile on the rock faces). */
const ROCK_TEXTURE_SIZE = 512;
/** Fine fractures catch light close up; large forms still carry the mountain silhouette. */
const NORMAL_STRENGTH = { gravel: 4, rock: 10 } as const;

/** One texel of the three cliff materials (luminance around 0.5, the palette is the shader's). */
export interface RockMaterialSample {
  /** Crack and pit occlusion of the rock (0 open .. 1 deep). */
  cavity: number;
  /** Clean exposed rock: broad fracture facets, faint lamination, fine grain. */
  clean: number;
  /** Loose rock / gravel with dark soil between the stones (pebble shading baked in). */
  gravel: number;
  gravelRelief: number;
  rockRelief: number;
  /** Weathered rock: softened, pitted, lichen flecks, darker cracks. */
  weathered: number;
}

/**
 * Crack hierarchy: a few wide major cracks (only part of the cell borders: no tessellation
 * look), sparse thinner secondary cracks; depth and width vary per crack.
 */
const sampleCracks = (noise: PeriodicNoise, u: number, v: number) => {
  const warpU = noise.fbm(u, v, 3, 3) * 0.07;
  const warpV = noise.fbm(u + 0.5, v + 0.5, 3, 3) * 0.07;
  const major = noise.worley(u + warpU, v + warpV, 3);
  const minor = noise.worley(u + warpU * 1.5, v + warpV * 1.5, 7);
  const majorWidth = 0.02 + major.nearestId * 0.04;
  const keepMajor = smoothstep(-0.05, 0.25, noise.fbm(u + 0.2, v + 0.8, 4, 2));
  const majorCrack = (1 - smoothstep(0, majorWidth, major.second - major.nearest)) * keepMajor;
  const keepMinor = smoothstep(0.65, 0.85, minor.nearestId) * keepMajor;
  const minorCrack = (1 - smoothstep(0, 0.035, minor.second - minor.nearest)) * keepMinor * 0.5;
  const tilt = major.nearestId * Math.PI * 2;
  return {
    crack: Math.max(majorCrack * (0.6 + major.nearestId * 0.4), minorCrack),
    /** Each fracture plate is a slightly tilted facet (catches light differently). */
    facet: (Math.cos(tilt) * major.offsetX + Math.sin(tilt) * major.offsetY) * 0.14,
    plate: major.nearestId
  };
};

/** Gravel: rounded stones of mixed size in dark soil; returns luminance and dome height. */
const sampleGravel = (noise: PeriodicNoise, u: number, v: number) => {
  const large = noise.worley(u, v, 14);
  const small = noise.worley(u + 0.31, v + 0.17, 34);
  const largeSize = 0.6 + large.nearestId * 0.35;
  const largeDome = Math.max(0, 1 - large.nearest / largeSize);
  const smallDome = Math.max(0, 1 - small.nearest / 0.5) * smoothstep(0.3, 0.5, small.nearestId);
  const dome = Math.max(largeDome, smallDome * 0.7);
  const stone = smoothstep(0.02, 0.2, dome);
  const tone = largeDome >= smallDome * 0.7 ? large.nearestId : small.nearestId;
  const lit = 0.8 + Math.sqrt(dome) * 0.2 + large.offsetY * 0.06;
  const soil = 0.38 + noise.fbm(u, v, 24, 2) * 0.04;
  return {
    luminance: soil + (lit * (0.42 + tone * 0.22) - soil) * stone,
    relief: Math.sqrt(dome) * 0.45
  };
};

/**
 * One texel in scale order: macro patches and fracture facets, meso lamination and cracks, micro
 * grain. v runs up the face in the side projections, so lamination reads as horizontal layers.
 */
export const sampleRockMaterials = (
  noise: PeriodicNoise,
  u: number,
  v: number
): RockMaterialSample => {
  const patches = noise.fbm(u, v, 2, 3);
  const mineral = noise.fbm(u + 0.37, v + 0.61, 9, 3);
  const cracks = sampleCracks(noise, u, v);
  const laminationWave = Math.sin((v + noise.fbm(u, v, 3, 2) * 0.05) * Math.PI * 2 * 9);
  const lamination = smoothstep(0.6, 1, laminationWave) * 0.5;
  const grain = noise.fbm(u, v, 48, 3);
  const speck = smoothstep(0.55, 0.8, noise.fbm(u + 0.7, v + 0.2, 96, 2));
  const pits = smoothstep(0.42, 0.6, noise.fbm(u + 0.2, v + 0.6, 40, 2));
  const lichen = smoothstep(0.5, 0.7, noise.fbm(u + 0.9, v + 0.3, 20, 2));
  const clean =
    0.52 +
    patches * 0.14 +
    mineral * 0.08 +
    cracks.facet +
    (cracks.plate - 0.5) * 0.06 -
    lamination * 0.075 +
    grain * 0.04 +
    speck * 0.015 -
    cracks.crack * 0.18;
  const weathered =
    0.47 +
    patches * 0.15 +
    mineral * 0.07 +
    grain * 0.03 -
    pits * 0.05 +
    lichen * 0.04 -
    cracks.crack * 0.18;
  const gravel = sampleGravel(noise, u, v);
  return {
    cavity: Math.min(1, cracks.crack * 0.75 + pits * 0.08),
    clean,
    gravel: gravel.luminance,
    gravelRelief: gravel.relief,
    rockRelief:
      0.5 + cracks.facet - cracks.crack * 0.2 - lamination * 0.045 + mineral * 0.04 + grain * 0.02,
    weathered
  };
};

/** Tangent space slope pair (OpenGL, green = +v) of a tileable height field, 0..255 encoded. */
const encodeSlope = (heights: Float32Array, size: number, index: number, strength: number) => {
  const x = index % size;
  const y = Math.floor(index / size);
  const at = (column: number, row: number) =>
    heights[((row + size) % size) * size + ((column + size) % size)]!;
  const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
  const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
  const length = Math.hypot(dx, dy, 1);
  return [toByte(0.5 - dx / length / 2), toByte(0.5 - dy / length / 2)];
};

/**
 * Packed cliff materials, one fetch serves all three: colour R clean rock, G weathered rock,
 * B gravel, A cavity; normal RG rock detail slope, BA gravel detail slope.
 */
export const createRockTexture = (seed: number): PaintedTexture => {
  const size = ROCK_TEXTURE_SIZE;
  const noise = createPeriodicNoise(seed);
  const color = new Uint8Array(size * size * 4);
  const rockRelief = new Float32Array(size * size);
  const gravelRelief = new Float32Array(size * size);
  for (let index = 0; index < size * size; index += 1) {
    const u = (index % size) / size;
    const sample = sampleRockMaterials(noise, u, Math.floor(index / size) / size);
    color.set(
      [
        toByte(sample.clean),
        toByte(sample.weathered),
        toByte(sample.gravel),
        toByte(sample.cavity)
      ],
      index * 4
    );
    rockRelief[index] = sample.rockRelief;
    gravelRelief[index] = sample.gravelRelief;
  }
  const normal = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    normal.set(
      [
        ...encodeSlope(rockRelief, size, index, NORMAL_STRENGTH.rock),
        ...encodeSlope(gravelRelief, size, index, NORMAL_STRENGTH.gravel)
      ],
      index * 4
    );
  }
  return { color, height: size, normal, width: size };
};
