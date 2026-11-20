/**
 * Building footprints, shared data (gameplay rules, generation guarantees, placement overlay).
 *
 * Scale: one cell is one world unit and a mature oak is about 3 units tall. Most buildings
 * (houses, most production) stand on a 2x2 base, about as wide as an oak is tall; storehouse,
 * headquarters and big production take 3x3; a rare tower fits on a single cell.
 *
 * - `size`: cells per side of the foundation (the base the building stands on).
 * - `maxRise`: highest height difference over the foundation corners, in world units. A base
 *   (plinth) absorbs a gentle slope: 0.35 for a tower, 0.25 per cell for a standard building,
 *   0.2 per cell for a large one, all within the gameplay "flat" limit of 0.35 rise per cell.
 * - `ACCESS_MARGIN`: a free strip on the door side (south and east, facing the default camera)
 *   for the door, the flag and the road; it may slope, but must be passable ground.
 */
export interface BuildingFootprint {
  /** Foundation ground: building land (default) or mine land (the gravel at the mountains). */
  ground?: "building" | "mine";
  maxRise: number;
  size: number;
  /** Rectangular plot overrides; legacy square plots continue to use size. */
  width?: number;
  depth?: number;
}

export const BUILDING_FOOTPRINTS = {
  tower: { maxRise: 0.35, size: 1 },
  standard: { maxRise: 0.5, size: 2 },
  large: { maxRise: 0.6, size: 3 }
} as const satisfies Record<string, BuildingFootprint>;

export const getFootprintDimensions = (footprint: BuildingFootprint) => ({
  width: footprint.width ?? footprint.size,
  depth: footprint.depth ?? footprint.size
});
export const getFootprintSpans = (footprint: BuildingFootprint) => {
  const { depth, width } = getFootprintDimensions(footprint);
  return { width: width + ACCESS_MARGIN, depth: depth + ACCESS_MARGIN };
};

export type FootprintKind = keyof typeof BUILDING_FOOTPRINTS;

/** Legacy generation estimate, not the production mine plot. Production uses a 5x4 plot
 * with any matching ore cell under its foundation. Changing only these dimensions would
 * require every foundation cell to be ore and can remove all deposits on small maps. */
export const MINE_FOOTPRINT: BuildingFootprint = { ground: "mine", maxRise: 1, size: 2 };

export const FOOTPRINT_KINDS = Object.keys(BUILDING_FOOTPRINTS) as FootprintKind[];

/** Cells of the door / flag / road strip on the south and east side of a foundation. */
const ACCESS_MARGIN = 1;

/**
 * Island wide guarantee: at least one footprint of the kind per this many land cells (packed
 * one size at a time), weighted to the building mix: most demand on standard plots, fewer
 * large ones, few towers (any free cell fits one). Standard is the planning size of the
 * settlement clearings.
 */
const LAND_CELLS_PER_FOOTPRINT: Record<FootprintKind, number> = {
  large: 150,
  standard: 40,
  tower: 60
};

/** Minimum free footprints of every kind the generated island must offer. */
export const getFootprintMinimums = (landCells: number) =>
  Object.fromEntries(
    FOOTPRINT_KINDS.map((kind) => [kind, Math.floor(landCells / LAND_CELLS_PER_FOOTPRINT[kind])])
  ) as Record<FootprintKind, number>;
