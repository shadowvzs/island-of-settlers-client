import { PROP, PROP_TYPE_COUNT } from "../../shared/world/world-data";
import { ADVENTURE_PROP } from "./adventure-prop-kinds";
import { getTreeSpecies, getTreeVariants } from "./island-trees";
import { LILY_VARIANT_COUNT } from "./plants/water-lily";
import { OPEN_SHELL_VARIANT_COUNT } from "./shells/open-shells";
import { SEA_SNAIL_VARIANT_COUNT } from "./shells/spiral-shells";

/** Field cover: render only kinds after the world props (meadow detail, not gameplay objects). */
export const COVER = {
  clover: PROP_TYPE_COUNT + 4,
  dryTuft: PROP_TYPE_COUNT + 2,
  fieldWeed: PROP_TYPE_COUNT + 5,
  /** Shade grass under the temperate canopy (append-only after the shell kinds). */
  forestGrass: PROP_TYPE_COUNT + 20,
  /** Broad, lush grass of wet tropical ground and canopy edges. */
  jungleGrass: PROP_TYPE_COUNT + 19,
  /** Open cockles on beaches, both valves joined at the hinge (append-only). */
  openShell: PROP_TYPE_COUNT + 17,
  pinkFlower: PROP_TYPE_COUNT + 8,
  /** Golden, tall dry grass of open savanna and desert ground. */
  savannaGrass: PROP_TYPE_COUNT + 18,
  /** Whelk / conch shells on beaches (append-only after the adventure kinds). */
  seaSnailShell: PROP_TYPE_COUNT + 16,
  seaStar: PROP_TYPE_COUNT + 12,
  seashell: PROP_TYPE_COUNT + 10,
  seedGrass: PROP_TYPE_COUNT + 3,
  shortGrass: PROP_TYPE_COUNT,
  snailShell: PROP_TYPE_COUNT + 11,
  tallGrass: PROP_TYPE_COUNT + 1,
  thistle: PROP_TYPE_COUNT + 9,
  whiteFlower: PROP_TYPE_COUNT + 7,
  yellowFlower: PROP_TYPE_COUNT + 6
} as const;

export const GRASS_KIND = COVER.shortGrass;
export const PROP_KIND_COUNT = PROP_TYPE_COUNT + 21;

/** Variants of a prop kind without its own table (stable random pick per instance). */
const DEFAULT_VARIANTS = 3;

/** Kinds with their own variant count (besides the trees). */
const VARIANT_COUNTS: Partial<Record<number, number>> = { [PROP.waterLily]: LILY_VARIANT_COUNT,
  [ADVENTURE_PROP.sparseOak]: getTreeVariants(PROP.broadleafTree).length,
  [ADVENTURE_PROP.sparseBirch]: getTreeVariants(PROP.birchTree).length,
  [COVER.forestGrass]: 8,
  [COVER.jungleGrass]: 8,
  [COVER.openShell]: OPEN_SHELL_VARIANT_COUNT,
  [COVER.savannaGrass]: 8,
  [COVER.seaSnailShell]: SEA_SNAIL_VARIANT_COUNT };

/**
 * Mesh variants per kind: tree kinds list theirs (age x structural form), a few kinds have their
 * own count, the others three.
 */
export const getVariantCount = (kind: number) => {
  if (getTreeSpecies(kind) !== undefined) return getTreeVariants(kind).length;
  return VARIANT_COUNTS[kind] ?? DEFAULT_VARIANTS;
};

/** First mesh id of every kind (mesh ids are dense: kind after kind, variant after variant). */
const MESH_OFFSETS = Array.from({ length: PROP_KIND_COUNT + 1 }, () => 0);
for (let kind = 0; kind < PROP_KIND_COUNT; kind += 1)
  MESH_OFFSETS[kind + 1] = MESH_OFFSETS[kind]! + getVariantCount(kind);

export const PROP_MESH_COUNT = MESH_OFFSETS[PROP_KIND_COUNT]!;

/** Kind of every mesh id. */
const MESH_KINDS = Uint8Array.from({ length: PROP_MESH_COUNT }, (_, meshId) => {
  let kind = 0;
  while (MESH_OFFSETS[kind + 1]! <= meshId) kind += 1;
  return kind;
});

export const getMeshId = (kind: number, variant: number) => MESH_OFFSETS[kind]! + variant;

export const getMeshKind = (meshId: number) => MESH_KINDS[meshId]!;

export const getMeshVariant = (meshId: number) => meshId - MESH_OFFSETS[MESH_KINDS[meshId]!]!;

