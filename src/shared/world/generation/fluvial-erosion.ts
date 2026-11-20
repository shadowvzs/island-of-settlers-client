import type { GridSize } from "../grid-geometry";
import { clamp01, smoothstep } from "../noise";
import type { ShapeFields } from "./heights";
import { carveStreamPower } from "./stream-power";

/** Lowland base of the designed relief (heights.ts: 0.7 plus the hills); the carving fades out below it. */
const PLAIN_HEIGHT = 0.7;
/**
 * Pilot settings (M03): four relaxations, half of the routed sediment settles per cell of area,
 * two blur passes spread each channel into a valley about five cells wide.
 */
const PILOT = { deposition: 0.5, iterations: 4, widening: 2 } as const;
/** Massifs carry the full carving, high hills a reduced one. */
const MASSIF_MASK = { from: 0.1, to: 0.5 } as const;
const HILL_MASK = { from: 1, share: 0.4, to: 2 } as const;
/** The mask reaches full strength this far above the lowland base: coasts and the plain stay exact. */
const PLAIN_FADE = 0.6;

/** 0..1 where the fluvial carving applies: massifs and high hills, nothing at or below the lowland base. */
export const createFluvialMask = (heights: Float32Array, mountainMask: Float32Array) => {
  const mask = new Float32Array(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]!;
    const relief = smoothstep(MASSIF_MASK.from, MASSIF_MASK.to, mountainMask[index]!) +
      HILL_MASK.share * smoothstep(HILL_MASK.from, HILL_MASK.to, height);
    mask[index] = clamp01(relief) * smoothstep(PLAIN_HEIGHT, PLAIN_HEIGHT + PLAIN_FADE, height);
  }
  return mask;
};

/** Carves stream-power valleys into the designed relief in place (`strength` 0..1, the generator option). */
export const applyFluvialErosion = (grid: GridSize, heights: Float32Array, fields: ShapeFields, strength: number) => {
  const mask = createFluvialMask(heights, fields.mountainMask);
  const carved = carveStreamPower(grid, heights, { ...PILOT, mask, plainHeight: PLAIN_HEIGHT, strength });
  heights.set(carved);
};
