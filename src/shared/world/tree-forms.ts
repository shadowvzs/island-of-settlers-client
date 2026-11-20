/**
 * Structural tree forms stored in PropSet.form (one byte per prop): the archetype of a species
 * (low nibble) and the forest competition form (high nibble). Gameplay only sees the PROP kind;
 * the form picks the tree's architecture (renderers: island-trees.ts).
 */

/** Conifer archetypes (PROP.coniferTree). */
export const CONIFER = {
  spruce: 1,
  mountain: 2,
  lodgepole: 3
} as const;

/** Birch structures (PROP.birchTree), BIRCH_BRIEF.md variants A-E. */
export const BIRCH = {
  young: 0,
  multiStem: 1,
  classic: 2,
  weeping: 3,
  old: 4
} as const;

/** Palm variants (PROP.palmTree), PALM_BRIEF.md variants 1-6. */
export const PALM = {
  coconut: 0,
  date: 1,
  fan: 2,
  pygmyDate: 3,
  ground: 4,
  leaning: 5
} as const;

/** Broadleaf forms (PROP.broadleafTree): the oak, or a blossoming cherry near Japanese towns. */
export const BROADLEAF = {
  oak: 0,
  cherry: 1
} as const;
/** Original source model identities stay stable for old hardwood and mahogany saves. */
export const HARDWOOD_SOURCE = { variant1: 0, variant2: 1, variant3: 2, variant4: 3 } as const;
/** Birch architecture is an additional hardwood appearance, never a different resource kind. */
export const HARDWOOD = { ...HARDWOOD_SOURCE, birchYoung: 4, birchMultiStem: 5,
  birchClassic: 6, birchWeeping: 7, birchOld: 8 } as const;
export const hardwoodBirchForm = (form: number): number | undefined => {
  const archetype = form & 15;
  return archetype >= HARDWOOD.birchYoung && archetype <= HARDWOOD.birchOld ? archetype - 4 : undefined;
};

/** Shape from the local forest density: open-grown, forest interior or forest edge. */
export const COMPETITION = { open: 0, interior: 1, edge: 2 } as const;

export const encodeTreeForm = (archetype: number, competition: number) =>
  (archetype & 0x0f) | ((competition & 0x0f) << 4);

export const getFormArchetype = (form: number) => form & 0x0f;

export const getFormCompetition = (form: number) => (form >> 4) & 0x0f;
