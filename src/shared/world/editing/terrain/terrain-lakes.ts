import type { GridSize } from "../../grid-geometry";
import { smoothstep } from "../../noise";
import {
  getLakeBed,
  getStampBounds,
  isLake,
  LAKE_SHORE,
  type TerrainStamp
} from "./terrain-stamps";

/** A lake's surface sits this far below the lowest point of its rim (world units). */
const FREEBOARD = 0.12;
/** A lake whose surface would lie this close to the sea (or below) is part of the sea. */
const SEA_MARGIN = 0.3;
/** Rim band (footprint ratio) the surface is measured on. */
const RIM = [1, 1.12] as const;
/** The bed eases into the original ground over this footprint ratio band (the shore). */
const SHORE_BLEND = [0.85, LAKE_SHORE] as const;

/** The ground and water before any stamp (the lakes measure their rims on it). */
export interface LakeBase {
  heights: Float32Array;
  waterSurface: Float32Array;
}

/** A lake with its water surface (sea: it lies at or below the sea, or touches it). */
export interface LakeInfo {
  sea: boolean;
  stamp: TerrainStamp;
  surface: number;
}

/**
 * The lake's surface: just below the lowest point of its rim on the original ground, so the
 * water never spills over; a lake touching the sea, or as low as the sea, becomes sea.
 */
export const measureLake = (
  grid: GridSize & { seaLevel: number },
  base: LakeBase,
  stamp: TerrainStamp
): LakeInfo => {
  const bounds = getStampBounds(stamp);
  let lowest = Infinity;
  let touchesSea = false;
  const maxX = Math.min(grid.cellsX, Math.ceil(bounds.maxX));
  const maxZ = Math.min(grid.cellsZ, Math.ceil(bounds.maxZ));
  for (let z = Math.max(0, Math.floor(bounds.minZ)); z <= maxZ; z += 1) {
    for (let x = Math.max(0, Math.floor(bounds.minX)); x <= maxX; x += 1) {
      const ratio = getLakeBed(stamp, x, z).ratio;
      if (ratio < RIM[0] || ratio >= RIM[1]) continue;
      const vertex = z * (grid.cellsX + 1) + x;
      lowest = Math.min(lowest, base.heights[vertex]!);
      touchesSea ||=
        base.heights[vertex]! < grid.seaLevel && base.waterSurface[vertex] === grid.seaLevel;
    }
  }
  const surface = lowest - FREEBOARD;
  const sea = touchesSea || surface < grid.seaLevel + SEA_MARGIN;
  return { sea, stamp, surface: sea ? grid.seaLevel : surface };
};

/** The lakes of the stamp list with their surfaces. */
export const measureLakes = (
  grid: GridSize & { seaLevel: number },
  base: LakeBase,
  stamps: readonly TerrainStamp[]
) => stamps.filter(isLake).map((stamp) => measureLake(grid, base, stamp));

/** What the lakes do to one vertex. */
export interface LakeShaping {
  /** Bank weight 0..1 of dry shore ground. */
  bank: number;
  height: number;
  /** A fresh lake covers the vertex (not the sea). */
  isLake: boolean;
  /** The vertex is within a lake's reach (its ground, water or bank may change). */
  reached: boolean;
  /** Water surface over the vertex (null: none of the lakes covers it). */
  surface: number | null;
}

/**
 * The lakes at a vertex: their beds lower the ground (the deepest wins, easing into the original
 * ground at the shore), the water fills them up to their surface.
 */
export const shapeLakes = (
  lakes: readonly LakeInfo[],
  x: number,
  z: number,
  height: number
): LakeShaping => {
  const shaping: LakeShaping = { bank: 0, height, isLake: false, reached: false, surface: null };
  for (const lake of lakes) {
    const bed = getLakeBed(lake.stamp, x, z);
    if (bed.ratio >= LAKE_SHORE) continue;
    shaping.reached = true;
    const blend = smoothstep(SHORE_BLEND[0], SHORE_BLEND[1], bed.ratio);
    const lowered = (lake.surface - bed.depth) * (1 - blend) + height * blend;
    shaping.height = Math.min(shaping.height, lowered);
    if (shaping.height < lake.surface && bed.ratio < 1.05) {
      shaping.surface = Math.max(shaping.surface ?? -Infinity, lake.surface);
      shaping.isLake ||= !lake.sea;
    } else {
      shaping.bank = Math.max(shaping.bank, 1 - smoothstep(1, LAKE_SHORE, bed.ratio));
    }
  }
  return shaping;
};
