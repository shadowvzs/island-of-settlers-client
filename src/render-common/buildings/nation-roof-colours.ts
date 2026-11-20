import type { WorkerNation } from "../workers/worker-unit";
import type { BuildingSurface } from "./building-recipe";

type RoofColour = readonly [number, number, number];

/**
 * Retained production fallback palette (sRGB 0…255). The November 1 owner direction supersedes
 * the former one-colour policy with controlled nation/function form + material families.
 * roof-review-prototype.ts holds opt-in candidates; production retains these accepted base
 * materials until side-by-side owner approval. HQ, Monument, existing military and mill art stay fixed.
 * The painter may still add natural tile-to-tile variation to each base material.
 */
export const NATION_ROOF_COLOURS: Readonly<Record<WorkerNation, RoofColour>> = {
  chinese: [32, 45, 73],
  persian: [185, 164, 130],
  maya: [153, 126, 76],
  indigenous: [190, 164, 119],
  // Dark blue-grey fired kawara.
  japanese: [66, 76, 92],
  // Sun-baked ochre clay terraces and domes.
  nubian: [178, 128, 76],
  // Terracotta tegulae and imbrices.
  roman: [152, 54, 40],
  // Dark weathered split-wood shingles, turf brown.
  viking: [112, 94, 74]
};

/**
 * Roof surfaces that only select a roof geometry (flat tile courses on the rural Roman roofs,
 * the yagura skirts): they draw with the nation's own roof material, so they share its colour.
 */
export const ROOF_GEOMETRY_SURFACES: readonly BuildingSurface[] = ["roof-shingles", "roof-slate"];
