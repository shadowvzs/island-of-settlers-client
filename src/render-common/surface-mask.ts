import { computeCoastTypes } from "../shared/world/generation/coast-types";
import { computeDistanceField } from "../shared/world/generation/distance-field";
import { createTopographyFields } from "../shared/world/generation/topography-fields";
import { getVertexCount, getVertexSlope, type GridSize } from "../shared/world/grid-geometry";
import { clamp01, smoothstep } from "../shared/world/noise";
import type { WorldData } from "../shared/world/world-data";

/**
 * Surface mask (TT-2): four render-only context channels per world vertex, derived from the saved
 * layers on load (never saved, no simulation effect). The ground shader reads them through the
 * `surface` vertex attribute (bytes, 0..1 normalized):
 * - wetness: river bank and spray wetness in applyGroundWetness units (0.5 saturated, 1 film);
 *   sea shores are left to the shore bands of the water field (shore-wetness-glsl.ts);
 * - coast: coast type, 0 beach .. 1 cliff coast (coast-types.ts);
 * - talus: the scree band at the foot of cliffs;
 * - dry: sun-facing, wind-exposed and dry ground (heat load × exposure × (1 − moisture)).
 */
export const SURFACE_CHANNEL = { coast: 1, dry: 3, talus: 2, wetness: 0 } as const;

/** Channels per vertex (the u8×4 attribute). */
export const SURFACE_CHANNELS = 4;

/** Bank band from the river bed (cells): full wetness up to `near`, dry from `far` (+1 at rapids). */
const BANK = { far: 2, near: 0.75, rapidsReach: 1, rapidsWetness: 0.18, wetness: 0.42 } as const;
/** Flow speed of rapids (the water shader's river foam range, water-glsl.ts). */
const RAPIDS_SPEED = { from: 1.1, to: 2.2 } as const;
/** Spray wetness of `wetRock` 1 (falls, gorge splash): saturated with a thin film. */
const SPRAY_WETNESS = 0.65;
/** Vertex slope (rise per cell) of a cliff, and the talus band's slope window. */
const CLIFF_SLOPE = 1;
const TALUS_SLOPE = { flatFrom: 0.05, flatTo: 0.2, steepFrom: 0.6, steepTo: 0.9 } as const;
/** Talus reach from the cliff (cells) and the hollow it prefers (curvature, hollows positive). */
const TALUS_REACH = { full: 1, none: 3 } as const;
const TALUS_HOLLOW = { from: -0.05, to: 0.25 } as const;

/** Bank and spray wetness 0..1 (applyGroundWetness units) of a vertex near a river. */
export const getRiverWetness = (riverDistance: number, wetRock: number, rapids: number) => {
  const far = BANK.far + BANK.rapidsReach * rapids;
  const bank = (BANK.wetness + BANK.rapidsWetness * rapids) * (1 - smoothstep(BANK.near, far, riverDistance));
  return Math.max(bank, wetRock * SPRAY_WETNESS);
};

/** Scree share 0..1: near a cliff, on moderate slopes, in the hollow at its foot (not on its crest). */
export const getTalus = (cliffDistance: number, slope: number, curvature: number) => {
  const near = 1 - smoothstep(TALUS_REACH.full, TALUS_REACH.none, cliffDistance);
  if (near <= 0) return 0;
  const window = smoothstep(TALUS_SLOPE.flatFrom, TALUS_SLOPE.flatTo, slope) *
    (1 - smoothstep(TALUS_SLOPE.steepFrom, TALUS_SLOPE.steepTo, slope));
  return near * window * smoothstep(TALUS_HOLLOW.from, TALUS_HOLLOW.to, curvature);
};

/** Dryness 0..1: heat load (0..1) × exposure (−1..1 → 0..1) × (1 − moisture 0..1). */
export const getDryness = (heatLoad: number, exposure: number, moisture: number) =>
  clamp01(heatLoad * (0.5 + 0.5 * exposure) * (1 - moisture));

/** Rapids share 0..1 of the fastest flow at the vertex or its 8 neighbours (banks beside rapids). */
export const getNearbyRapids = (grid: GridSize, flow: Float32Array, vertexX: number, vertexZ: number) => {
  let fastest = 0;
  for (let z = Math.max(0, vertexZ - 1); z <= Math.min(grid.cellsZ, vertexZ + 1); z += 1) {
    for (let x = Math.max(0, vertexX - 1); x <= Math.min(grid.cellsX, vertexX + 1); x += 1) {
      const index = (z * (grid.cellsX + 1) + x) * 2;
      const flowX = flow[index]!, flowZ = flow[index + 1]!;
      fastest = Math.max(fastest, Math.sqrt(flowX * flowX + flowZ * flowZ));
    }
  }
  return smoothstep(RAPIDS_SPEED.from, RAPIDS_SPEED.to, fastest);
};

/** The layers the mask is derived from (a WorldData satisfies it). */
export type SurfaceMaskSource = GridSize & Pick<WorldData, "flow" | "heights" | "moisture" | "riverDistance" |
  "seaLevel" | "waterDepth" | "wetRock">;

const toByte = (value: number) => Math.round(clamp01(value) * 255);

/** Builds the mask of every world vertex: SURFACE_CHANNELS bytes per vertex. */
export const buildSurfaceMask = (source: SurfaceMaskSource) => {
  const { flow, heights, moisture, riverDistance, waterDepth, wetRock } = source;
  const count = getVertexCount(source), stride = source.cellsX + 1;
  const slopes = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    slopes[index] = getVertexSlope(source, heights, index % stride, Math.floor(index / stride));
  }
  const coast = computeCoastTypes(source, heights, source.seaLevel);
  const cliffDistance = computeDistanceField(source, index => slopes[index]! >= CLIFF_SLOPE);
  // Talus and dryness are land channels: the costly wind exposure skips the water.
  const { curvature, exposure, heatLoad } =
    createTopographyFields(source, heights, index => waterDepth[index]! <= 0);
  const mask = new Uint8Array(count * SURFACE_CHANNELS);
  for (let index = 0; index < count; index += 1) {
    const offset = index * SURFACE_CHANNELS;
    const rapids = riverDistance[index]! < BANK.far ?
      getNearbyRapids(source, flow, index % stride, Math.floor(index / stride)) : 0;
    mask[offset + SURFACE_CHANNEL.wetness] =
      toByte(getRiverWetness(riverDistance[index]!, wetRock[index]! / 255, rapids));
    mask[offset + SURFACE_CHANNEL.coast] = toByte(coast[index]!);
    if (waterDepth[index]! > 0) continue;
    mask[offset + SURFACE_CHANNEL.talus] =
      toByte(getTalus(cliffDistance[index]!, slopes[index]!, curvature[index]!));
    mask[offset + SURFACE_CHANNEL.dry] =
      toByte(getDryness(heatLoad[index]!, exposure[index]!, moisture[index]! / 255));
  }
  return mask;
};

const cache = new WeakMap<WorldData, { mask: Uint8Array; revision: number }>();

/**
 * The world's surface mask, cached per world and rebuilt after a height or water edit
 * (`terrainRevision`). `preview` (the map editor's instant look at new heights) keeps a stale mask,
 * like the rock contact band; the region rebuild brings the fresh one.
 */
export const getSurfaceMask = (world: WorldData, preview = false) => {
  const revision = world.terrainRevision ?? 0;
  const cached = cache.get(world);
  if (cached && (cached.revision === revision || preview)) return cached.mask;
  const mask = buildSurfaceMask(world);
  cache.set(world, { mask, revision });
  return mask;
};
