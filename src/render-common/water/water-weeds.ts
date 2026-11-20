import {
  type CellRegion,
  clampRegion,
  isRegionEmpty,
  sampleBilinear,
  sampleSmooth
} from "../../shared/world/grid-geometry";
import { createFbm, smoothstep } from "../../shared/world/noise";
import { createKeyedRandom, createRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { createStillWater, sampleStillWater } from "../../shared/world/still-water";
import type { WorldData } from "../../shared/world/world-data";

/** Weed clumps need this much stillness (the water field's plant channel). */
const WEED_STILLNESS = 0.4;
/** Water depth range: deep enough to be submerged, shallow enough to see through. */
const WEED_DEPTH = [0.25, 1.4] as const;
/** Strand tips stay this far below the surface. */
const TIP_CLEARANCE = 0.08;
const MAX_HEIGHT = 0.55;
const TRIES_PER_CELL = 3;
const STRANDS = 7;
const STRAND_SEGMENTS = 5;
const STRAND_WIDTH = 0.032;
const CLUMP_SPREAD = 0.13;

/**
 * Submerged weed clumps (real strands seen through the refraction). Per instance: placement
 * (x, ground y, z, yaw), shape (height, width, phase, fog of war) and the current's direction
 * and speed (flow x, z).
 */
export interface WaterWeeds {
  count: number;
  flow: Float32Array;
  placement: Float32Array;
  shape: Float32Array;
}

/** One clump of strands in clump space (unit height); bend: 0 root .. 1 tip. */
export interface WeedClumpMesh {
  bend: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
}

interface WeedSpot {
  depth: number;
  ground: number;
  x: number;
  z: number;
}

const readWeedSpot = (world: WorldData, x: number, z: number): WeedSpot => {
  const ground = sampleSmooth(world, world.heights, x, z);
  const surface = sampleBilinear(world, world.waterSurface, x, z);
  return { depth: surface - ground, ground, x, z };
};

const getWeedChance = (spot: WeedSpot, still: number, patch: number) => {
  if (spot.depth < WEED_DEPTH[0] || spot.depth > WEED_DEPTH[1]) return 0;
  return still * smoothstep(-0.05, 0.3, patch) * 0.8;
};

/** Current at the nearest vertex (the flow layer is interleaved x, z). */
const readFlow = (world: WorldData, x: number, z: number) => {
  const index = Math.round(z) * (world.cellsX + 1) + Math.round(x);
  return [world.flow[index * 2]!, world.flow[index * 2 + 1]!] as const;
};

/** Bilinear still sample from a prebuilt vertex field (same arithmetic as sampleStillWater). */
const sampleStillField = (world: WorldData, still: Float32Array, x: number, z: number) => {
  const stride = world.cellsX + 1;
  const cx = Math.max(0, Math.min(world.cellsX - 1, Math.floor(x)));
  const cz = Math.max(0, Math.min(world.cellsZ - 1, Math.floor(z)));
  const dx = Math.max(0, Math.min(1, x - cx)), dz = Math.max(0, Math.min(1, z - cz));
  const index = cz * stride + cx;
  const top = still[index]! * (1 - dx) + still[index + 1]! * dx;
  const bottom = still[index + stride]! * (1 - dx) + still[index + stride + 1]! * dx;
  return top * (1 - dz) + bottom * dz;
};

type StillSampler = (x: number, z: number) => number;

const hasStillCorner = (stillAt: StillSampler, cellX: number, cellZ: number) =>
  Math.max(
    stillAt(cellX, cellZ),
    stillAt(cellX + 1, cellZ),
    stillAt(cellX, cellZ + 1),
    stillAt(cellX + 1, cellZ + 1)
  ) >= WEED_STILLNESS;

interface WeedWriter {
  flow: number[];
  placement: number[];
  shape: number[];
}

const addClump = (
  writer: WeedWriter,
  world: WorldData,
  spot: WeedSpot,
  context: { fog: Float32Array; random: Random }
) => {
  const { fog, random } = context;
  const height = Math.min(MAX_HEIGHT, spot.depth - TIP_CLEARANCE) * (0.6 + random() * 0.4);
  const visibility = sampleBilinear(world, fog, spot.x, spot.z);
  writer.placement.push(spot.x, spot.ground, spot.z, random() * Math.PI * 2);
  writer.shape.push(height, 0.8 + random() * 0.5, random() * Math.PI * 2, visibility);
  writer.flow.push(...readFlow(world, spot.x, spot.z));
};

const toWaterWeeds = (writer: WeedWriter): WaterWeeds => ({
  count: writer.placement.length / 4,
  flow: Float32Array.from(writer.flow),
  placement: Float32Array.from(writer.placement),
  shape: Float32Array.from(writer.shape)
});

/**
 * Clumps of the cells in `region` only. Every cell draws from its own keyed stream, so a cell's
 * clumps are exactly the same whether the whole map or just its neighbourhood is rebuilt.
 */
const buildWaterWeedsInRegion = (
  world: WorldData,
  fog: Float32Array,
  region: CellRegion,
  stillAt: StillSampler
): WaterWeeds => {
  const randomForCell = createKeyedRandom(deriveSeed(world.seed, "water-weeds"));
  const patches = createFbm(deriveSeed(world.seed, "weed-patches"), { octaves: 2 });
  const writer: WeedWriter = { flow: [], placement: [], shape: [] };
  for (let cellZ = region.minZ; cellZ <= region.maxZ; cellZ += 1) {
    for (let cellX = region.minX; cellX <= region.maxX; cellX += 1) {
      if (!hasStillCorner(stillAt, cellX, cellZ)) continue;
      const random = randomForCell(cellZ * world.cellsX + cellX);
      for (let attempt = 0; attempt < TRIES_PER_CELL; attempt += 1) {
        const spot = readWeedSpot(world, cellX + random(), cellZ + random());
        const stillness = stillAt(spot.x, spot.z);
        const chance = getWeedChance(spot, stillness, patches(spot.x * 0.3, spot.z * 0.3));
        if (random() < chance) addClump(writer, world, spot, { fog, random });
      }
    }
  }
  return toWaterWeeds(writer);
};

/** Clumps of every still, clear and deep enough cell; deterministic per world seed and cell. */
export const buildWaterWeeds = (world: WorldData, fog: Float32Array): WaterWeeds => {
  const still = createStillWater(world, world);
  return buildWaterWeedsInRegion(
    world, fog,
    { maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0 },
    (x, z) => sampleStillField(world, still, x, z)
  );
};

/** The clumps of the edited cells only (a regional rebuild keeps every other clump untouched). */
export const buildWaterWeedsRegion = (
  world: WorldData,
  fog: Float32Array,
  cells: CellRegion
): WaterWeeds => {
  const region = clampRegion(world, cells);
  if (isRegionEmpty(region)) return toWaterWeeds({ flow: [], placement: [], shape: [] });
  return buildWaterWeedsInRegion(
    world, fog, region,
    (x, z) => sampleStillWater(world, world, x, z)
  );
};

const isClumpInCells = (weeds: WaterWeeds, index: number, cells: CellRegion) => {
  const x = Math.floor(weeds.placement[index * 4]!);
  const z = Math.floor(weeds.placement[index * 4 + 2]!);
  return x >= cells.minX && x <= cells.maxX && z >= cells.minZ && z <= cells.maxZ;
};

const compareClumpCells = (
  first: WaterWeeds,
  firstIndex: number,
  second: WaterWeeds,
  secondIndex: number
) => {
  const firstZ = Math.floor(first.placement[firstIndex * 4 + 2]!);
  const secondZ = Math.floor(second.placement[secondIndex * 4 + 2]!);
  return firstZ - secondZ ||
    Math.floor(first.placement[firstIndex * 4]!) - Math.floor(second.placement[secondIndex * 4]!);
};

const appendClump = (writer: WeedWriter, weeds: WaterWeeds, index: number) => {
  writer.placement.push(...weeds.placement.subarray(index * 4, index * 4 + 4));
  writer.shape.push(...weeds.shape.subarray(index * 4, index * 4 + 4));
  writer.flow.push(...weeds.flow.subarray(index * 2, index * 2 + 2));
};

/**
 * Replaces the clumps of `cells` in `weeds` with `region` (the result of buildWaterWeedsRegion
 * for the same cells), keeping every other clump, in the same order as a full build.
 */
export const replaceWaterWeedsRegion = (
  weeds: WaterWeeds,
  region: WaterWeeds,
  cells: CellRegion
): WaterWeeds => {
  const kept: number[] = [];
  for (let index = 0; index < weeds.count; index += 1)
    if (!isClumpInCells(weeds, index, cells)) kept.push(index);
  kept.sort((left, right) => compareClumpCells(weeds, left, weeds, right));
  const writer: WeedWriter = { flow: [], placement: [], shape: [] };
  let baseIndex = 0, regionIndex = 0;
  while (baseIndex < kept.length || regionIndex < region.count) {
    const takeRegion =
      baseIndex >= kept.length ||
      (regionIndex < region.count &&
        compareClumpCells(weeds, kept[baseIndex]!, region, regionIndex) > 0);
    if (takeRegion) appendClump(writer, region, regionIndex++);
    else appendClump(writer, weeds, kept[baseIndex++]!);
  }
  return toWaterWeeds(writer);
};

const WEED_COLORS = {
  root: [0.08, 0.17, 0.06],
  tip: [0.3, 0.46, 0.12]
} as const;

/** One ribbon strand: rises with a lean and a gentle S curve, narrowing to its tip. */
const addStrand = (mesh: { [Key in keyof WeedClumpMesh]: number[] }, random: Random) => {
  const first = mesh.bend.length;
  const angle = random() * Math.PI * 2;
  const reach = Math.sqrt(random()) * CLUMP_SPREAD;
  const rootX = Math.cos(angle) * reach;
  const rootZ = Math.sin(angle) * reach;
  const lean = random() * Math.PI * 2;
  const leanX = Math.cos(lean) * (0.1 + random() * 0.2);
  const leanZ = Math.sin(lean) * (0.1 + random() * 0.2);
  const length = 0.6 + random() * 0.4;
  const facing = random() * Math.PI;
  const sideX = Math.cos(facing);
  const sideZ = Math.sin(facing);
  for (let segment = 0; segment <= STRAND_SEGMENTS; segment += 1) {
    const t = segment / STRAND_SEGMENTS;
    const curve = Math.sin(t * Math.PI * 1.5) * 0.04;
    const x = rootX + leanX * t * t + sideZ * curve;
    const z = rootZ + leanZ * t * t - sideX * curve;
    const half = STRAND_WIDTH * 0.5 * (1 - t * 0.75);
    const color = WEED_COLORS.root.map(
      (value, channel) => value + (WEED_COLORS.tip[channel]! - value) * t
    );
    for (const sign of [-1, 1]) {
      mesh.positions.push(x + sideX * half * sign, t * length, z + sideZ * half * sign);
      mesh.normals.push(-sideZ, 0.6, sideX);
      mesh.colors.push(...color);
      mesh.bend.push(t);
    }
  }
  for (let segment = 0; segment < STRAND_SEGMENTS; segment += 1) {
    const a = first + segment * 2;
    mesh.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
};

/** The shared clump: STRANDS ribbons (70 triangles), deterministic. */
export const createWeedClumpMesh = (): WeedClumpMesh => {
  const random = createRandom(deriveSeed(1, "weed-clump"));
  const mesh = { bend: [], colors: [], indices: [], normals: [], positions: [] };
  for (let strand = 0; strand < STRANDS; strand += 1) addStrand(mesh, random);
  return {
    bend: Float32Array.from(mesh.bend),
    colors: Float32Array.from(mesh.colors),
    indices: Uint16Array.from(mesh.indices),
    normals: Float32Array.from(mesh.normals),
    positions: Float32Array.from(mesh.positions)
  };
};
