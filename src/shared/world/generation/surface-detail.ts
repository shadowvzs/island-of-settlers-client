import type { GridSize } from "../grid-geometry";
import { createFbm, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import type { ShapeFields } from "./heights";
import { toReferenceUnits } from "./world-scale";

/**
 * Gentle ground relief: broad, low swells plus a little fine texture. Both stay well below the
 * 0.35 height rise that separates flat cells from gentle ones, so an otherwise flat field keeps
 * its build class; combined with existing hills it may only turn into walkable gentle ground.
 */
const DETAIL = {
  broadAmplitude: 0.28,
  broadFrequency: 4,
  fineAmplitude: 0.07,
  fineFrequency: 12
} as const;

/**
 * Adds deterministic micro-relief to dry lowland. The coast, the sea and the mountain massifs are
 * left alone: fades keep the shoreline and the rock silhouettes readable, and the settlement
 * plateaus are flattened after this pass, so their build sites stay exactly level.
 */
export const applySurfaceDetail = (
  grid: GridSize,
  heights: Float32Array,
  fields: ShapeFields,
  seed: number
) => {
  const broad = createFbm(deriveSeed(seed, "surface-detail"), { gain: 0.45, octaves: 2 });
  const fine = createFbm(deriveSeed(seed, "surface-detail-fine"), { gain: 0.45, octaves: 2 });
  let index = 0;
  for (let vertexZ = 0; vertexZ <= grid.cellsZ; vertexZ += 1) {
    for (let vertexX = 0; vertexX <= grid.cellsX; vertexX += 1) {
      const land = fields.continentalness[index]!;
      if (land > 0.02 && heights[index]! > 0.3) {
        const coastFade = smoothstep(0.02, 0.16, land);
        const mountainFade = 1 - smoothstep(0.15, 0.55, fields.mountainMask[index]!);
        const amount = coastFade * mountainFade;
        if (amount > 0) {
          const pu = toReferenceUnits(vertexX) - 1;
          const pv = toReferenceUnits(vertexZ) - 1;
          const detail = broad(pu * DETAIL.broadFrequency, pv * DETAIL.broadFrequency) * DETAIL.broadAmplitude +
            fine(pu * DETAIL.fineFrequency, pv * DETAIL.fineFrequency) * DETAIL.fineAmplitude;
          heights[index] = heights[index]! + detail * amount;
        }
      }
      index += 1;
    }
  }
};
