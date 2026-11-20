import type {
  BirdColorsTuning, BirdHabitatTuning, BirdShapeTuning, BirdTuning, BirdWingStation
} from "@shared/catalog";
import { entriesOfKind } from "@shared/catalog";
import { BIRD_TUNING } from "@shared/catalog/tuning/birds";

/** Where a species likes to fly: weights of the habitat channels (see bird-habitat.ts). */
export type HabitatPreference = BirdHabitatTuning;
/** One wing station from the shoulder (span 0) to the tip (span 1): chord as body x offsets. */
export type WingStation = BirdWingStation;
/** Vertex colours of a species: upper parts and lighter under parts. */
export type BirdColors = BirdColorsTuning;
/** The procedural silhouette of a species, in wingspan units (span 1 = tip to tip). */
export type BirdShape = BirdShapeTuning;
/** Model and flight tuning of a species (catalog sidecar `tuning/models/birds.json`). */
export type BirdSpecies = BirdTuning;

/**
 * Every species (meadow finch, scythe swift, ash rook, shore gull); the index is the catalog code (`bird:*`), the
 * species id in BirdFrame and the renderers. Loaded synchronously with the bird module graph (flyer atlas worker,
 * audio, renderer), never with the core catalog.
 */
export const BIRD_SPECIES: readonly BirdSpecies[] = entriesOfKind("bird").map(({ key }) => BIRD_TUNING[key]!);
