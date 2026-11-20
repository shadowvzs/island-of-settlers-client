import { getVertexCount, type GridSize,readVertex } from "../grid-geometry";
import { smoothstep } from "../noise";

export interface Plateau {
  radius: number;
  x: number;
  z: number;
}

const SAMPLE_STEP = 3;
const ROUGHNESS_RADIUS = 4;
const PLATEAU_FALLOFF = 2.2;

/** Height range around a vertex: low values mean flat ground. */
const getRoughness = (grid: GridSize, heights: Float32Array, vertexX: number, vertexZ: number) => {
  let min = Infinity;
  let max = -Infinity;
  for (let dz = -ROUGHNESS_RADIUS; dz <= ROUGHNESS_RADIUS; dz += 2) {
    for (let dx = -ROUGHNESS_RADIUS; dx <= ROUGHNESS_RADIUS; dx += 2) {
      const height = readVertex(grid, heights, vertexX + dx, vertexZ + dz);
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
  }
  return max - min;
};

const SEA_LOOKOUT = 13;

/** The start should see the sea (coastal start): sea within a ring around it. */
const seesSea = (grid: GridSize, heights: Float32Array, vertexX: number, vertexZ: number) => {
  for (let step = 0; step < 16; step += 1) {
    const angle = (step / 16) * Math.PI * 2;
    const x = Math.round(vertexX + Math.cos(angle) * SEA_LOOKOUT);
    const z = Math.round(vertexZ + Math.sin(angle) * SEA_LOOKOUT);
    if (readVertex(grid, heights, x, z) < 0) return true;
  }
  return false;
};

const isFarFromAll = (plateaus: Plateau[], x: number, z: number, distance: number) =>
  plateaus.every((plateau) => Math.hypot(plateau.x - x, plateau.z - z) >= distance);

/** Land vertices (above the sea) 4-connected to `from` and not yet labelled. */
const floodLand = (grid: GridSize, heights: Float32Array, labels: Int32Array, from: number) => {
  const stride = grid.cellsX + 1;
  const stack = [from];
  let size = 0;
  labels[from] = from;
  while (stack.length > 0) {
    const index = stack.pop()!;
    size += 1;
    const x = index % stride;
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < grid.cellsX ? index + 1 : -1,
      index - stride,
      index + stride
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || neighbour >= heights.length || labels[neighbour] !== -1) continue;
      if (heights[neighbour]! <= 0) continue;
      labels[neighbour] = from;
      stack.push(neighbour);
    }
  }
  return size;
};

/**
 * Connected landmasses: per vertex the label of its landmass (its first vertex index, -1 in the
 * sea) and every landmass with its size in vertices, largest first.
 */
export const labelLandmasses = (grid: GridSize, heights: Float32Array) => {
  const labels = new Int32Array(heights.length).fill(-1);
  const landmasses: { label: number; size: number }[] = [];
  for (let index = 0; index < heights.length; index += 1) {
    if (labels[index] !== -1 || heights[index]! <= 0) continue;
    landmasses.push({ label: index, size: floodLand(grid, heights, labels, index) });
  }
  return { labels, landmasses: landmasses.sort((a, b) => b.size - a.size) };
};

/** Mask of the largest connected landmass: the start is on the main island, not a satellite. */
export const findMainLand = (grid: GridSize, heights: Float32Array) => {
  const { labels, landmasses } = labelLandmasses(grid, heights);
  const main = landmasses[0]?.label ?? -2;
  return Uint8Array.from(labels, (label) => (label === main ? 1 : 0));
};

/** Lowland, flat spots; the start prefers the camera facing (south east) side of the island. */
const scoreCandidate = (
  grid: GridSize,
  heights: Float32Array,
  vertexX: number,
  vertexZ: number,
  mainLand: Uint8Array | null
) => {
  const height = readVertex(grid, heights, vertexX, vertexZ);
  if (height < 0.6 || height > 3) return -Infinity;
  const roughness = getRoughness(grid, heights, vertexX, vertexZ);
  if (!mainLand) return -roughness * 2 - Math.abs(height - 1.4) * 0.5;
  if (!readVertex(grid, mainLand, vertexX, vertexZ)) return -Infinity;
  const facing = ((vertexX + vertexZ) / (grid.cellsX + grid.cellsZ)) * 2;
  const coastal = seesSea(grid, heights, vertexX, vertexZ) ? 2 : 0;
  return -roughness * 2 - Math.abs(height - 1.4) * 0.5 + facing + coastal;
};

/**
 * The starter area first (on the main landmass), then extra open building areas spread out;
 * none where `isOffLimits` (near the open border of a peninsula).
 */
export const choosePlateaus = (
  grid: GridSize,
  heights: Float32Array,
  count: number,
  isOffLimits: (vertexX: number, vertexZ: number) => boolean = () => false
): Plateau[] => {
  const plateaus: Plateau[] = [];
  const mainLand = findMainLand(grid, heights);
  for (let pick = 0; pick < count; pick += 1) {
    let best = { score: -Infinity, x: 0, z: 0 };
    const startLand = pick === 0 ? mainLand : null;
    for (let vertexZ = 8; vertexZ < grid.cellsZ - 8; vertexZ += SAMPLE_STEP) {
      for (let vertexX = 8; vertexX < grid.cellsX - 8; vertexX += SAMPLE_STEP) {
        if (isOffLimits(vertexX, vertexZ)) continue;
        if (!isFarFromAll(plateaus, vertexX, vertexZ, 26)) continue;
        const score = scoreCandidate(grid, heights, vertexX, vertexZ, startLand);
        if (score > best.score) best = { score, x: vertexX, z: vertexZ };
      }
    }
    if (best.score === -Infinity) break;
    plateaus.push({ radius: pick === 0 ? 6 : 4, x: best.x, z: best.z });
  }
  return plateaus;
};

/** Blends the ground towards the centre height; returns a 0..1 mask of the flattened area. */
export const flattenPlateaus = (grid: GridSize, heights: Float32Array, plateaus: Plateau[]) => {
  const mask = new Float32Array(getVertexCount(grid));
  for (const plateau of plateaus) {
    const target = Math.max(0.6, readVertex(grid, heights, plateau.x, plateau.z));
    const outer = Math.ceil(plateau.radius * PLATEAU_FALLOFF);
    for (let dz = -outer; dz <= outer; dz += 1) {
      for (let dx = -outer; dx <= outer; dx += 1) {
        const vertexX = plateau.x + dx;
        const vertexZ = plateau.z + dz;
        if (vertexX < 0 || vertexZ < 0 || vertexX > grid.cellsX || vertexZ > grid.cellsZ) continue;
        const weight =
          (1 - smoothstep(plateau.radius, plateau.radius * PLATEAU_FALLOFF, Math.hypot(dx, dz))) *
          0.9;
        if (weight <= 0) continue;
        const index = vertexZ * (grid.cellsX + 1) + vertexX;
        heights[index] = heights[index]! + (target - heights[index]!) * weight;
        mask[index] = Math.max(mask[index]!, weight);
      }
    }
  }
  return mask;
};
