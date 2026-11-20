import type { GridSize } from "../grid-geometry";
import { clamp, createFbm, lerp, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { computeCoastTypes } from "./coast-types";
import { computeDistanceField } from "./distance-field";
import { REFERENCE_CELLS } from "./world-scale";

/**
 * Deepest sea floor (the water field encodes depths up to 6, and the open sea outside the map
 * reads the border depth, so the map edge meets it at the same depth).
 */
const MAX_DEPTH = 5;
/**
 * In front of a beach: a short shore face down to a wide, light shelf (turquoise, shelfDepth),
 * then the drop to MAX_DEPTH further out (distances in cells from land).
 */
const BEACH_PROFILE = { dropEnd: 21, dropStart: 9, faceWidth: 2.5, shelfDepth: 1 } as const;
/** In front of a cliff: a short irregular ledge followed by a steep offshore drop. */
const CLIFF_PROFILE = { ledgeDepth: 1.45, faceWidth: 1.2, dropStart: 3, dropEnd: 9 } as const;
/** Gentle low-frequency wobble of the depth (share of it), so the bands never look ruled. */
const NOISE_SHARE = 0.1;
/**
 * Shallower banks and deeper hollows on the beach shelf (share of its depth, frequency); the
 * shore face (cells from land: none up to `start`, full from `full`) and the drop stay even.
 */
const SHELF_RELIEF = { frequency: 14, full: 7, share: 0.6, start: 3 } as const;
/**
 * The first cell off the shore keeps the even slope of the shore (SHORE_SLOPE per cell): the
 * waterline (wet sand, foam, the shore ground's slope) stays as tuned; the coast profile takes
 * over from `start` to `full` cells.
 */
const SHORE_SLOPE = 0.2;
const PROFILE_BLEND = { full: 3, start: 1 } as const;
/** River beds keep their carved depth; the sea floor takes over beyond this many cells. */
const RIVER_BLEND = { full: 4, start: 1 } as const;
/**
 * In front of cliffs the first sea vertex keeps its depth (the shoreline does not move); the
 * shelf takes over from here. In front of beaches the shore slope starts at the first sea vertex,
 * so the sand slopes gently into the water (owner, 2026-10-13).
 */
const SHORE_BLEND = { full: 2.5, start: 0.5 } as const;

/** Share of the shaped sea floor: 1 off beaches, from SHORE_BLEND off cliffs, 0 at river mouths. */
const getShelfShare = (distance: number, coastType: number, riverDistance: number) => {
  const offshore = Math.max(
    smoothstep(SHORE_BLEND.start, SHORE_BLEND.full, distance),
    1 - coastType
  );
  return offshore * smoothstep(RIVER_BLEND.start, RIVER_BLEND.full, riverDistance);
};

const getBeachDepth = (landDistance: number, shelfScale: number) => {
  const { dropEnd, dropStart, faceWidth, shelfDepth } = BEACH_PROFILE;
  const drop = smoothstep(dropStart, dropEnd, landDistance);
  const onShelf = smoothstep(SHELF_RELIEF.start, SHELF_RELIEF.full, landDistance) * (1 - drop);
  const face = 1 - Math.exp(-landDistance / faceWidth);
  const shelf = shelfDepth * lerp(1, shelfScale, onShelf) * face;
  return shelf + (MAX_DEPTH - shelfDepth) * drop;
};

const getCliffDepth = (landDistance: number, shelfScale: number) => {
  const { dropEnd, dropStart, faceWidth, ledgeDepth } = CLIFF_PROFILE;
  const ledge = ledgeDepth * (1 + clamp(shelfScale - 1, -0.6, 0.6) * 0.15);
  const face = ledge * (1 - Math.exp(-landDistance / faceWidth));
  return face + (MAX_DEPTH - ledge) * smoothstep(dropStart, dropEnd, landDistance);
};

/**
 * Sea depth at a distance (cells) from land in front of a coast of the given type (0 beach .. 1
 * cliff); `shelfScale` varies the depth of the beach shelf (banks and hollows).
 */
export const getSeabedDepth = (landDistance: number, coastType: number, shelfScale = 1) =>
  lerp(getBeachDepth(landDistance, shelfScale), getCliffDepth(landDistance, shelfScale), coastType);

/**
 * Readable sea depths by coast type: below sea level the ground becomes a sea floor that
 * deepens with the distance from the nearest land, slowly in front of beaches (a wide turquoise
 * shelf) and fast in front of cliffs and mountain coasts (dark water near the cliff foot),
 * blending smoothly along the coast, with a slight noise; the beach slope right at the shore and
 * the river beds and mouths keep their shape.
 */
export const shapeSeabed = (
  grid: GridSize,
  seed: number,
  layers: { heights: Float32Array; riverMask: Uint8Array; seaLevel: number }
) => {
  const { heights, riverMask, seaLevel } = layers;
  const landDistance = computeDistanceField(grid, (index) => heights[index]! >= seaLevel);
  const riverDistance = computeDistanceField(grid, (index) => riverMask[index] === 1);
  const coastTypes = computeCoastTypes(grid, heights, seaLevel);
  const noise = createFbm(deriveSeed(seed, "seabed"), { octaves: 2 });
  const relief = createFbm(deriveSeed(seed, "seabed-shelf"), { octaves: 3 });
  const stride = grid.cellsX + 1;
  for (let index = 0; index < heights.length; index += 1) {
    if (heights[index]! >= seaLevel) continue;
    const u = (index % stride) / REFERENCE_CELLS;
    const v = Math.floor(index / stride) / REFERENCE_CELLS;
    const wobble = 1 + noise(u * 4, v * 4) * NOISE_SHARE;
    const shelfScale =
      1 + relief(u * SHELF_RELIEF.frequency, v * SHELF_RELIEF.frequency) * SHELF_RELIEF.share;
    const distance = landDistance[index]!;
    const coastType = coastTypes[index]!;
    const profile = getSeabedDepth(distance, coastType, shelfScale);
    const toProfile = smoothstep(PROFILE_BLEND.start, PROFILE_BLEND.full, distance);
    const depth = lerp(SHORE_SLOPE * distance, profile, toProfile) * wobble;
    const shelf = getShelfShare(distance, coastType, riverDistance[index]!);
    const shaped = heights[index]! + (seaLevel - depth - heights[index]!) * shelf;
    const x = index % stride,
      z = Math.floor(index / stride);
    const edge = Math.min(x, z, grid.cellsX - x, grid.cellsZ - z);
    // Narrow sea slivers along the map edge still need real swimming water inside the map.
    // Fade the floor offshore and inwards; never move land or carve a river mouth.
    const edgeDepth =
      0.18 *
      smoothstep(0.5, 1.5, distance) *
      (1 - smoothstep(0, 3, edge)) *
      smoothstep(RIVER_BLEND.start, RIVER_BLEND.full, riverDistance[index]!);
    heights[index] = Math.min(shaped, seaLevel - edgeDepth);
  }
};
