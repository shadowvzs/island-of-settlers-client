import { getVertexCount, type GridSize } from "../grid-geometry";
import { createFbm, createSimplexNoise, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { HEIGHT_LEVEL_STEP } from "../world-data";
import { computeDistanceField } from "./distance-field";
import type { GeneratedFeatureIdentity } from "./generated-feature-identities";
import type { IslandUplandShape } from "./island-uplands";
import type { LandformLayout } from "./landforms";
import { smoothMax } from "./mountain-ridges";
import { createMountainHeights } from "./mountains";
import { getLinearScale, toReferenceUnits } from "./world-scale";

/** Noise fields shared by later steps (forest and cliff placement read them too). */
export interface ShapeFields {
  /** > 0 on land, < 0 in the sea; grows towards the island centre. */
  continentalness: Float32Array;
  /** 0..1 where terraced cliffs are wanted. */
  cliffMask: Float32Array;
  /** 0..1 where mountains rise. */
  mountainMask: Float32Array;
  /** Massifs the land asks for at least (planned upland islands); absent on ordinary landforms. */
  minimumMassifs?: number;
}

/** Map coordinates of a vertex: normalised (-1..1, the landform) and in reference units. */
interface MapPoint {
  /** Reference units: noise features keep their size in cells on every map size. */
  pu: number;
  pv: number;
  u: number;
  v: number;
}

const toMapPoint = (grid: GridSize, vertexX: number, vertexZ: number): MapPoint => ({
  pu: toReferenceUnits(vertexX) - 1,
  pv: toReferenceUnits(vertexZ) - 1,
  u: (vertexX / grid.cellsX) * 2 - 1,
  v: (vertexZ / grid.cellsZ) * 2 - 1
});

/** Distances (cells) from a vertex to the four map borders. */
const getBorderDistances = (grid: GridSize, vertexX: number, vertexZ: number) => ({
  x0: vertexX,
  x1: grid.cellsX - vertexX,
  z0: vertexZ,
  z1: grid.cellsZ - vertexZ
});

/** Closed map edges keep a sea margin with small seeded coves rather than a ruler-straight cut. */
const createBorderLimit = (grid: GridSize, seed: number, layout: LandformLayout) => {
  const noise = createSimplexNoise(deriveSeed(seed, "border-coast"));
  const offsets = (length: number, side: number) => Float32Array.from({ length: length + 1 }, (_, along) =>
    Math.max(0, Math.min(6, 3 + noise(along / 28, side * 7.3) * 2.3 +
      noise(along / 11, side * 9.7 + 13) * .7)));
  const west = offsets(grid.cellsZ, 1), east = offsets(grid.cellsZ, 2);
  const north = offsets(grid.cellsX, 3), south = offsets(grid.cellsX, 4);
  return (x: number, z: number) => {
    // Keep a peninsula's existing open mainland strip intact at its two corners.
    const openDistance = getOpenBorderDistance(grid, layout, x, z);
    const detail = smoothstep(0, 16, openDistance);
    const x0 = layout.openSide === "x0" ? Infinity : x - west[z]! * detail;
    const z0 = layout.openSide === "z0" ? Infinity : z - north[x]! * detail;
    const distance = Math.min(x0, grid.cellsX - x - east[z]! * detail, z0, grid.cellsZ - z - south[x]! * detail);
    return toReferenceUnits(distance) * 5 - .25;
  };
};

/** Along the open border the land is guaranteed (a mainland strip about 26 cells deep). */
const getOpenBorderLand = (layout: LandformLayout, x: number, z: number) => {
  if (!layout.openSide) return -Infinity;
  return 1 - toReferenceUnits(layout.openSide === "x0" ? x : z) * 2.5;
};

/**
 * Domain warped landform (island, archipelago or peninsula, sized with the map) plus coast
 * detail fBm in cells (the same cove size on every map), cut to sea at the closed borders.
 */
const createContinentalness = (grid: GridSize, seed: number, layout: LandformLayout) => {
  const warpX = createFbm(deriveSeed(seed, "warp-x"), { octaves: 3 });
  const warpZ = createFbm(deriveSeed(seed, "warp-z"), { octaves: 3 });
  const shape = createFbm(deriveSeed(seed, "shape"), { octaves: 4 });
  const scale = getLinearScale(grid);
  const borderLimit = createBorderLimit(grid, seed, layout);
  return (vertexX: number, vertexZ: number, { pu, pv, u, v }: MapPoint) => {
    const wu = u + warpX(u * 1.4, v * 1.4) * 0.22;
    const wv = v + warpZ(u * 1.4, v * 1.4) * 0.22;
    const land = layout.shape(wu, wv) * scale + shape(pu * 2.2, pv * 2.2) * 0.32;
    const open = Math.max(land, getOpenBorderLand(layout, vertexX, vertexZ));
    return Math.min(open, borderLimit(vertexX, vertexZ));
  };
};

/**
 * Mountain mask threshold shift per unit of the mountain amount below and above the tuned
 * default 1 (smaller above, so "Many" keeps building land).
 */
const MOUNTAIN_MASK_SHIFT = { fewer: 0.2, more: 0.1 } as const;

const getMountainMaskShift = (amount: number) =>
  (amount - 1) * (amount > 1 ? MOUNTAIN_MASK_SHIFT.more : MOUNTAIN_MASK_SHIFT.fewer);

/** Lowest mountain mask on planned upland islands (island-uplands.ts): every roomy island may host a massif. */
const UPLAND_MASK_FLOOR = 0.5;

/** Mountain mask of planned upland islands: the noise mask, or the floor wherever the land has room. */
const getUplandMask = (noiseMask: number, inland: number, land: number) =>
  Math.max(noiseMask * inland, UPLAND_MASK_FLOOR * smoothstep(0.05, 0.2, land));

/**
 * Noise fields of the landform; planned upland islands (island-uplands.ts) replace the landform's
 * continentalness and keep a mountain mask floor on it.
 */
export const createShapeFields = (
  grid: GridSize,
  seed: number,
  layout: LandformLayout,
  mountainAmount: number,
  uplands?: IslandUplandShape
): ShapeFields => {
  const count = getVertexCount(grid);
  const continentalness = new Float32Array(count);
  const mountainMask = new Float32Array(count);
  const cliffMask = new Float32Array(count);
  const shape = createContinentalness(grid, seed, layout);
  const mountains = createFbm(deriveSeed(seed, "mountains"), { octaves: 3 });
  const cliffs = createFbm(deriveSeed(seed, "cliffs"), { octaves: 3 });
  const maskShift = getMountainMaskShift(mountainAmount);
  let index = 0;
  for (let vertexZ = 0; vertexZ <= grid.cellsZ; vertexZ += 1) {
    for (let vertexX = 0; vertexX <= grid.cellsX; vertexX += 1) {
      const point = toMapPoint(grid, vertexX, vertexZ);
      const { pu, pv } = point;
      const land = uplands ? uplands.land(vertexX, vertexZ) : shape(vertexX, vertexZ, point);
      const inland = smoothstep(0.12, 0.42, land);
      continentalness[index] = land;
      const mountainNoise = mountains(pu * 1.3 + 3.1, pv * 1.3 - 1.3) + maskShift;
      const noiseMask = smoothstep(-0.05, 0.35, mountainNoise);
      mountainMask[index] = uplands ? getUplandMask(noiseMask, inland, land) : noiseMask * inland;
      cliffMask[index] =
        smoothstep(0.05, 0.25, cliffs(pu * 2.4 - 5, pv * 2.4 + 2)) * smoothstep(0.04, 0.2, land);
      index += 1;
    }
  }
  return { cliffMask, continentalness, minimumMassifs: uplands?.minimumMassifs, mountainMask };
};

const getLandShare = (continentalness: Float32Array) =>
  continentalness.reduce((land, value) => (value > 0 ? land + 1 : land), 0) /
  continentalness.length;

/** Mountains fade out towards every border, so no mass is cut by the map edge. */
const MOUNTAIN_BORDER_FADE = 14;

const getMountainBorderFade = (grid: GridSize, vertexX: number, vertexZ: number) => {
  const { x0, x1, z0, z1 } = getBorderDistances(grid, vertexX, vertexZ);
  return smoothstep(0, MOUNTAIN_BORDER_FADE, Math.min(x0, x1, z0, z1));
};

/** Height range over which a massif's foot blends into the hills: a concave toe, not a seam. */
const MOUNTAIN_FOOT_BLEND = 2.5;

/**
 * Cells behind the waterline over which the rounded foot of the smooth maximum (up to
 * MOUNTAIN_FOOT_BLEND / 4 above the lowland) fades in, see beaches.ts.
 */
const BEACH_RISE_CELLS = 5;

/**
 * Share of the land height above the sea that stays once the rounded foot fades out towards the
 * coast (1 inland): lowerBeaches applies it after erosion, so the inland terrain is unchanged.
 */
const getBeachScale = (rounded: number, sharp: number, seaDistance: number) => {
  const inland = smoothstep(0, BEACH_RISE_CELLS, seaDistance);
  return rounded > 0 ? (sharp + (rounded - sharp) * inland) / rounded : 1;
};

/** Land value below which the ground counts as coast for the mountain room. */
const COAST_LAND = 0.02;

/**
 * Room for a mountain per vertex: cells to the coast or (less the border fade) to the map border.
 * Mountains rise at most a fixed slope over it, so they never end in a wall at the shore.
 */
const createMountainRoom = (grid: GridSize, continentalness: Float32Array) => {
  const room = computeDistanceField(grid, (index) => continentalness[index]! <= COAST_LAND);
  const stride = grid.cellsX + 1;
  return room.map((distance, index) => {
    const { x0, x1, z0, z1 } = getBorderDistances(grid, index % stride, Math.floor(index / stride));
    const border = Math.min(x0, x1, z0, z1) - MOUNTAIN_BORDER_FADE * 0.5;
    return Math.max(0, Math.min(distance, border));
  });
};

/**
 * Rolling hills on land, foothills in the mountain mask, structured massifs (ridgelines, spurs,
 * cirques; count and height scaled by the mountain amount: 0 leaves only hills) on top, capped
 * by the coast room; a sloping sea floor. `beachScale` is the gentle beach share per vertex
 * (beaches.ts).
 */
export const createBaseHeights = (
  grid: GridSize,
  seed: number,
  fields: ShapeFields,
  mountainAmount: number,
  mountainScale = 1,
  capture?: (features: GeneratedFeatureIdentity[]) => void
) => {
  const heights = new Float32Array(getVertexCount(grid));
  const beachScale = new Float32Array(heights.length).fill(1);
  const hills = createFbm(deriveSeed(seed, "hills"), { octaves: 5 });
  const landShare = getLandShare(fields.continentalness);
  const relief = { amount: mountainAmount, landShare, minimumCount: fields.minimumMassifs, scale: mountainScale };
  const room = createMountainRoom(grid, fields.continentalness);
  const seaDistance = computeDistanceField(grid, (index) => fields.continentalness[index]! <= 0);
  const mountains = createMountainHeights(grid, seed, fields.mountainMask, room, relief, capture);
  const foothillScale = Math.min(1, mountainAmount) * 1.2;
  let index = 0;
  for (let vertexZ = 0; vertexZ <= grid.cellsZ; vertexZ += 1) {
    for (let vertexX = 0; vertexX <= grid.cellsX; vertexX += 1) {
      const { pu, pv } = toMapPoint(grid, vertexX, vertexZ);
      const land = fields.continentalness[index]!;
      if (land <= 0) {
        heights[index] = Math.max(-4.5, land * 10 - 0.15);
      } else {
        const hilliness = (hills(pu * 5, pv * 5) * 0.5 + 0.5) * 1.6;
        const lowland = smoothstep(0, 0.5, land) * (0.7 + hilliness);
        const fade = getMountainBorderFade(grid, vertexX, vertexZ);
        const foothills = fields.mountainMask[index]! * foothillScale * fade;
        const mountain = mountains[index]! + lowland * 0.5;
        const rolling = lowland + foothills;
        const rounded = smoothMax(rolling, mountain, MOUNTAIN_FOOT_BLEND);
        heights[index] = rounded;
        beachScale[index] = getBeachScale(rounded, Math.max(rolling, mountain), seaDistance[index]!);
      }
      index += 1;
    }
  }
  return { beachScale, heights };
};

/** Sharp steps between flat terraces: plateau edges become cliffs along height contours. */
const terrace = (height: number) => {
  const level = height / HEIGHT_LEVEL_STEP;
  const floor = Math.floor(level);
  return (floor + smoothstep(0.46, 0.54, level - floor)) * HEIGHT_LEVEL_STEP;
};

/** 0..1 where the plateau edges become terraced cliffs (less inside the mountains). */
export const getTerraceMask = (fields: ShapeFields, index: number) =>
  fields.cliffMask[index]! * (1 - fields.mountainMask[index]! * 0.6);

export const applyTerraces = (heights: Float32Array, fields: ShapeFields) => {
  for (let index = 0; index < heights.length; index += 1) {
    const mask = getTerraceMask(fields, index);
    const height = heights[index]!;
    if (mask <= 0 || height <= 0.4) continue;
    heights[index] = height + (terrace(height) - height) * mask;
  }
};

/**
 * Cells over which the land falls almost to sea level at a peninsula's open border: the land's
 * last row meets the open sea frame (at sea level) without a visible wall, even seen from the
 * side in a rotated view; the renderer fades the map's last cells to black, beyond the
 * playable area (render-common/shaders/common-glsl.ts, MAP_EDGE_CELLS).
 */
export const OPEN_BORDER_BAND = 12;
const OPEN_BORDER_HEIGHT = 0.03;

/** Distance (cells) from a vertex to the landform's open border; Infinity without one. */
export const getOpenBorderDistance = (
  grid: GridSize,
  layout: LandformLayout,
  vertexX: number,
  vertexZ: number
) => {
  if (!layout.openSide) return Infinity;
  return getBorderDistances(grid, vertexX, vertexZ)[layout.openSide];
};

/** Lowers the land towards OPEN_BORDER_HEIGHT within OPEN_BORDER_BAND of the open border. */
export const lowerOpenBorder = (grid: GridSize, heights: Float32Array, layout: LandformLayout) => {
  if (!layout.openSide) return;
  const stride = grid.cellsX + 1;
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]!;
    if (height <= OPEN_BORDER_HEIGHT) continue;
    const distance = getOpenBorderDistance(
      grid,
      layout,
      index % stride,
      Math.floor(index / stride)
    );
    const keep = smoothstep(0, OPEN_BORDER_BAND, distance);
    heights[index] = OPEN_BORDER_HEIGHT + (height - OPEN_BORDER_HEIGHT) * keep;
  }
};

/** Discrete gameplay height level of one vertex (0 at and below sea level). */
export const getHeightLevel = (height: number) =>
  Math.max(0, Math.floor((height + 0.5) / HEIGHT_LEVEL_STEP));

/** Discrete gameplay height level per vertex (0 at and below sea level). */
export const createHeightLevels = (heights: Float32Array) =>
  Uint8Array.from(heights, getHeightLevel);
