import type { FishTuning } from "@shared/catalog";
import { entriesOfKind } from "@shared/catalog";
import { FISH_TUNING } from "@shared/catalog/tuning/fish";

/** Tail outline and side marking kinds (catalog fish tuning types). */
export type { FishMarking, FishTail } from "@shared/catalog";

/**
 * One decorative reef or schooling fish (original, invented looks after common shallow-water fish): the catalog
 * model and motion tuning (`tuning/models/fish.json`) and its lower-case English name.
 */
export interface FishSpecies extends FishTuning {
  name: string;
}

/**
 * Every species; the index is the catalog code (`fish:*`), the name its lower-case English name. Loaded
 * synchronously with the fish module graph (renderer), never with the core catalog.
 */
export const FISH_SPECIES: readonly FishSpecies[] = entriesOfKind("fish")
  .map(({ key, text }) => ({ ...FISH_TUNING[key]!, name: text.name.en.toLowerCase() }));

/** How often each species is picked for a home (the catalog's `life.weight`, same order as FISH_SPECIES). */
export const FISH_SPECIES_WEIGHTS: readonly number[] = entriesOfKind("fish").map(entry => entry.life.weight!);

/** Largest group of any species (pool slots per school). */
export const MAX_SCHOOL = Math.max(...FISH_SPECIES.map((species) => species.school[1]));
