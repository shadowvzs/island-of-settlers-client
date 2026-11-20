import { type CellRegion,clampRegion,isRegionEmpty, sampleBilinear, sampleSmooth } from "../shared/world/grid-geometry";
import { createStillWater, sampleStillWater } from "../shared/world/still-water";
import type { WorldData } from "../shared/world/world-data";
import { toByte } from "./color";

/** Seabed colour of the open sea outside the map (there is no ground mesh there). */
export const OPEN_SEA_BED = [0.03, 0.09, 0.13] as const;

/** Texels per cell: the shoreline is resolved 4x finer than the gameplay grid. */
const WATER_FIELD_RESOLUTION = 4;

/**
 * Signed water depth encoding of the 8 bit field: asinh(depth / softness), spread over -1..6 depth.
 * Steps are about 0.004 depth units at the waterline (0.009 at the swash's highest run-up), so the
 * swash edge and its thin foam line follow a smooth field instead of 0.0275-unit terraces that put
 * texel-sized steps and kinks into it (lane/swash-foam); they widen to about 0.08 at 3 units deep
 * (water colour only). Shared by the GLSL decode below and the WebGPU TSL nodes.
 */
const DEPTH_SOFTNESS = 0.15;
const DEPTH_ENCODED_MIN = Math.asinh(-1 / DEPTH_SOFTNESS);
const DEPTH_ENCODED_RANGE = Math.asinh(6 / DEPTH_SOFTNESS) - DEPTH_ENCODED_MIN;
export const WATER_DEPTH_ENCODING = {
  min: DEPTH_ENCODED_MIN, range: DEPTH_ENCODED_RANGE, softness: DEPTH_SOFTNESS
} as const;

const COAST_RANGE = 16;
const COAST_BLUR_PASSES = 2;
const COAST_BLUR_RADIUS = 2;
/** A patch's sample margin: every blur pass reaches this many texels. */
const COAST_BLUR_HALO = COAST_BLUR_PASSES * COAST_BLUR_RADIUS;

/** Byte of a signed water depth (WATER_DEPTH_ENCODING); decodeWaterDepth in the shaders inverts it. */
export const encodeWaterDepth = (depth: number) =>
  toByte((Math.asinh(depth / DEPTH_SOFTNESS) - DEPTH_ENCODED_MIN) / DEPTH_ENCODED_RANGE);

export interface WaterField {
  height: number;
  pixels: Uint8Array;
  width: number;
}

/** A bounded update of one water field texture: the texel region and its new RGBA bytes. */
export interface WaterFieldPatch {
  height: number;
  pixels: Uint8Array;
  width: number;
  x: number;
  y: number;
}

/** Separable box blur of one channel (smooth coast distance: round foam bands, no kinks). */
const blurChannel = (pixels: Uint8Array, width: number, height: number, channel: number) => {
  const source = new Float32Array(width * height);
  for (let pass = 0; pass < COAST_BLUR_PASSES; pass += 1) {
    for (let index = 0; index < source.length; index += 1)
      source[index] = pixels[index * 4 + channel]!;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let d = -COAST_BLUR_RADIUS; d <= COAST_BLUR_RADIUS; d += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + d));
          const sy = Math.min(height - 1, Math.max(0, y + d));
          sum += source[y * width + sx]! + source[sy * width + x]!;
          count += 2;
        }
        pixels[(y * width + x) * 4 + channel] = Math.round(sum / count);
      }
    }
  }
};

/**
 * RGBA8 texture over the whole map, sampled with linear filtering in the fragment shaders:
 * R = signed water depth from the smooth (Catmull-Rom) ground (asinh encoded: fine at the waterline),
 * G = coast distance (blurred),
 * B = fog of war visibility, A = water plants (stillness of calm fresh water, still-water.ts):
 * the underwater weeds grow by it. The shoreline, wet sand, foam bands and fog edges then
 * follow this fine field instead of the mesh triangles.
 */
export const createWaterField = (world: WorldData, vertexFog: Float32Array): WaterField => {
  const width = world.cellsX * WATER_FIELD_RESOLUTION;
  const height = world.cellsZ * WATER_FIELD_RESOLUTION;
  const pixels = new Uint8Array(width * height * 4);
  const still = createStillWater(world, world);
  for (let texelZ = 0; texelZ < height; texelZ += 1) {
    for (let texelX = 0; texelX < width; texelX += 1) {
      const x = (texelX + 0.5) / WATER_FIELD_RESOLUTION;
      const z = (texelZ + 0.5) / WATER_FIELD_RESOLUTION;
      const depth =
        sampleBilinear(world, world.waterSurface, x, z) - sampleSmooth(world, world.heights, x, z);
      const coast = sampleBilinear(world, world.coastDistance, x, z);
      const offset = (texelZ * width + texelX) * 4;
      pixels[offset] = encodeWaterDepth(depth);
      pixels[offset + 1] = toByte(coast / COAST_RANGE + 0.5);
      pixels[offset + 2] = toByte(sampleBilinear(world, vertexFog, x, z));
      pixels[offset + 3] = toByte(sampleBilinear(world, still, x, z));
    }
  }
  blurChannel(pixels, width, height, 1);
  return { height, pixels, width };
};

/** One blur pass from a source window into a target window of the same world-space field. */
const blurRegion = (
  source: Float32Array,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  fieldWidth: number,
  fieldHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number
) => {
  const target = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const globalY = targetY + y;
    for (let x = 0; x < targetWidth; x += 1) {
      const globalX = targetX + x;
      let sum = 0;
      let count = 0;
      for (let d = -COAST_BLUR_RADIUS; d <= COAST_BLUR_RADIUS; d += 1) {
        const sx = Math.min(fieldWidth - 1, Math.max(0, globalX + d));
        const sy = Math.min(fieldHeight - 1, Math.max(0, globalY + d));
        sum +=
          source[(globalY - sourceY) * sourceWidth + (sx - sourceX)]! +
          source[(sy - sourceY) * sourceWidth + (globalX - sourceX)]!;
        count += 2;
      }
      target[y * targetWidth + x] = Math.round(sum / count);
    }
  }
  return target;
};

/** The edited cells as texels (clamped to the field), the exact region a patch replaces. */
const getPatchTexelRegion = (world: WorldData, cells: CellRegion) => {
  const region = clampRegion(world, cells);
  if (isRegionEmpty(region)) return { height: 0, width: 0, x: 0, y: 0 };
  return {
    height: (region.maxZ - region.minZ + 1) * WATER_FIELD_RESOLUTION,
    width: (region.maxX - region.minX + 1) * WATER_FIELD_RESOLUTION,
    x: region.minX * WATER_FIELD_RESOLUTION,
    y: region.minZ * WATER_FIELD_RESOLUTION
  };
};

/**
 * The water field only where the edited cells are (plus the four-texel blur halo used to compute
 * it): the same bytes as createWaterField inside the patch, without sampling a whole stillness
 * field or allocating the whole map's pixels. The renderer uploads just this texture region.
 */
export const createWaterFieldPatch = (
  world: WorldData,
  vertexFog: Float32Array,
  cells: CellRegion
): WaterFieldPatch => {
  const fieldWidth = world.cellsX * WATER_FIELD_RESOLUTION;
  const fieldHeight = world.cellsZ * WATER_FIELD_RESOLUTION;
  const target = getPatchTexelRegion(world, cells);
  if (target.width <= 0 || target.height <= 0)
    return { ...target, pixels: new Uint8Array(0) };

  const targetMaxX = target.x + target.width - 1;
  const targetMaxY = target.y + target.height - 1;
  // The unblurred samples both passes reach: target + four texels on every side.
  const sampleX = Math.max(0, target.x - COAST_BLUR_HALO);
  const sampleY = Math.max(0, target.y - COAST_BLUR_HALO);
  const sampleMaxX = Math.min(fieldWidth - 1, targetMaxX + COAST_BLUR_HALO);
  const sampleMaxY = Math.min(fieldHeight - 1, targetMaxY + COAST_BLUR_HALO);
  const sampleWidth = sampleMaxX - sampleX + 1;
  const sampleHeight = sampleMaxY - sampleY + 1;
  const samples = new Float32Array(sampleWidth * sampleHeight);
  const pixels = new Uint8Array(target.width * target.height * 4);
  for (let texelZ = sampleY; texelZ <= sampleMaxY; texelZ += 1) {
    for (let texelX = sampleX; texelX <= sampleMaxX; texelX += 1) {
      const x = (texelX + 0.5) / WATER_FIELD_RESOLUTION;
      const z = (texelZ + 0.5) / WATER_FIELD_RESOLUTION;
      const coast = toByte(sampleBilinear(world, world.coastDistance, x, z) / COAST_RANGE + 0.5);
      samples[(texelZ - sampleY) * sampleWidth + (texelX - sampleX)] = coast;
      if (texelX < target.x || texelX > targetMaxX || texelZ < target.y || texelZ > targetMaxY)
        continue;
      const depth =
        sampleBilinear(world, world.waterSurface, x, z) - sampleSmooth(world, world.heights, x, z);
      const offset = ((texelZ - target.y) * target.width + (texelX - target.x)) * 4;
      pixels[offset] = encodeWaterDepth(depth);
      pixels[offset + 1] = coast;
      pixels[offset + 2] = toByte(sampleBilinear(world, vertexFog, x, z));
      pixels[offset + 3] = toByte(sampleStillWater(world, world, x, z));
    }
  }

  // Pass one reaches the target's two-texel ring; pass two only has to write the target itself.
  const firstX = Math.max(0, target.x - COAST_BLUR_RADIUS);
  const firstY = Math.max(0, target.y - COAST_BLUR_RADIUS);
  const firstMaxX = Math.min(fieldWidth - 1, targetMaxX + COAST_BLUR_RADIUS);
  const firstMaxY = Math.min(fieldHeight - 1, targetMaxY + COAST_BLUR_RADIUS);
  const firstWidth = firstMaxX - firstX + 1;
  const firstHeight = firstMaxY - firstY + 1;
  const first = blurRegion(
    samples, sampleX, sampleY, sampleWidth, fieldWidth, fieldHeight,
    firstX, firstY, firstWidth, firstHeight
  );
  const blurred = blurRegion(
    first, firstX, firstY, firstWidth, fieldWidth, fieldHeight,
    target.x, target.y, target.width, target.height
  );
  for (let index = 0; index < blurred.length; index += 1)
    pixels[index * 4 + 1] = blurred[index]!;
  return { ...target, pixels };
};

/**
 * GLSL decoding of the field (needs COMMON_UNIFORMS_GLSL: uWorldSize = (cellsX, cellsZ)). The
 * texture clamps at its edge, so the open sea outside the map reads the border texels: the same
 * depth, coast and fog as the in-map water there, so the water is seamless at the map border
 * (where the black map edge fades it out anyway).
 */
export const WATER_FIELD_GLSL = `
uniform sampler2D uWaterField;

/** Seabed colour of the open sea outside the map (there is no ground mesh there). */
const vec3 OPEN_SEA_BED = vec3(${OPEN_SEA_BED.join(", ")});

/** The seabed under the water fades to the open sea bed at the border: in and out match. */
vec3 blendOpenSeaBed(vec3 bed, vec2 xz) {
  return mix(OPEN_SEA_BED, bed, getMapInterior(xz));
}

/** Signed water depth of the field's filtered red channel (inverse asinh encoding, water-field.ts). */
float decodeWaterDepth(float encoded) {
  float scaled = encoded * ${DEPTH_ENCODED_RANGE.toFixed(6)} + ${DEPTH_ENCODED_MIN.toFixed(6)};
  return ${DEPTH_SOFTNESS.toFixed(6)} * 0.5 * (exp(scaled) - exp(-scaled));
}

/**
 * x: signed water depth, y: coast distance (negative in water), z: fog visibility, w: water
 * plants (calm fresh water stillness).
 */
vec4 sampleWaterField(vec2 xz) {
  vec4 texel = texture(uWaterField, xz / uWorldSize);
  return vec4(
    decodeWaterDepth(texel.r),
    (texel.g - 0.5) * ${COAST_RANGE.toFixed(1)},
    texel.b,
    texel.a
  );
}
`;
