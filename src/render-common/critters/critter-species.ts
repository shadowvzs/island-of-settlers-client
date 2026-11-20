import { entriesOfKind } from "@shared/catalog";

/**
 * Decorative animals (visual life only: never blocking, never gameplay). `food` marks the ones
 * workers will hunt or fish later: they are always shown; every other critter follows the
 * "Critters" setting. A new species is a catalog entry (`critters.json`) plus its CRITTER byte.
 */
export interface CritterSpecies {
  /**
   * Personal radius on the ground (cells) for collision with animals, workers and each other;
   * 0: no collision (birds, fish, squirrels in the trees, small life).
   */
  bodyRadius: number;
  food: boolean;
  name: string;
  /** Casts a sun shadow. */
  shadow: boolean;
  /** Drawn size relative to the model (readability from the RTS camera). */
  size: number;
  /** Instance size variation around 1. */
  sizeJitter: number;
}

export const CRITTER = {
  mallardDrake: 0,
  mallardHen: 1,
  duckling: 2,
  heron: 3,
  gull: 4,
  trout: 5,
  mackerel: 6,
  fox: 7,
  boar: 8,
  piglet: 9,
  wolf: 10,
  bear: 11,
  squirrel: 12,
  chamois: 13,
  chamoisKid: 14,
  marmot: 15,
  burrow: 16,
  eagle: 17,
  hedgehog: 18,
  frog: 19,
  crab: 20,
  seal: 21,
  dragonfly: 22
} as const;
export type CritterId = (typeof CRITTER)[keyof typeof CRITTER];

/**
 * Every species; the index is the species id (CRITTER) in frames and renderers. A view over the catalog's
 * `critter:*` entries: tuning from `life`, `food` from the tag, the lower-case English name.
 */
export const CRITTER_SPECIES: readonly CritterSpecies[] = entriesOfKind("critter").map(({ life, tags, text }) => ({
  bodyRadius: life.bodyRadius!, food: tags.includes("food"), name: text.name.en.toLowerCase(), shadow: life.shadow!,
  size: life.size!, sizeJitter: life.sizeJitter!
}));

/** Per-critter brightness variation set at spawn: BASE + random * RANGE (about 0.92 .. 1.08). */
export const CRITTER_SHADE = { base: 0.92, range: 0.16 } as const;

/**
 * Critters asleep through the cosmetic winter: alpine marmots hibernate in their burrows and are
 * not drawn (the burrows stay; bears stay visible, owner 2026-11-07). `hibernation` is the share
 * asleep (0 summer .. 1 deep winter, seasons-6): each critter's fixed spawn shade orders who
 * retreats first, so they thin gradually and deterministically without flicker. Drawing only:
 * the critter manager keeps spawning and stepping them, so its random stream, the other critters
 * and the workers' obstacles are the same in every season.
 */
const HIBERNATING = new Set<number>([CRITTER.marmot]);

/** Stable 0..1 order of a critter's retreat, scrambled from its spawn shade. */
const getSleepOrder = (shade: number) => {
  const order = ((shade - CRITTER_SHADE.base) / CRITTER_SHADE.range) * 7.31;
  return order - Math.floor(order);
};

export const isHibernating = (species: number, hibernation: number, shade: number) =>
  hibernation > 0 && HIBERNATING.has(species) && getSleepOrder(shade) < hibernation;
