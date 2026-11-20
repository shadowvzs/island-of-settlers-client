import { EXPLORATION_LOD_DEFAULTS, EXPLORATION_SHADOW_RADIUS } from "./exploration/exploration-lod";

/**
 * R08 cascade plan of the possessed sun shadows: pure numbers (layout, radii, refresh), no GPU
 * objects. Every cascade is centred on the eye: with the eye view's wide horizontal field
 * (16:9 at 68° vertical, tan 1.2) a circle of the slice's far distance is smaller than the
 * forward-fitted bounding circle, and it does not change when the player turns, so the cached
 * far cascade stays valid while looking around.
 */

/**
 * Layer of the dynamic sun casters (people, mounts, ships, carts) in their own scenes: the light
 * camera draws only this layer of those scenes, the main cameras never enable it. A mesh on this
 * layer alone (a character's LOD2 caster proxy) is drawn into the shadow map and nowhere else.
 */
export const SHADOW_CASTER_LAYER = 2;

/**
 * Layer of static casters that only the detailed cascades (and the single map) draw: small plants
 * and bushes, whose shadows are below a far cascade texel (R08 per-cascade vegetation mask).
 */
export const SHADOW_NEAR_CASTER_LAYER = 3;

/** Largest atlas tile: the High 4096² map holds three 2048² cascades, Medium two side by side. */
export const SHADOW_CASCADE_TILE = 2048;

/** Share of a tile (local uv, per side) over which a cascade blends into the next one. */
export const SHADOW_CASCADE_BAND = 0.06;

/** Local uv kept clear at a tile's border: the widest filter kernel never reads a neighbour. */
export const SHADOW_CASCADE_KERNEL_TEXELS = 7;

/**
 * The far cascade (cached, D7) is rebuilt in this many quadrant strips, one per frame, in
 * the spare atlas slot, then swapped in: its cost is spread over the frames instead of a spike.
 */
export const SHADOW_FAR_STRIPS = 4;

/** Extra ground around the last cascade: receivers above or below the eye still find a texel. */
const FAR_MARGIN = 18;

/** Light extents change in these steps, so a fitted cascade only re-quantises on a real change. */
const EXTENT_STEP = 4;

/** Nearest cascade of High: a sharp ring around the body and the hands' work. */
const HIGH_NEAR_RADIUS = 20;

export interface ShadowAtlasLayout {
  /** Cascades of the possessed view (1: the single eye-centred map, today's behaviour). */
  cascades: number;
  /** Slots per atlas row. */
  columns: number;
  /** Atlas slots of the far cascade: two (front and back buffer) when it is cached, else one. */
  farSlots: readonly number[];
  height: number;
  /** Side of the square that the isometric view (and the 1-cascade possessed view) uses. */
  isoSize: number;
  /** Side of one cascade tile (slot). */
  tile: number;
  width: number;
}

/**
 * Atlas of the depth texture: one `mapSize` square without cascades; with cascades 2048² slots,
 * shrunk to fit `maxTextureSize`: three in a row (Medium: near and the far cascade's front and
 * back buffer) or 2 x 2 (High: near, middle and the far buffers). Iso keeps the first `mapSize`
 * square, so its texel density is the same as before cascades.
 */
export const getShadowAtlasLayout = (
  mapSize: number,
  cascades: number,
  maxTextureSize: number
): ShadowAtlasLayout => {
  if (cascades <= 1) {
    return { cascades: 1, columns: 1, farSlots: [0], height: mapSize, isoSize: mapSize, tile: mapSize, width: mapSize };
  }
  const columns = cascades > 2 ? 2 : 3;
  const rows = cascades > 2 ? 2 : 1;
  const tile = Math.min(SHADOW_CASCADE_TILE, Math.floor(maxTextureSize / columns));
  const farSlots = [cascades - 1, cascades];
  const width = tile * columns;
  const height = tile * rows;
  return { cascades, columns, farSlots, height, isoSize: Math.min(mapSize, width, height), tile, width };
};

/** Texel origin of atlas slot `slot`: left to right, then the next row. */
export const getSlotOrigin = (slot: number, tile: number, columns: number) => ({
  x: (slot % columns) * tile,
  y: Math.floor(slot / columns) * tile
});

/**
 * Quadrant `strip` of a far tile: its texel rectangle and the clip-space remap (scale 2, offset)
 * that turns the whole tile's projection into the quadrant's, texel for texel.
 */
export const getFarStrip = (strip: number, slot: number, tile: number, columns: number) => {
  const origin = getSlotOrigin(slot, tile, columns);
  const column = strip % 2;
  const row = Math.floor(strip / 2);
  const half = tile / 2;
  return {
    offsetX: 1 - 2 * column,
    offsetY: 1 - 2 * row,
    rect: { height: half, width: half, x: origin.x + column * half, y: origin.y + row * half }
  };
};

/**
 * Eye distances the cascades cover with full quality. The detailed ones end at the exploration
 * shadow radius (moving casters are drawn there), the last one at the exploration view distance.
 */
export const getCascadeRadii = (cascades: number): readonly number[] => {
  const far = EXPLORATION_LOD_DEFAULTS.maxViewDistance;
  if (cascades >= 3) return [HIGH_NEAR_RADIUS, EXPLORATION_SHADOW_RADIUS, far];
  if (cascades === 2) return [EXPLORATION_SHADOW_RADIUS, far];
  return [far];
};

/**
 * Light camera half extent of a cascade: its radius plus the blend band and kernel border (so the
 * radius still has full quality), the last one also the receiver height margin; in steps.
 */
export const getCascadeHalfExtent = (radius: number, last: boolean, tile: number) => {
  const border = SHADOW_CASCADE_BAND + SHADOW_CASCADE_KERNEL_TEXELS / tile;
  const covered = (radius + (last ? FAR_MARGIN : 0)) / (1 - 2 * border);
  return Math.ceil(covered / EXTENT_STEP) * EXTENT_STEP;
};

/** Cascades whose radius lies within the moving-caster radius (people, mounts, vehicles). */
export const getDynamicCascadeCount = (radii: readonly number[]) =>
  radii.filter(radius => radius <= EXPLORATION_SHADOW_RADIUS).length;
