/**
 * Tile vocabulary of the offline road-verge foliage atlas (card V-R02a, temperate trample band).
 * Grid, channel and card contract: `plants/foliage-atlas-layout.ts`. Rows 0-2 are the High parts,
 * tiles 13-15 the whole-plant Minimal cards.
 */
export const VERGE_FOLIAGE_TILES = [
  "plantain-leaf",
  "plantain-spike",
  "dandelion-leaf",
  "dandelion-head",
  "flower-stalk",
  "clover-leaf",
  "clover-flower",
  "grass-blades",
  "grass-seedhead",
  "daisy-head",
  "daisy-leaf",
  "yarrow-leaf",
  "yarrow-umbel",
  "plantain-rosette",
  "dandelion-rosette",
  "daisy-clump"
] as const;

export type VergeFoliageTileId = typeof VERGE_FOLIAGE_TILES[number];
