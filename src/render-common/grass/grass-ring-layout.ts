import { smoothstep } from "../../shared/world/noise";
import { createRandom } from "../../shared/world/rng";

/**
 * T07 possessed-view grass ring (pure, worker-safe): world-anchored square tiles around the eye,
 * each drawn as one instance of a blade patch. Blades in a patch are ordered so that every prefix
 * is spread evenly over the tile; a far band draws only a prefix of the same patch, so its blades
 * keep the positions they had in the nearer band (no reshuffle while walking).
 */
export type GrassRingLevel = "off" | "compact" | "dense";

export const GRASS_RING_LEVELS: readonly GrassRingLevel[] = ["off", "compact", "dense"];

/** Tile edge in world units (cells). */
export const GRASS_RING_TILE = 2;
/** Blades of the shared patch (a power of four); a level keeps a prefix of it. */
export const GRASS_RING_PATCH_BLADES = 1024;
/** Ground tint channels are stored as 8-bit steps of this range, packed into one float. */
export const GRASS_RING_TINT_RANGE = 2;
/** Cover-field ramp of the ring's meadow density (roads, plots, fields and sand are 0). */
export const GRASS_RING_COVER_RAMP = { end: 0.6, start: 0.03 } as const;
/** Spacing of the ring's ground samples (the terrain mesh vertex spacing). */
export const GRASS_RING_SAMPLE_SPACING = 0.5;
/**
 * Share of the ring radius where its blades start to fade out (grass-band 2026-11-14: a wide outer band,
 * was 0.7); the short-grass tufts take over what the ring gives up (`getGrassRingTuftKeep`).
 */
export const GRASS_RING_FADE_START = 0.55;
/**
 * The outer fade is broken up by world-anchored value noise: the fade distance moves inwards by up to
 * this share of the radius (never outwards: no blade beyond the ring tiles), so no circle shows.
 */
export const GRASS_RING_EDGE_NOISE = 0.15;
/** World frequency of that noise (one blotch spans a few cells). */
export const GRASS_RING_EDGE_NOISE_SCALE = 0.3;
/**
 * Exponent of the kept-share falloff beyond `fullDensity` (share = (fullDensity / d)^falloff). Seen
 * from the eye, the ground a blade hides grows with its distance (grazing view), so the cover of the
 * ring falls only as 1 / sqrt(d) and still meets the tufts at the ring edge (grass-lod 2026-11-13:
 * the old (fullDensity / d)^2 thinned the meadow inside the ring well below the tufts beyond it).
 */
export const GRASS_RING_FALLOFF = 1.5;
/** Largest distance of the eye from the centre of its own tile (half the tile diagonal). */
const EYE_TILE_OFFSET = GRASS_RING_TILE * Math.SQRT1_2;

export interface GrassRingBand {
  /** Blades of the patch drawn by this band (a prefix of the rank order). */
  blades: number;
  /** Segments per blade (2 * segments + 1 vertices). */
  segments: number;
}

export interface GrassRingSettings {
  bands: readonly GrassRingBand[];
  /** Share of the patch kept at full density (Medium draws half the blades). */
  density: number;
  /** Full density up to this eye distance; beyond it the share falls as (fullDensity / d)^GRASS_RING_FALLOFF. */
  fullDensity: number;
  /** The ring ends here (blades fade out from GRASS_RING_FADE_START of it). */
  radius: number;
  /**
   * Blade cover of the short-grass tufts relative to the ring at full density (grass-band 2026-11-14).
   * Ring: 256 blades per cell of 0.026 x 0.18 x 0.56 (taper) = 0.67. Tufts: grassSamples x 0.85
   * (short-grass share of the mix) x 0.044 (mean blade area of a tuft): High 0.52 / 0.67 (14 samples),
   * Medium 0.22 / 0.67 (both scale with the same ground acceptance). Beyond
   * the eye distance where the ring's share falls below this, the tufts fill the rest of the meadow.
   */
  tuftCover: number;
}

/**
 * grass-lod 2026-11-13: one segment less in the two nearest bands pays for the slower falloff.
 * grass-band 2026-11-14 (owner: dense blades look better): full density out to 4.5 (was 3).
 */
const DENSE: GrassRingSettings = {
  bands: [
    { blades: 1024, segments: 4 },
    { blades: 512, segments: 3 },
    { blades: 256, segments: 2 },
    { blades: 128, segments: 2 },
    { blades: 64, segments: 2 }
  ],
  density: 1,
  fullDensity: 4.5,
  radius: 16,
  tuftCover: 0.77
};

/**
 * Medium (OD-T6, owner 2026-11-09): as lush as High near the eye (the short-grass tufts leave the
 * ring), with fewer blade segments and a smaller radius.
 */
const COMPACT: GrassRingSettings = {
  bands: [
    { blades: 1024, segments: 3 },
    { blades: 512, segments: 2 },
    { blades: 256, segments: 2 },
    { blades: 128, segments: 2 },
    { blades: 64, segments: 1 }
  ],
  density: 1,
  fullDensity: 2.5,
  radius: 12,
  tuftCover: 0.33
};

export const getGrassRingSettings = (level: GrassRingLevel): GrassRingSettings | null => {
  if (level === "dense") return DENSE;
  if (level === "compact") return COMPACT;
  return null;
};

/** Kept share of the patch at an eye distance, before the ground density (shader mirror). */
export const getGrassRingShare = (settings: GrassRingSettings, distance: number) =>
  settings.density * Math.min(1, (settings.fullDensity / Math.max(distance, 1e-6)) ** GRASS_RING_FALLOFF);

/**
 * Outer fade of the ring at an eye distance (shader mirror); `noise` (0..1) is the world value noise
 * that pulls the fade inwards in blotches.
 */
export const getGrassRingEdge = (settings: GrassRingSettings, distance: number, noise: number) => {
  const shifted = distance + noise * GRASS_RING_EDGE_NOISE * settings.radius;
  return 1 - smoothstep(settings.radius * GRASS_RING_FADE_START, settings.radius, shifted);
};

/**
 * Kept share of the short-grass tufts inside the ring (shader mirror): they fill exactly the cover
 * the ring's blades no longer give, so both layers cross-fade over a wide band at equal density.
 */
export const getGrassRingTuftKeep = (settings: GrassRingSettings, distance: number, noise: number) => {
  const ringCover = getGrassRingShare(settings, distance) * getGrassRingEdge(settings, distance, noise);
  return 1 - Math.min(1, ringCover / settings.tuftCover);
};

/**
 * Nearest band whose prefix still holds every blade the shader can keep at this distance. The
 * distance is the conservative nearest blade distance of a tile.
 */
export const getGrassRingBand = (settings: GrassRingSettings, nearestDistance: number) => {
  const share = getGrassRingShare(settings, Math.max(0, nearestDistance));
  let band = 0;
  for (let index = 1; index < settings.bands.length; index++) {
    if (settings.bands[index]!.blades < share * GRASS_RING_PATCH_BLADES) break;
    band = index;
  }
  return band;
};

/** Tiles from the centre tile to the ring edge, plus the tile the eye may be offset into. */
export const getGrassRingTileReach = (settings: GrassRingSettings) =>
  Math.ceil((settings.radius + EYE_TILE_OFFSET) / GRASS_RING_TILE);

/**
 * Ground samples along one side of the toroidal window: the tile reach on both sides of the
 * centre tile, plus one sample for the bilinear neighbour.
 */
export const getGrassRingWindowSamples = (settings: GrassRingSettings) =>
  ((getGrassRingTileReach(settings) * 2 + 1) * GRASS_RING_TILE) / GRASS_RING_SAMPLE_SPACING + 2;

/** Distance from a point to the nearest point of a tile (0 inside). */
const distanceToTile = (tileX: number, tileZ: number, x: number, z: number) => {
  const minX = tileX * GRASS_RING_TILE, minZ = tileZ * GRASS_RING_TILE;
  const dx = Math.max(minX - x, 0, x - minX - GRASS_RING_TILE);
  const dz = Math.max(minZ - z, 0, z - minZ - GRASS_RING_TILE);
  return Math.hypot(dx, dz);
};

/** Preallocated per-band tile lists (tile x, z pairs) of the ring around one centre tile. */
export interface GrassRingTiles {
  counts: Int32Array;
  tiles: Int32Array[];
}

export const createGrassRingTiles = (settings: GrassRingSettings): GrassRingTiles => {
  const side = getGrassRingTileReach(settings) * 2 + 1;
  return {
    counts: new Int32Array(settings.bands.length),
    tiles: settings.bands.map(() => new Int32Array(side * side * 2))
  };
};

/**
 * Fills the band tile lists for the ring around `centreTile`. A tile's band comes from its nearest
 * distance to the centre tile's middle minus the largest eye offset inside that tile, so the
 * result only changes when the eye crosses into another tile.
 */
export const fillGrassRingTiles = (
  settings: GrassRingSettings,
  centreTileX: number,
  centreTileZ: number,
  target: GrassRingTiles
) => {
  const reach = getGrassRingTileReach(settings);
  const middleX = (centreTileX + 0.5) * GRASS_RING_TILE;
  const middleZ = (centreTileZ + 0.5) * GRASS_RING_TILE;
  target.counts.fill(0);
  for (let tileZ = centreTileZ - reach; tileZ <= centreTileZ + reach; tileZ++) {
    for (let tileX = centreTileX - reach; tileX <= centreTileX + reach; tileX++) {
      const nearest = distanceToTile(tileX, tileZ, middleX, middleZ) - EYE_TILE_OFFSET;
      if (nearest >= settings.radius) continue;
      const band = getGrassRingBand(settings, nearest);
      const offset = target.counts[band]! * 2;
      target.tiles[band]![offset] = tileX;
      target.tiles[band]![offset + 1] = tileZ;
      target.counts[band]!++;
    }
  }
};

/** Interleaves the bits of x and y (Morton order, 16 bits each). */
const interleave = (x: number, y: number) => {
  let code = 0;
  for (let bit = 0; bit < 16; bit++) code |= (((x >> bit) & 1) << (2 * bit)) | (((y >> bit) & 1) << (2 * bit + 1));
  return code >>> 0;
};

const reverseBits = (value: number, bits: number) => {
  let result = 0;
  for (let bit = 0; bit < bits; bit++) result |= ((value >> bit) & 1) << (bits - 1 - bit);
  return result;
};

/**
 * Blade roots of one patch in tile-local units (0..GRASS_RING_TILE), in rank order: a jittered
 * grid whose cells are visited in bit-reversed Morton order, so every 4^k prefix is an even
 * 2^k x 2^k sub-grid. `count` must be a power of four.
 */
export const createGrassRingPatch = (count: number, seed: number) => {
  const side = Math.round(Math.sqrt(count));
  const bits = Math.round(Math.log2(count));
  if (side * side !== count || 4 ** (bits / 2) !== count) throw new Error("Patch size must be a power of four");
  const random = createRandom(seed);
  const cellSize = GRASS_RING_TILE / side;
  const roots = new Float32Array(count * 2);
  for (let cellZ = 0; cellZ < side; cellZ++) {
    for (let cellX = 0; cellX < side; cellX++) {
      const rank = reverseBits(interleave(cellX, cellZ), bits);
      roots[rank * 2] = (cellX + 0.1 + random() * 0.8) * cellSize;
      roots[rank * 2 + 1] = (cellZ + 0.1 + random() * 0.8) * cellSize;
    }
  }
  return roots;
};
