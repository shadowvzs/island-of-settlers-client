import type { Waterfall } from "../world-data";
import { type AuthoredRiver, isAuthoredRiverList, type RiverPoint } from "./authored-rivers";
import { validateRiverSuppressionBudget,validRiverSuppression } from "./river-water-suppression";

/** Most generated rivers a map records as editable sources (all-or-none capture). */
export const GENERATED_RIVER_LIMIT = 16;

/** Sparse native provenance or explicit measured adoption; never historical seed reconstruction. */
export interface GeneratedRiver {
  version: 1;
  /** Explicit baked-channel adoption preserves the existing bed as its removable baseline. */
  adopted?: true;
  bedDepthSamples?: number[];
  id: number;
  points: RiverPoint[];
  mouthStep: number;
  widthSamples: number[];
  radius: number[];
  profile: number[];
  gorge: number[];
  widthScale: number;
  depthScale: number;
  patches: AuthoredRiver["patches"];
  falls: Waterfall[];
  /** Fixed map-space erasures, retained when endpoints change. */
  suppressedVertices?: number[];
}

export const generatedRiverPatchLimit = (vertices: number) => Math.min(vertices * 2, 131072);

export const isGeneratedRiverList = (value: unknown, cellsX: number, cellsZ: number): value is GeneratedRiver[] => {
  if (!Array.isArray(value) || value.length > GENERATED_RIVER_LIMIT) return false;
  let patches = 0;
  const ids = new Set<number>();
  for (const river of value) {
    if (!river || river.version !== 1 || ids.has(river.id) ||
      !isAuthoredRiverList([{ ...river, width: 2, depth: .7 }], cellsX, cellsZ) ||
      !Number.isSafeInteger(river.mouthStep) || river.mouthStep < 1 ||
      river.mouthStep >= river.points.length ||
      ![river.widthScale, river.depthScale].every(scale => Number.isFinite(scale) && scale >= .25 && scale <= 4))
      return false;
    if (!validRiverSuppression(river.suppressedVertices, (cellsX + 1) * (cellsZ + 1))) return false;
    if (river.adopted !== undefined && river.adopted !== true) return false;
    if (river.adopted && (!Array.isArray(river.bedDepthSamples) ||
      river.bedDepthSamples.length !== river.points.length ||
      river.bedDepthSamples.some((depth: number) => !Number.isFinite(depth) || depth < 0 || depth > 64))) return false;
    if (!river.adopted && river.bedDepthSamples !== undefined) return false;
    ids.add(river.id); patches += river.patches.length;
    if (patches > generatedRiverPatchLimit((cellsX + 1) * (cellsZ + 1))) return false;
    for (const key of ["widthSamples", "radius", "profile", "gorge"] as const) {
      const samples = river[key];
      if (!Array.isArray(samples) || samples.length !== river.points.length ||
        samples.some((sample: number) => !Number.isFinite(sample) ||
          ((key === "widthSamples" || key === "radius") && sample <= 0) ||
          (key === "gorge" && (sample < 0 || sample > 1)))) return false;
    }
  }
  try { validateRiverSuppressionBudget(value, (cellsX + 1) * (cellsZ + 1)); } catch { return false; }
  return true;
};
