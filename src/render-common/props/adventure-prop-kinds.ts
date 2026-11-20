import { PROP_TYPE_COUNT } from "../../shared/world/world-data";

/** Append-only render kinds: saved world prop bytes and every existing mesh id stay unchanged. */
export const ADVENTURE_PROP = {
  cactus: PROP_TYPE_COUNT + 13,
  sparseOak: PROP_TYPE_COUNT + 14,
  sparseBirch: PROP_TYPE_COUNT + 15
} as const;
export const ADVENTURE_PROP_CACHE_VERSION = "tier-timber-vegetation-v7-junction-foliage";
export const isAdventurePropKind = (kind: number) => kind === ADVENTURE_PROP.cactus ||
  kind === ADVENTURE_PROP.sparseOak || kind === ADVENTURE_PROP.sparseBirch;
