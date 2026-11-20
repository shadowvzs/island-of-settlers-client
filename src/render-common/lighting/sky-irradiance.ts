import {
  createSkyModelInputs,
  fillSkyModelInputs,
  type SkyModelInputs
} from "../atmosphere/sky-model";
import {
  createSkyViewLut,
  fillSkyViewLut,
  sampleSkyViewLut,
  SKY_VIEW_LUT_HEIGHT,
  SKY_VIEW_LUT_WIDTH,
  skyViewElevation
} from "../atmosphere/sky-view-lut";
import type { Color3, EnvironmentState } from "../environment";

/**
 * Shared sky light (R05, R06b): one SH9 projection of the sky's radiance lights every material
 * family. The radiance is the sky-view LUT (atmosphere/sky-view-lut.ts), the very sky the
 * possessed and perspective views show. Raw shaders evaluate `irradiance` (irradiance / π, the
 * colour the hemisphere ambient used to be), built-in materials get `radiance` through a Three
 * LightProbe, and water reflects the `reflection` set. Pure and worker-safe; recomputed only when
 * the light inputs change, into preallocated arrays (no allocation per frame).
 *
 * Units: the keyframe palette (EnvironmentState) is display-authored and every consumer keeps its
 * R04 convention: raw lighting multiplies it in display space, built-in rigs read it as linear
 * with their fitted intensity. The ambient is normalised so that an up-facing surface receives
 * exactly `ambientSky` and a down-facing one `ambientGround`, as the hemisphere did; sideways and
 * tilted surfaces see the sky's direction-dependent colour (blue zenith, pale horizon, warm sun
 * side). The reflection set is the sky radiance itself, so water mirrors the visible sky; it is
 * only lifted where the sky's horizon is darker than the palette's sky light (night, dusk away
 * from the sun), because the visible sky gains that brightness from its ray's airlight, which a
 * reflection does not carry.
 */

/** Floats of one SH9 colour set: nine RGB coefficients, in Three's SphericalHarmonics3 order. */
export const SKY_SH_FLOATS = 27;

/** Y_i(n) = SH_BASIS[i] · P_i(n) with P = [1, y, z, x, xy, yz, 3z² − 1, xz, x² − y²]. */
const SH_BASIS = [
  0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 0.315392, 1.092548, 0.546274
] as const;
/** Clamped-cosine convolution per coefficient, divided by π (A_l / π: 1, 2/3, 1/4). */
const SH_COSINE_BAND = [1, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25] as const;

/** Stratified equal-area sample grid over the sphere (rows in cos θ, columns in φ). */
const SAMPLE_ROWS = 16;
const SAMPLE_COLUMNS = 32;
const SAMPLE_COUNT = SAMPLE_ROWS * SAMPLE_COLUMNS;
const SAMPLE_SOLID_ANGLE = (4 * Math.PI) / SAMPLE_COUNT;

interface SampleTable {
  /** Unit directions, xyz per sample. */
  directions: Float64Array;
  /** Y_i of each direction, nine per sample. */
  basis: Float64Array;
}

let sampleTable: SampleTable | null = null;

const writeBasis = (x: number, y: number, z: number, target: Float64Array, offset: number) => {
  const polynomial = [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y];
  for (let index = 0; index < 9; index++)
    target[offset + index] = SH_BASIS[index]! * polynomial[index]!;
};

const getSampleTable = (): SampleTable => {
  if (sampleTable) return sampleTable;
  const directions = new Float64Array(SAMPLE_COUNT * 3);
  const basis = new Float64Array(SAMPLE_COUNT * 9);
  for (let row = 0; row < SAMPLE_ROWS; row++) {
    const y = 1 - (2 * (row + 0.5)) / SAMPLE_ROWS;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    for (let column = 0; column < SAMPLE_COLUMNS; column++) {
      const phi = (2 * Math.PI * (column + 0.5)) / SAMPLE_COLUMNS;
      const sample = row * SAMPLE_COLUMNS + column;
      const x = ring * Math.cos(phi);
      const z = ring * Math.sin(phi);
      directions.set([x, y, z], sample * 3);
      writeBasis(x, y, z, basis, sample * 9);
    }
  }
  sampleTable = { basis, directions };
  return sampleTable;
};

export interface SkyLight {
  /** Irradiance / π polynomial for P_i(n) (raw shaders: `skyIrradiance`). */
  irradiance: Float32Array;
  /** Radiance SH coefficients (Three LightProbe `sh.coefficients`, before its intensity). */
  radiance: Float32Array;
  /** Radiance polynomial of the sky mirrored below the horizon (water `skyReflection`). */
  reflection: Float32Array;
  /** Increments whenever the coefficients change. */
  revision: number;
  /** Per-channel scale from the sky radiance to the ambient palette (the up-facing normalisation). */
  skyScale: Float32Array;
  /** The sky-view LUT the coefficients were projected from (RGBA floats, sky-view-lut.ts). */
  skyView: Float32Array;
}

/**
 * Light inputs compared to decide whether to project again. The tolerance (0.1 % of a colour,
 * about 0.06° of sun travel) bounds the LUT refill and its texture upload to a few per second.
 */
const KEY_FLOATS = 17;
const KEY_TOLERANCE = 1e-3;

/** Sums of one projection, reused between projections. */
interface ProjectionScratch {
  ground: Float64Array;
  mirrored: Float64Array;
  normaliser: Float64Array;
  radiance: Float64Array;
  sky: Float64Array;
}

const createScratch = (): ProjectionScratch => ({
  ground: new Float64Array(27),
  mirrored: new Float64Array(27),
  normaliser: new Float64Array(3),
  radiance: new Float64Array(3),
  sky: new Float64Array(27)
});

const accumulate = (target: Float64Array, basis: Float64Array, offset: number, value: number,
  channel: number) => {
  for (let index = 0; index < 9; index++)
    target[index * 3 + channel]! += value * basis[offset + index]! * SAMPLE_SOLID_ANGLE;
};

/** Projects the upper-hemisphere sky, its mirror image and the uniform ground. */
const projectSky = (inputs: SkyModelInputs, lut: Float32Array, scratch: ProjectionScratch) => {
  const { basis, directions } = getSampleTable();
  scratch.ground.fill(0);
  scratch.mirrored.fill(0);
  scratch.normaliser.fill(0);
  scratch.sky.fill(0);
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    const x = directions[sample * 3]!, y = directions[sample * 3 + 1]!, z = directions[sample * 3 + 2]!;
    sampleSkyViewLut(lut, inputs, x, Math.abs(y), z, scratch.radiance);
    for (let channel = 0; channel < 3; channel++) {
      const radiance = scratch.radiance[channel]!;
      accumulate(scratch.mirrored, basis, sample * 9, radiance, channel);
      if (y < 0) accumulate(scratch.ground, basis, sample * 9, 1, channel);
      else {
        accumulate(scratch.sky, basis, sample * 9, radiance, channel);
        // (1/π) ∫ L · cos θ dω over the upper hemisphere: the up-facing irradiance / π.
        scratch.normaliser[channel]! += (radiance * y * SAMPLE_SOLID_ANGLE) / Math.PI;
      }
    }
  }
};

const luma = (red: number, green: number, blue: number) => 0.299 * red + 0.587 * green + 0.114 * blue;

/** Elevation (radians) up to which the LUT rows count as the horizon band. */
const HORIZON_BAND = 0.15;

/** Mean luminance of the sky's horizon band (0..HORIZON_BAND, every azimuth). */
const horizonLuminance = (lut: Float32Array) => {
  let sum = 0, count = 0;
  for (let row = 0; row < SKY_VIEW_LUT_HEIGHT; row++) {
    const elevation = skyViewElevation((row + 0.5) / SKY_VIEW_LUT_HEIGHT);
    if (elevation < 0 || elevation > HORIZON_BAND) continue;
    for (let column = 0; column < SKY_VIEW_LUT_WIDTH; column++) {
      const offset = (row * SKY_VIEW_LUT_WIDTH + column) * 4;
      sum += luma(lut[offset]!, lut[offset + 1]!, lut[offset + 2]!);
      count++;
    }
  }
  return sum / Math.max(count, 1);
};

/** Reflection scale: 1 (the sky itself) unless its horizon is darker than the palette's sky. */
const reflectionScale = (environment: EnvironmentState, lut: Float32Array) => {
  const [red, green, blue] = environment.ambientSky;
  return Math.max(1, luma(red, green, blue) / Math.max(horizonLuminance(lut), 1e-4));
};

/** Writes the three coefficient sets from the projected sky, the ambient scaled to the palette. */
const writeSkyLight = (environment: EnvironmentState, scratch: ProjectionScratch, light: SkyLight) => {
  const mirrorScale = reflectionScale(environment, light.skyView);
  for (let channel = 0; channel < 3; channel++) {
    const skyScale = environment.ambientSky[channel]! / Math.max(scratch.normaliser[channel]!, 1e-6);
    light.skyScale[channel] = skyScale;
    const ground = environment.ambientGround[channel]!;
    for (let index = 0; index < 9; index++) {
      const slot = index * 3 + channel;
      const radiance = scratch.sky[slot]! * skyScale + scratch.ground[slot]! * ground;
      light.radiance[slot] = radiance;
      light.irradiance[slot] = radiance * SH_BASIS[index]! * SH_COSINE_BAND[index]!;
      light.reflection[slot] = scratch.mirrored[slot]! * mirrorScale * SH_BASIS[index]!;
    }
  }
};

const fillKey = (inputs: SkyModelInputs, ground: Color3, key: Float64Array) => {
  key.set(inputs.sky, 0);
  key.set(ground, 3);
  key.set(inputs.fog, 6);
  key.set(inputs.sunColor, 9);
  key.set(inputs.sun, 12);
  key[15] = inputs.cloudCover;
  key[16] = inputs.daylight;
};

const sameKey = (a: Float64Array, b: Float64Array) => {
  for (let index = 0; index < KEY_FLOATS; index++)
    if (Math.abs(a[index]! - b[index]!) > KEY_TOLERANCE) return false;
  return true;
};

/** A sky light that projects again only when its light inputs moved beyond a small tolerance. */
export const createSkyLight = () => {
  const inputs = createSkyModelInputs();
  const scratch = createScratch();
  const key = new Float64Array(KEY_FLOATS);
  const nextKey = new Float64Array(KEY_FLOATS);
  const light: SkyLight = {
    irradiance: new Float32Array(SKY_SH_FLOATS),
    radiance: new Float32Array(SKY_SH_FLOATS),
    reflection: new Float32Array(SKY_SH_FLOATS),
    revision: 0,
    skyScale: new Float32Array(3),
    skyView: createSkyViewLut()
  };
  return (environment: EnvironmentState): SkyLight => {
    fillSkyModelInputs(environment, inputs);
    fillKey(inputs, environment.ambientGround, nextKey);
    if (light.revision > 0 && sameKey(key, nextKey)) return light;
    key.set(nextKey);
    fillSkyViewLut(light.skyView, inputs);
    projectSky(inputs, light.skyView, scratch);
    writeSkyLight(environment, scratch, light);
    light.revision++;
    return light;
  };
};

/**
 * The shared sky light of the current environment. One cache serves every consumer of a frame
 * (raw uniforms and each built-in light rig), so the projection runs once per light change.
 */
export const getSkyLight = createSkyLight();

/** Size of the equirectangular sky radiance map (R05 PMREM source; 4:1 cube size 32). */
export const SKY_RADIANCE_MAP_WIDTH = 128;
export const SKY_RADIANCE_MAP_HEIGHT = 64;

const mapInputs = createSkyModelInputs();
const mapRadiance = new Float64Array(3);

/**
 * The sky radiance of `light` as an RGBA equirectangular map (Three's `equirectUv` layout, row 0
 * at the nadir) into `target` (width × height × 4 floats): the sky-view LUT scaled like the
 * ambient above the horizon and the uniform ground below it, exactly what the SH9 projection
 * integrates, so the environment reflection and the SH ambient share one source.
 */
export const writeSkyRadianceMap = (
  environment: EnvironmentState,
  light: SkyLight,
  target: Float32Array,
  width = SKY_RADIANCE_MAP_WIDTH,
  height = SKY_RADIANCE_MAP_HEIGHT
) => {
  fillSkyModelInputs(environment, mapInputs);
  for (let row = 0; row < height; row++) {
    const elevation = ((row + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(elevation), ring = Math.cos(elevation);
    for (let column = 0; column < width; column++) {
      const azimuth = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
      const x = ring * Math.cos(azimuth), z = ring * Math.sin(azimuth);
      const offset = (row * width + column) * 4;
      if (y >= 0) sampleSkyViewLut(light.skyView, mapInputs, x, y, z, mapRadiance);
      for (let channel = 0; channel < 3; channel++)
        target[offset + channel] = y < 0
          ? environment.ambientGround[channel]!
          : mapRadiance[channel]! * light.skyScale[channel]!;
      target[offset + 3] = 1;
    }
  }
};

/**
 * The plain hemisphere as an SH set (exact: its irradiance is linear in n.y), for scenes that
 * create shared uniforms without ever passing an environment (review benches).
 */
export const writeHemisphereSkyLight = (
  sky: Color3, ground: Color3, irradiance: Float32Array, reflection: Float32Array
) => {
  irradiance.fill(0);
  reflection.fill(0);
  for (let channel = 0; channel < 3; channel++) {
    irradiance[channel] = (sky[channel]! + ground[channel]!) / 2;
    irradiance[3 + channel] = (sky[channel]! - ground[channel]!) / 2;
    reflection[channel] = sky[channel]!;
  }
};
