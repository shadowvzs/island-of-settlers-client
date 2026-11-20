import type { WorldData } from "../world/world-data";
import { type BridgeDeck, bridgeDecks, deckPoint } from "./bridge-deck";
import type { BridgeRemoval } from "./bridge-dismantling";
import type { RoadSegment } from "./road-types";
import { landmassAt } from "./settlement-landmass-index";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** Landmass label → stock land: the smallest landmass label of the bridge-joined group. */
export type StockLandResolver = (land: number) => number;

/** What joins landmasses into one stock pool: the standing bridges, and the ones being taken down. */
export interface StockLandLinks {
  removals?: readonly Pick<BridgeRemoval, "id" | "phase" | "segments">[];
  segments: readonly RoadSegment[];
}

const IDENTITY: StockLandResolver = land => land;
/** Dry shore behind an anchor: the anchor itself may sit on the bank's water-edge cell. */
const SHORE_SETBACKS = [0.5, 1, 1.5, 2];

const shoreLand = (world: WorldData, deck: BridgeDeck, atStart: boolean) => {
  for (const setback of SHORE_SETBACKS) {
    const land = landmassAt(world, deckPoint(deck, atStart ? -setback : deck.length + setback, 0));
    if (land >= 0) return land;
  }
  return landmassAt(world, atStart ? deck.start : deck.end);
};

const linkDecks = (links: StockLandLinks, excludeId?: number) => [
  ...bridgeDecks(links.segments),
  ...(links.removals ?? []).flatMap(entry => entry.phase === "dismantling" ? bridgeDecks(entry.segments) : [])
].filter(deck => deck.id !== excludeId);

/**
 * Owner 2026-11-07: while a finished bridge stands (closing and dismantling included), both banks'
 * landmasses share one stock pool; `excludeId` previews the split after that bridge is gone.
 */
export const createStockLandResolver = (
  world: WorldData, links: StockLandLinks, excludeId?: number
): StockLandResolver => {
  const decks = linkDecks(links, excludeId);
  if (!decks.length) return IDENTITY;
  const parent = new Map<number, number>();
  const find = (land: number): number => {
    const next = parent.get(land);
    if (next === undefined || next === land) return land;
    const root = find(next);
    parent.set(land, root);
    return root;
  };
  for (const deck of decks) {
    const first = find(shoreLand(world, deck, true)), second = find(shoreLand(world, deck, false));
    if (first < 0 || second < 0 || first === second) continue;
    parent.set(Math.max(first, second), Math.min(first, second));
  }
  return land => land < 0 ? land : find(land);
};

interface CachedResolver {
  removals: number;
  resolve: StockLandResolver;
  revision: number;
  terrain: number;
}
const cache = new WeakMap<SettlementContext, CachedResolver>();

const contextLinks = (context: Pick<SettlementContext, "bridgeRemovals" | "options">): StockLandLinks => ({
  removals: context.bridgeRemovals, segments: context.options.roads?.segments?.() ?? []
});

/**
 * The live island's resolver, rebuilt when the road graph, the terrain or the removal list changes.
 * A context without a road revision (save validation) resolves its own links each time.
 */
export const contextStockLand = (context: SettlementContext): StockLandResolver => {
  const { roads, world } = context.options;
  const revision = roads?.revision;
  if (revision === undefined) return createStockLandResolver(world, contextLinks(context));
  const terrain = world.terrainRevision ?? 0, removals = context.bridgeRemovals?.length ?? 0;
  const cached = cache.get(context);
  if (cached && cached.revision === revision && cached.terrain === terrain && cached.removals === removals)
    return cached.resolve;
  const resolve = createStockLandResolver(world, contextLinks(context));
  cache.set(context, { removals, resolve, revision, terrain });
  return resolve;
};

/** Stock land under a point, or -1 over water / outside the map. */
export const stockLandAt = (context: SettlementContext, point: SettlementPoint) =>
  contextStockLand(context)(landmassAt(context.options.world, point));
