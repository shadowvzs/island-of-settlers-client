/**
 * Shared contract of the offline decoration foliage atlases (climbers D04a, road verges V-R02a).
 * Every atlas is a fixed 4x4 grid; tile `index` = position in its tile list, column = index % 4,
 * row = floor(index / 4), rows counted from v = 0 (texture data row 0 is v = 0; flipY = false).
 * Tile-local UV: u to the right, v up; leaves and stems grow from their pivot towards +v.
 */
export type UvPoint = readonly [number, number];
export type UvRect = readonly [number, number, number, number];

export const FOLIAGE_ATLAS_GRID = 4;
/** Alpha cutoff the coverage-preserving mips were built for (alpha test / sharpened coverage). */
export const FOLIAGE_ATLAS_ALPHA_CUTOFF = 0.5;

/** Atlas UV rectangle [u0, v0, u1, v1] of a tile. */
export const foliageAtlasUvRect = (index: number): UvRect => {
  const column = index % FOLIAGE_ATLAS_GRID, row = Math.floor(index / FOLIAGE_ATLAS_GRID);
  const step = 1 / FOLIAGE_ATLAS_GRID;
  return [column * step, row * step, (column + 1) * step, (row + 1) * step];
};

/** Tile-local UV (0..1 inside the tile) to atlas UV. */
export const foliageAtlasUv = (rect: UvRect, [u, v]: UvPoint): [number, number] =>
  [rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v];

/** Channel contract of the three maps; see docs/plans/d04a-foliage-atlas-2026-11-07.md. */
export interface FoliageAtlasTile<Id extends string = string> {
  /** Fraction of the tile with alpha >= cutoff at level 0. */
  coverage: number;
  id: Id;
  index: number;
  /** Convex 8-vertex card outline in tile UV, counter-clockwise, enclosing every visible texel. */
  outline: UvPoint[];
  /** Tile-UV attachment point (petiole, pedicel or stem base) of the card. */
  pivot: UvPoint;
  uvRect: UvRect;
}

export interface FoliageAtlasFile {
  bytes: number;
  file: string;
  /** GPU bytes of the uploaded RGBA8 mip chain. */
  gpuBytes: number;
  levels: number;
  sha256: string;
  size: number;
}

export interface FoliageAtlasManifest<Id extends string = string> {
  alphaCutoff: number;
  files: {
    high: { albedo: FoliageAtlasFile; normal: FoliageAtlasFile; orm: FoliageAtlasFile };
    minimal: { albedo: FoliageAtlasFile; orm: FoliageAtlasFile };
  };
  /** Per mip level, the alpha >= cutoff coverage of all tiles relative to level 0 (1 = preserved). */
  levelCoverage: number[];
  tiles: FoliageAtlasTile<Id>[];
  version: number;
}

export interface FoliageCardVertices {
  /** Card-plane offsets from the pivot in tile units (1 = full tile edge), counter-clockwise. */
  positions: [number, number][];
  /** Atlas UVs of the same vertices (flipY = false textures). */
  uvs: [number, number][];
}

/**
 * The trimmed 8-vertex card of a tile: scale `positions` by the card's world size, place the
 * pivot at the attachment point, and fan-triangulate from vertex 0 (6 triangles, convex).
 */
export const foliageCardVertices = (tile: FoliageAtlasTile): FoliageCardVertices => ({
  positions: tile.outline.map(([u, v]) => [u - tile.pivot[0], v - tile.pivot[1]]),
  uvs: tile.outline.map(point => foliageAtlasUv(tile.uvRect, point))
});

/** Id lookup over one atlas manifest; unknown ids are a programming error. */
export const createFoliageTileLookup = <Id extends string>(manifest: FoliageAtlasManifest<Id>) => {
  const tiles = new Map(manifest.tiles.map(tile => [tile.id, tile]));
  return (id: Id): FoliageAtlasTile<Id> => {
    const tile = tiles.get(id);
    if (!tile) throw new Error(`Unknown foliage atlas tile: ${id}`);
    return tile;
  };
};
