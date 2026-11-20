import { type GridSize,readVertex } from "../grid-geometry";
import { smoothstep } from "../noise";
import { createRandom, deriveSeed } from "../rng";

const EROSION = {
  capacity: 3,
  depositSpeed: 0.3,
  erodeSpeed: 0.25,
  evaporation: 0.025,
  gravity: 4,
  inertia: 0.05,
  maxSteps: 40,
  minHeight: 0.6,
  minSlope: 0.01
} as const;

interface Droplet {
  directionX: number;
  directionZ: number;
  sediment: number;
  speed: number;
  water: number;
  x: number;
  z: number;
}

const getHeightAndGradient = (grid: GridSize, heights: Float32Array, x: number, z: number) => {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const fx = x - cellX;
  const fz = z - cellZ;
  const h00 = readVertex(grid, heights, cellX, cellZ);
  const h10 = readVertex(grid, heights, cellX + 1, cellZ);
  const h01 = readVertex(grid, heights, cellX, cellZ + 1);
  const h11 = readVertex(grid, heights, cellX + 1, cellZ + 1);
  return {
    gradientX: (h10 - h00) * (1 - fz) + (h11 - h01) * fz,
    gradientZ: (h01 - h00) * (1 - fx) + (h11 - h10) * fx,
    height: h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
  };
};

/** Adds (or removes, when negative) material at a point, split over the 4 cell corners. */
const depositAt = (grid: GridSize, heights: Float32Array, x: number, z: number, amount: number) => {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const fx = x - cellX;
  const fz = z - cellZ;
  const stride = grid.cellsX + 1;
  const index = cellZ * stride + cellX;
  heights[index] = heights[index]! + amount * (1 - fx) * (1 - fz);
  heights[index + 1] = heights[index + 1]! + amount * fx * (1 - fz);
  heights[index + stride] = heights[index + stride]! + amount * (1 - fx) * fz;
  heights[index + stride + 1] = heights[index + stride + 1]! + amount * fx * fz;
};

/**
 * Erodibility by altitude: the soil of the lowland erodes freely, the mountain rock above it
 * slowly, so droplets cut gullies into the massifs instead of eating the summits and pitting
 * the faces.
 */
const HARD_ROCK = { from: 3, keep: 0.1, to: 6 } as const;

const getHardness = (height: number) =>
  1 - smoothstep(HARD_ROCK.from, HARD_ROCK.to, height) * (1 - HARD_ROCK.keep);

const isInsideInterior = (grid: GridSize, x: number, z: number) =>
  x >= 1 && z >= 1 && x < grid.cellsX - 1 && z < grid.cellsZ - 1;

/** One step: move downhill, then erode or deposit. Returns false when the droplet stops. */
const stepDroplet = (grid: GridSize, heights: Float32Array, droplet: Droplet) => {
  const before = getHeightAndGradient(grid, heights, droplet.x, droplet.z);
  droplet.directionX =
    droplet.directionX * EROSION.inertia - before.gradientX * (1 - EROSION.inertia);
  droplet.directionZ =
    droplet.directionZ * EROSION.inertia - before.gradientZ * (1 - EROSION.inertia);
  const length = Math.hypot(droplet.directionX, droplet.directionZ);
  if (length < 1e-6) return false;
  droplet.directionX /= length;
  droplet.directionZ /= length;
  const oldX = droplet.x;
  const oldZ = droplet.z;
  droplet.x += droplet.directionX;
  droplet.z += droplet.directionZ;
  if (!isInsideInterior(grid, droplet.x, droplet.z)) return false;
  if (before.height < EROSION.minHeight) return false;
  const deltaHeight =
    getHeightAndGradient(grid, heights, droplet.x, droplet.z).height - before.height;
  const capacity =
    Math.max(-deltaHeight, EROSION.minSlope) * droplet.speed * droplet.water * EROSION.capacity;
  if (droplet.sediment > capacity || deltaHeight > 0) {
    const amount =
      deltaHeight > 0
        ? Math.min(deltaHeight, droplet.sediment)
        : (droplet.sediment - capacity) * EROSION.depositSpeed;
    droplet.sediment -= amount;
    depositAt(grid, heights, oldX, oldZ, amount);
  } else {
    const cut = (capacity - droplet.sediment) * EROSION.erodeSpeed * getHardness(before.height);
    const amount = Math.min(cut, -deltaHeight);
    droplet.sediment += amount;
    depositAt(grid, heights, oldX, oldZ, -amount);
  }
  droplet.speed = Math.sqrt(
    Math.max(0, droplet.speed * droplet.speed - deltaHeight * EROSION.gravity)
  );
  droplet.water *= 1 - EROSION.evaporation;
  return true;
};

/** Hydraulic droplet erosion on land: carves gullies and softens the noise look. */
export const erodeTerrain = (
  grid: GridSize,
  heights: Float32Array,
  seed: number,
  droplets: number
) => {
  const random = createRandom(deriveSeed(seed, "erosion"));
  for (let index = 0; index < droplets; index += 1) {
    const x = 1 + random() * (grid.cellsX - 2);
    const z = 1 + random() * (grid.cellsZ - 2);
    if (getHeightAndGradient(grid, heights, x, z).height < 1) continue;
    const droplet: Droplet = {
      directionX: 0,
      directionZ: 0,
      sediment: 0,
      speed: 1,
      water: 1,
      x,
      z
    };
    for (let step = 0; step < EROSION.maxSteps; step += 1) {
      if (!stepDroplet(grid, heights, droplet)) break;
    }
  }
};

/** One 3 x 3 box blur pass on land, half strength: removes single vertex erosion spikes. */
export const smoothLand = (grid: GridSize, heights: Float32Array) => {
  const source = Float32Array.from(heights);
  const stride = grid.cellsX + 1;
  for (let z = 1; z < grid.cellsZ; z += 1) {
    for (let x = 1; x < grid.cellsX; x += 1) {
      const index = z * stride + x;
      if (source[index]! <= 0.3) continue;
      let sum = 0;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) sum += source[index + dz * stride + dx]!;
      }
      heights[index] = (source[index]! + sum / 9) / 2;
    }
  }
};
