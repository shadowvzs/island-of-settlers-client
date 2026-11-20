import type { TuningProfile, WhaleFinTuning, WhaleTuning } from "@shared/catalog";
import { entriesOfKind } from "@shared/catalog";
import { WHALE_TUNING } from "@shared/catalog/tuning/whales";

/**
 * The two decorative whales of the deep sea: a humpback-like baleen whale and an orca. Shapes
 * are in body lengths (the nose at x +0.5, the fluke notch near x -0.5, up +y, left +z); the
 * renderer scales them by `length` (world units; a sailing ship's hull is 8.8).
 */
export const WHALE_SPECIES = { humpback: 0, orca: 1 } as const;
export type WhaleSpecies = (typeof WHALE_SPECIES)[keyof typeof WHALE_SPECIES];
/** Species keys by WHALE_SPECIES index (the catalog's `whale:*` keys). */
export const WHALE_SPECIES_NAMES: readonly string[] = entriesOfKind("whale").map(entry => entry.key);

/** Control points (position 0..1, value) of a smooth profile. */
export type Profile = TuningProfile;
/** A fin lofted from root to tip (catalog `WhaleFinTuning`). */
export type FinShape = WhaleFinTuning;
/** A whale shape in body lengths (catalog `WhaleTuning`). */
export type WhaleShape = WhaleTuning;

/**
 * Shapes by WHALE_SPECIES index from the catalog sidecar `tuning/models/whales.json`; loaded synchronously with
 * the whale module graph (renderer), never with the core catalog.
 */
export const WHALE_SHAPES: readonly WhaleShape[] = WHALE_SPECIES_NAMES.map(name => WHALE_TUNING[name]!);

/** Smooth (Catmull-Rom) value of a profile at `at`, clamped to its ends. */
export const sampleProfile = (profile: Profile, at: number) => {
  const last = profile.length - 1;
  if (at <= profile[0]![0]) return profile[0]![1];
  if (at >= profile[last]![0]) return profile[last]![1];
  let index = 0;
  while (index < last - 1 && at > profile[index + 1]![0]) index += 1;
  const [x1, y1] = profile[index]!;
  const [x2, y2] = profile[index + 1]!;
  const y0 = profile[Math.max(0, index - 1)]![1];
  const y3 = profile[Math.min(last, index + 2)]![1];
  const t = (at - x1) / (x2 - x1);
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * y1 + (y2 - y0) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2
    + (3 * y1 - y0 - 3 * y2 + y3) * t3);
};
