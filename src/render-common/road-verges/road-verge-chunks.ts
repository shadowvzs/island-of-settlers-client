import type { RoadVergePlacement } from "./road-verge-placement";
import { VERGE_SPECIES } from "./verge-plant-geometry";

/** Verge culling and thinning granularity (world units). */
export const VERGE_CHUNK_CELLS = 8;
/** Height stretch per placement variant: short, typical and tall plants of one species. */
const VARIANT_HEIGHT = [.86, 1, 1.14] as const;
/** The plant base sits this far into the ground so slopes never show a floating rosette edge. */
const SINK = .01;

/** Instance data of one species, ordered by chunk and, inside a chunk, by rising rank. */
export interface VergeSpeciesInstances {
  colors: Float32Array;
  matrices: Float32Array;
  ranks: Float32Array;
}

export interface VergeChunk {
  /** Per species (VERGE_SPECIES order): instance count and first instance in that species' arrays. */
  counts: Int32Array;
  maxX: number;
  maxY: number;
  maxZ: number;
  minX: number;
  minY: number;
  minZ: number;
  starts: Int32Array;
}

export interface RoadVergeChunks {
  chunks: VergeChunk[];
  plants: number;
  species: VergeSpeciesInstances[];
}

/** Column-major yaw x uniform scale x height stretch, at the ground point. */
const writeMatrix = (target: Float32Array, offset: number, placement: RoadVergePlacement, y: number) => {
  const cos = Math.cos(placement.yaw) * placement.scale, sin = Math.sin(placement.yaw) * placement.scale;
  const height = placement.scale * VARIANT_HEIGHT[placement.variant % VARIANT_HEIGHT.length]!;
  target.set([cos, 0, -sin, 0, 0, height, 0, 0, sin, 0, cos, 0, placement.x, y - SINK, placement.z, 1], offset);
};

/** Slight per-plant lightness and warmth variation of the vertex tint (natural flower parts ignore it). */
const writeColour = (target: Float32Array, offset: number, placement: RoadVergePlacement) => {
  const light = .9 + .2 * ((placement.phase / (Math.PI * 2)) % 1), warm = (placement.yaw / Math.PI - 1) * .05;
  target[offset] = light * (1 + warm); target[offset + 1] = light; target[offset + 2] = light * (1 - warm * 1.5);
};

const chunkKey = (x: number, z: number) =>
  Math.floor(x / VERGE_CHUNK_CELLS) * 65536 + Math.floor(z / VERGE_CHUNK_CELLS);

/**
 * Groups placements into ground chunks with per-species, rank-ordered instance runs: any prefix
 * of a run is the nested subset kept at a smaller projected size. Built once per verge rebuild.
 */
export const createRoadVergeChunks = (placements: readonly RoadVergePlacement[],
  groundHeight: (x: number, z: number) => number): RoadVergeChunks => {
  const grouped = new Map<number, RoadVergePlacement[]>();
  for (const placement of placements) {
    const key = chunkKey(placement.x, placement.z), group = grouped.get(key);
    if (group) group.push(placement); else grouped.set(key, [placement]);
  }
  const keys = [...grouped.keys()].sort((first, second) => first - second);
  const totals = VERGE_SPECIES.map(kind => placements.filter(placement => placement.kind === kind).length);
  const species = totals.map(total => ({ colors: new Float32Array(total * 3), matrices: new Float32Array(total * 16),
    ranks: new Float32Array(total) }));
  const written = VERGE_SPECIES.map(() => 0);
  const chunks = keys.map((key): VergeChunk => {
    const members = grouped.get(key)!.slice().sort((first, second) => first.rank - second.rank);
    const chunk: VergeChunk = { counts: new Int32Array(VERGE_SPECIES.length), maxX: -Infinity, maxY: -Infinity,
      maxZ: -Infinity, minX: Infinity, minY: Infinity, minZ: Infinity, starts: Int32Array.from(written) };
    for (const placement of members) {
      const kind = VERGE_SPECIES.indexOf(placement.kind), slot = written[kind]!++;
      const y = groundHeight(placement.x, placement.z);
      const target = species[kind]!;
      writeMatrix(target.matrices, slot * 16, placement, y);
      writeColour(target.colors, slot * 3, placement);
      target.ranks[slot] = placement.rank;
      chunk.counts[kind]! += 1;
      chunk.minX = Math.min(chunk.minX, placement.x - .3); chunk.maxX = Math.max(chunk.maxX, placement.x + .3);
      chunk.minZ = Math.min(chunk.minZ, placement.z - .3); chunk.maxZ = Math.max(chunk.maxZ, placement.z + .3);
      chunk.minY = Math.min(chunk.minY, y - .05); chunk.maxY = Math.max(chunk.maxY, y + .5);
    }
    return chunk;
  });
  return { chunks, plants: placements.length, species };
};

/** Instances of `kind` in `chunk` whose rank lies below `keep` (a prefix of the rank-ordered run). */
export const vergeKeptCount = (data: RoadVergeChunks, chunk: VergeChunk, kind: number, keep: number) => {
  const ranks = data.species[kind]!.ranks, start = chunk.starts[kind]!;
  let low = 0, high = chunk.counts[kind]!;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranks[start + middle]! < keep) low = middle + 1; else high = middle;
  }
  return low;
};
