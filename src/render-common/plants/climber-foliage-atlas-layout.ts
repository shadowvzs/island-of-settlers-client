import type { FoliageAtlasTile } from "./foliage-atlas-layout";

/** Tile vocabulary of the offline climber foliage atlas (card D04a); grid contract in foliage-atlas-layout. */
export const CLIMBER_FOLIAGE_TILES = [
  "rose-compound-leaf-5",
  "rose-compound-leaf-7",
  "rose-leaflet",
  "rose-petal-outer",
  "rose-petal-inner",
  "rose-bud",
  "rose-calyx",
  "rose-open-head",
  "ivy-juvenile-3-lobed",
  "ivy-juvenile-5-lobed",
  "ivy-adult-cordate",
  "ivy-cluster-4",
  "ivy-cluster-7",
  "rose-leaf-spray",
  "rose-bloom-cluster",
  "reserved"
] as const;

export type ClimberFoliageTileId = typeof CLIMBER_FOLIAGE_TILES[number];
export type ClimberFoliageTile = FoliageAtlasTile<ClimberFoliageTileId>;
