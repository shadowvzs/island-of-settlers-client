import { Data3DTexture, LinearFilter, RepeatWrapping, RGFormat } from "three";

/** Voxels per side of the tiling cloud volume (64³ RG8 = 512 KiB). */
export const SKY_NOISE_SIZE = 64;

type Random = () => number;

const createRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

const wrap = (value: number, period: number) => ((value % period) + period) % period;

const latticeIndex = (x: number, y: number, z: number, frequency: number) =>
  (wrap(z, frequency) * frequency + wrap(y, frequency)) * frequency + wrap(x, frequency);

/**
 * One feature point per cell of a `frequency`³ grid that tiles the volume, stored for a grid padded
 * by one cell on every side (absolute positions, wrapped copies at the edges): no modulo per lookup.
 */
const createFeaturePoints = (frequency: number, random: Random) => {
  const points = new Float32Array(frequency * frequency * frequency * 3);
  for (let index = 0; index < points.length; index++) points[index] = random();
  const padded = frequency + 2;
  const absolute = new Float32Array(padded * padded * padded * 3);
  for (let z = 0; z < padded; z++) for (let y = 0; y < padded; y++) for (let x = 0; x < padded; x++) {
    const source = latticeIndex(x - 1, y - 1, z - 1, frequency) * 3;
    const target = ((z * padded + y) * padded + x) * 3;
    absolute[target] = x - 1 + points[source]!;
    absolute[target + 1] = y - 1 + points[source + 1]!;
    absolute[target + 2] = z - 1 + points[source + 2]!;
  }
  return absolute;
};

/** Inverted cellular (Worley) noise: 1 at a feature point, 0 one cell away. Tiles the volume. */
const worley = (x: number, y: number, z: number, frequency: number, points: Float32Array) => {
  const padded = frequency + 2;
  const cellX = Math.floor(x) + 1, cellY = Math.floor(y) + 1, cellZ = Math.floor(z) + 1;
  let nearest = 9;
  for (let neighbourZ = cellZ - 1; neighbourZ <= cellZ + 1; neighbourZ++)
    for (let neighbourY = cellY - 1; neighbourY <= cellY + 1; neighbourY++) {
      let cell = ((neighbourZ * padded + neighbourY) * padded + cellX - 1) * 3;
      for (let step = 0; step < 3; step++, cell += 3) {
        const deltaX = points[cell]! - x, deltaY = points[cell + 1]! - y, deltaZ = points[cell + 2]! - z;
        const distance = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
        if (distance < nearest) nearest = distance;
      }
    }
  return 1 - Math.min(Math.sqrt(nearest), 1);
};

const fade = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);

/** Unit gradients of a tiling `frequency`³ lattice. */
const createGradients = (frequency: number, random: Random) => {
  const gradients = new Float32Array(frequency * frequency * frequency * 3);
  for (let index = 0; index < gradients.length; index += 3) {
    const theta = random() * Math.PI * 2, height = random() * 2 - 1, radius = Math.sqrt(1 - height * height);
    gradients[index] = Math.cos(theta) * radius;
    gradients[index + 1] = height;
    gradients[index + 2] = Math.sin(theta) * radius;
  }
  return gradients;
};

/** Dot product of a lattice corner's gradient with the offset to the sample. */
const cornerDot = (
  gradients: Float32Array, frequency: number, cellX: number, cellY: number, cellZ: number,
  localX: number, localY: number, localZ: number
) => {
  const cell = latticeIndex(cellX, cellY, cellZ, frequency) * 3;
  return gradients[cell]! * localX + gradients[cell + 1]! * localY + gradients[cell + 2]! * localZ;
};

/** Tiling gradient (Perlin) noise, roughly -0.9 .. 0.9. */
const perlin = (x: number, y: number, z: number, frequency: number, gradients: Float32Array) => {
  const cellX = Math.floor(x), cellY = Math.floor(y), cellZ = Math.floor(z);
  const localX = x - cellX, localY = y - cellY, localZ = z - cellZ;
  const blendX = fade(localX), blendY = fade(localY), blendZ = fade(localZ);
  let result = 0;
  for (let cornerZ = 0; cornerZ <= 1; cornerZ++) {
    const weightZ = cornerZ ? blendZ : 1 - blendZ;
    for (let cornerY = 0; cornerY <= 1; cornerY++) {
      const weightY = (cornerY ? blendY : 1 - blendY) * weightZ;
      for (let cornerX = 0; cornerX <= 1; cornerX++) {
        const weight = (cornerX ? blendX : 1 - blendX) * weightY;
        result += weight * cornerDot(gradients, frequency, cellX + cornerX, cellY + cornerY, cellZ + cornerZ,
          localX - cornerX, localY - cornerY, localZ - cornerZ);
      }
    }
  }
  return result;
};

interface Octave { frequency: number; table: Float32Array; weight: number }
type OctaveSample = (x: number, y: number, z: number, frequency: number, table: Float32Array) => number;

const createOctaves = (
  frequencies: readonly number[], weights: readonly number[], table: (frequency: number) => Float32Array
) => frequencies.map((frequency, index): Octave => ({ frequency, table: table(frequency), weight: weights[index]! }));

/** Weighted octave sum at voxel centre (x, y, z); every octave tiles the volume. */
const sumOctaves = (list: readonly Octave[], sample: OctaveSample, x: number, y: number, z: number) => {
  let total = 0;
  for (const { frequency, table, weight } of list) {
    const scale = frequency / SKY_NOISE_SIZE;
    total += sample((x + 0.5) * scale, (y + 0.5) * scale, (z + 0.5) * scale, frequency, table) * weight;
  }
  return total;
};

const remap = (value: number, fromLow: number, fromHigh: number) =>
  Math.max(0, Math.min(1, (value - fromLow) / Math.max(1e-4, fromHigh - fromLow)));

const OCTAVE_WEIGHTS = [0.625, 0.25, 0.125] as const;
let cachedVoxels: Uint8Array | null = null;

/** Stretches a channel so its 1st..99th percentile spans the full 8-bit range. */
const writeStretchedChannel = (values: Float32Array, voxels: Uint8Array, channel: number) => {
  const sorted = Float32Array.from(values).sort();
  const low = sorted[Math.floor(sorted.length * 0.01)]!, high = sorted[Math.floor(sorted.length * 0.99)]!;
  for (let index = 0; index < values.length; index++)
    voxels[index * 2 + channel] = Math.round(remap(values[index]!, low, high) * 255);
};

/**
 * Two tiling channels in the style of production cloud renderers: R a Perlin-Worley base shape
 * (connected Perlin bodies with billowy cellular lobes), G a three-octave Worley detail that erodes
 * the edges into cauliflower puffs. Built once per page on the CPU and cached for later skies.
 */
export const createSkyNoiseVoxels = (): Uint8Array => {
  if (cachedVoxels) return cachedVoxels;
  const random = createRandom(0x71c39a5d);
  const size = SKY_NOISE_SIZE;
  const perlinOctaves = createOctaves([4, 8, 16], [0.6, 0.28, 0.12], frequency => createGradients(frequency, random));
  const shapeCells = createOctaves([4, 8, 16], OCTAVE_WEIGHTS, frequency => createFeaturePoints(frequency, random));
  const detailCells = createOctaves([6, 12, 24], OCTAVE_WEIGHTS, frequency => createFeaturePoints(frequency, random));
  const shapes = new Float32Array(size * size * size), details = new Float32Array(size * size * size);
  for (let z = 0, index = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++, index++) {
    const body = sumOctaves(perlinOctaves, perlin, x, y, z) * 0.5 + 0.5;
    // Perlin-Worley: the Perlin body, lifted toward 1 inside the cellular billows.
    shapes[index] = remap(body, sumOctaves(shapeCells, worley, x, y, z) - 1, 1);
    details[index] = sumOctaves(detailCells, worley, x, y, z);
  }
  const voxels = new Uint8Array(size * size * size * 2);
  writeStretchedChannel(shapes, voxels, 0);
  writeStretchedChannel(details, voxels, 1);
  cachedVoxels = voxels;
  return voxels;
};

/** The FPS sky's owned volume; hardware trilinear filtering keeps the lobes isotropic. */
export const createExplorationSkyNoise = () => {
  const texture = new Data3DTexture(createSkyNoiseVoxels(), SKY_NOISE_SIZE, SKY_NOISE_SIZE, SKY_NOISE_SIZE);
  texture.format = RGFormat;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.name = "exploration-cloud-noise-64";
  texture.needsUpdate = true;
  return texture;
};
