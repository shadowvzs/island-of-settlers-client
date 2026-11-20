import { type CellRegion, type GridSize,isRegionEmpty } from "../shared/world/grid-geometry";
import type { WorldData } from "../shared/world/world-data";
import {
  createVertexAttributes,
  createVertexSampler,
  RENDER_SUBDIVISION,
  type SurfaceMode,
  type VertexAttributes
} from "./chunk-sampling";
import {
  appendStepVertices,
  createWaterStepSplitter,
  snapGroundWaterDepths,
  snapWaterSteps
} from "./water/water-steps";

export const CHUNK_CELLS = 32;

/** Vertex data of one chunk; renderers wrap the arrays into their own geometry objects. */
export interface ChunkVertexData extends VertexAttributes {
  chunkX: number;
  chunkZ: number;
  /**
   * Render quads per row (vertices per row minus one): positions may move off the grid (upright
   * rock faces), so the grid layout is not read back from them.
   */
  columns?: number;
  indices: Uint16Array;
  vertexCount: number;
}

const hasWater = (attributes: VertexAttributes, corners: number[]) =>
  corners.some((corner) => attributes.water[corner * 4]! > 0);

/**
 * A quad (corner heights a: x0 z0, b: x1 z0, c: x0 z1, d: x1 z1) splits along its main diagonal
 * a - d when that has the smaller height difference, else along b - c (follows ridges). Ground
 * picking splits the same way, so it hits the triangles on screen.
 */
export const splitsOnMainDiagonal = (a: number, b: number, c: number, d: number) =>
  Math.abs(a - d) <= Math.abs(b - c);

/** The two triangles of a quad, split along the diagonal that follows the surface. */
const getQuadTriangles = (positions: Float32Array, a: number, b: number, c: number, d: number) => {
  const heightOf = (vertex: number) => positions[vertex * 3 + 1]!;
  if (splitsOnMainDiagonal(heightOf(a), heightOf(b), heightOf(c), heightOf(d))) return [a, d, b, a, c, d];
  return [a, c, b, b, c, d];
};

type StepSplitter = ReturnType<typeof createWaterStepSplitter>;

/**
 * Quads ordered far to near (by column + row): with the iso camera this is a valid back to front
 * order for a height field (the transparent water surface blends in that order). Water: only wet
 * quads, and steps of the water level split into flat upper and lower parts.
 */
const buildIndices = (
  attributes: VertexAttributes,
  columns: number,
  rows: number,
  steps: StepSplitter | null
) => {
  const indices: number[] = [];
  const stride = columns + 1;
  for (let diagonal = 0; diagonal <= columns + rows - 2; diagonal += 1) {
    const lastRow = Math.min(rows - 1, diagonal);
    for (let row = Math.max(0, diagonal - columns + 1); row <= lastRow; row += 1) {
      const a = row * stride + diagonal - row;
      const corners = [a, a + 1, a + stride, a + stride + 1];
      if (steps && !hasWater(attributes, corners)) continue;
      const triangles = getQuadTriangles(attributes.positions, a, a + 1, a + stride, a + stride + 1);
      if (steps?.pushStepQuad(indices, corners, triangles)) continue;
      indices.push(...triangles);
    }
  }
  return Uint16Array.from(indices);
};

export const getChunkCounts = (world: GridSize) => ({
  chunksX: Math.ceil(world.cellsX / CHUNK_CELLS),
  chunksZ: Math.ceil(world.cellsZ / CHUNK_CELLS)
});

/** Grid position of a terrain chunk. */
export interface ChunkKey {
  chunkX: number;
  chunkZ: number;
}

/**
 * Chunks whose render vertices read the region's cells (map editor rebuilds): a chunk's last
 * row and column lie on the next chunk's first cells, so the region reaches one cell back.
 */
export const listRegionChunks = (world: GridSize, cells: CellRegion): ChunkKey[] => {
  if (isRegionEmpty(cells)) return [];
  const { chunksX, chunksZ } = getChunkCounts(world);
  const toChunk = (cell: number, count: number) =>
    Math.min(count - 1, Math.max(0, Math.floor(cell / CHUNK_CELLS)));
  const chunks: ChunkKey[] = [];
  const lastZ = toChunk(cells.maxZ, chunksZ);
  const lastX = toChunk(cells.maxX, chunksX);
  for (let chunkZ = toChunk(cells.minZ - 1, chunksZ); chunkZ <= lastZ; chunkZ += 1) {
    for (let chunkX = toChunk(cells.minX - 1, chunksX); chunkX <= lastX; chunkX += 1) {
      chunks.push({ chunkX, chunkZ });
    }
  }
  return chunks;
};

/**
 * Builds one chunk at render resolution; null for a water chunk without any wet quad. `preview`
 * skips the rock contact band (map editor: an instant look at new heights).
 */
export const buildChunk = (
  world: WorldData,
  fog: Float32Array,
  chunkX: number,
  chunkZ: number,
  mode: SurfaceMode,
  preview = false
): ChunkVertexData | null => {
  const columns = Math.min(CHUNK_CELLS, world.cellsX - chunkX * CHUNK_CELLS) * RENDER_SUBDIVISION;
  const rows = Math.min(CHUNK_CELLS, world.cellsZ - chunkZ * CHUNK_CELLS) * RENDER_SUBDIVISION;
  const vertexCount = (columns + 1) * (rows + 1);
  const attributes = createVertexAttributes(vertexCount);
  const originX = chunkX * CHUNK_CELLS;
  const originZ = chunkZ * CHUNK_CELLS;
  const region = { maxX: originX + columns / RENDER_SUBDIVISION, maxZ: originZ + rows / RENDER_SUBDIVISION,
    minX: originX, minZ: originZ };
  const sample = createVertexSampler(world, fog, mode, preview, region);
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const local = row * (columns + 1) + column;
      sample(
        attributes,
        local,
        originX + column / RENDER_SUBDIVISION,
        originZ + row / RENDER_SUBDIVISION
      );
    }
  }
  if (mode === "terrain") snapGroundWaterDepths(world, attributes, vertexCount);
  const steps = mode === "water"
    ? createWaterStepSplitter(attributes, snapWaterSteps(world, attributes, vertexCount))
    : null;
  const indices = buildIndices(attributes, columns, rows, steps);
  if (indices.length === 0) return null;
  const extra = steps?.extra ?? [];
  const surface = appendStepVertices(attributes, vertexCount, extra);
  return { ...surface, chunkX, chunkZ, columns, indices, vertexCount: vertexCount + extra.length };
};

/** Chunks in far to near order (back to front for the iso camera). */
export const listChunksFarToNear = (world: WorldData) => {
  const { chunksX, chunksZ } = getChunkCounts(world);
  const chunks: ChunkKey[] = [];
  for (let chunkZ = 0; chunkZ < chunksZ; chunkZ += 1) {
    for (let chunkX = 0; chunkX < chunksX; chunkX += 1) chunks.push({ chunkX, chunkZ });
  }
  return chunks.sort((a, b) => a.chunkX + a.chunkZ - (b.chunkX + b.chunkZ));
};

/**
 * The ocean frame reaches this far (cells) under the map and sits this far below sea level: the
 * map's terrain and water cover the overlap, so no crack between the meshes shows the
 * background (the open border of a peninsula meets it almost at sea level).
 */
const OCEAN_OVERLAP = 0.5;
const OCEAN_SINK = 0.02;

/** Sea outside the map: a frame of quads around the map rectangle at sea level (facing up). */
export const buildOceanFrame = (world: WorldData, margin: number) => {
  const outer = [-margin, -margin, world.cellsX + margin, world.cellsZ + margin] as const;
  const inner = [
    OCEAN_OVERLAP,
    OCEAN_OVERLAP,
    world.cellsX - OCEAN_OVERLAP,
    world.cellsZ - OCEAN_OVERLAP
  ] as const;
  const corners = [
    [outer[0], outer[1]],
    [outer[2], outer[1]],
    [outer[2], outer[3]],
    [outer[0], outer[3]],
    [inner[0], inner[1]],
    [inner[2], inner[1]],
    [inner[2], inner[3]],
    [inner[0], inner[3]]
  ];
  const level = world.seaLevel - OCEAN_SINK;
  const positions = Float32Array.from(corners.flatMap(([x, z]) => [x!, level, z!]));
  const indices = Uint16Array.from([
    0, 5, 1, 0, 4, 5, 1, 6, 2, 1, 5, 6, 2, 7, 3, 2, 6, 7, 3, 4, 0, 3, 7, 4
  ]);
  return { indices, positions };
};
