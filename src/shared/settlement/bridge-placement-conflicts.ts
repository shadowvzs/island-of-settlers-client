import { BLOCKING, SLOPE } from "../world/world-data";
import { bridgeDecks, decksOverlap, roadUnderDeck } from "./bridge-deck";
import type { RoadPoint, RoadSegment } from "./road-types";
import type { SettlementContext } from "./settlement-types";

/**
 * Dry ground under a planned deck (the bank between an anchor and the water): bank slopes are fine,
 * but building plots, blocking props and cliffs are not.
 */
export const bridgeDeckGroundClear = (context: SettlementContext, point: RoadPoint) => {
  const { world } = context.options;
  const cellX = Math.min(world.cellsX - 1, Math.max(0, Math.floor(point.x)));
  const cellZ = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(point.z)));
  const cell = cellZ * world.cellsX + cellX;
  if (world.blocking[cell] === BLOCKING.cliff || world.blocking[cell] === BLOCKING.prop) return false;
  if ((world.slopeClass?.[cell] ?? 0) >= SLOPE.cliff) return false;
  return !context.occupied[cell];
};

/** Decks under construction or still being dismantled: both occupy the river crossing. */
const siteDecks = (context: SettlementContext) => [
  ...context.buildings.flatMap(building => building.bridgeSite ? bridgeDecks(building.bridgeSite.segments) : []),
  ...(context.bridgeRemovals ?? []).flatMap(entry => entry.phase === "dismantling" ? bridgeDecks(entry.segments) : [])
];

/** Completed decks or roads in the way of the planned span (any angle, by geometry, not edge keys). */
export const bridgeOverlapsRoad = (context: SettlementContext, planned: readonly RoadSegment[]) => {
  const roads = context.options.roads.segments?.() ?? [];
  return bridgeDecks(planned).some(deck => roadUnderDeck(deck, roads) ||
    bridgeDecks(roads).some(existing => decksOverlap(existing, deck)));
};

/** Another bridge site whose deck structure overlaps the planned one. */
export const bridgeOverlapsConstruction = (context: SettlementContext, planned: readonly RoadSegment[]) => {
  const sites = siteDecks(context);
  return bridgeDecks(planned).some(deck => sites.some(site => decksOverlap(site, deck)));
};

/** Road construction may join a site's anchors but never run under a deck that is still being built. */
export const roadPlanCrossesBridgeSite = (context: SettlementContext, segments: readonly RoadSegment[]) => {
  const sites = siteDecks(context);
  return sites.some(deck => roadUnderDeck(deck, segments));
};
