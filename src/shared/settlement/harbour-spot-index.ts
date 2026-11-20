import type { HarbourSpot, PlayableIslandLayout, WorldData } from "../world/world-data";

/**
 * HARBOUR-SPOTS lookup: the generator's stored, pre-validated harbour plots by plot key. Harbour
 * placement and expedition founding try these before scanning the whole coast.
 */
interface HarbourSpotIndex {
  byPlot: Map<string, HarbourSpot>;
  /** Each site's spot list when indexed: the generator assigns the lists after validating them. */
  sources: readonly (readonly HarbourSpot[] | undefined)[];
  spots: readonly HarbourSpot[];
}

const indexes = new WeakMap<PlayableIslandLayout, HarbourSpotIndex>();
const EMPTY: HarbourSpotIndex = { byPlot: new Map(), sources: [], spots: [] };

const plotKey = (x: number, z: number, rotation: number) => `${x},${z},${rotation}`;

const harbourSpotIndex = (world: Pick<WorldData, "playableIslands">) => {
  const layout = world.playableIslands;
  if (!layout) return EMPTY;
  let index = indexes.get(layout);
  if (index && index.sources.length === layout.sites.length &&
    layout.sites.every((site, position) => site.harbourSpots === index!.sources[position])) return index;
  const spots = layout.sites.flatMap(site => site.harbourSpots ?? []);
  index = { byPlot: new Map(spots.map(spot => [plotKey(spot.x, spot.z, spot.rotation), spot])),
    sources: layout.sites.map(site => site.harbourSpots), spots };
  indexes.set(layout, index);
  return index;
};

/** Every stored harbour spot of the map, island by island; empty when the option was off. */
export const storedHarbourSpots = (world: Pick<WorldData, "playableIslands">) => harbourSpotIndex(world).spots;

/** The stored spot with exactly this plot centre and rotation, if any. */
export const harbourSpotAt = (world: Pick<WorldData, "playableIslands">, x: number, z: number, rotation: number) =>
  harbourSpotIndex(world).byPlot.get(plotKey(x, z, ((Math.round(rotation) % 4) + 4) % 4));
