import { DMath } from "../math/deterministic-math";
import {
  BRIDGE_DECK_HALF_WIDTH, type BridgeDeck, bridgeDecks, deckCells, deckCoordinates, isOnDeck
} from "./bridge-deck";
import type { SettlementContext, SettlementPoint, SettlementRoads } from "./settlement-types";

interface DeckIndex {
  cells: ReadonlyMap<number, readonly BridgeDeck[]>;
  /** Any deck awaiting removal: the closed-deck step guard is free while there is none. */
  closed: boolean;
  revision: number;
}

const NO_DECKS: ReadonlyMap<number, readonly BridgeDeck[]> = new Map();
/** The first stretch behind each anchor is dry shore: standing there is not standing on the deck. */
const CLOSED_ANCHOR_MARGIN = 0.1;

const isPastAnchors = (deck: BridgeDeck, point: SettlementPoint) => {
  const { across, along } = deckCoordinates(deck, point);
  return along > CLOSED_ANCHOR_MARGIN && along < deck.length - CLOSED_ANCHOR_MARGIN &&
    Math.abs(across) <= BRIDGE_DECK_HALF_WIDTH;
};
const indexes = new WeakMap<SettlementRoads, DeckIndex>();

/**
 * Completed decks per touched cell, rebuilt only when the road graph revision changes. Contexts
 * without a road network (military and adventure fixtures) carry no decks.
 */
const NO_INDEX: DeckIndex = { cells: NO_DECKS, closed: false, revision: -1 };

const deckIndexState = (context: SettlementContext): DeckIndex => {
  const { roads, world } = context.options;
  if (!roads || roads.revision === undefined || !roads.segments) return NO_INDEX;
  const cached = indexes.get(roads);
  if (cached?.revision === roads.revision) return cached;
  const cells = new Map<number, BridgeDeck[]>();
  const decks = bridgeDecks(roads.segments());
  for (const deck of decks)
    for (const cell of deckCells(deck, world.cellsX, world.cellsZ, BRIDGE_DECK_HALF_WIDTH)) {
      const list = cells.get(cell);
      if (list) list.push(deck);
      else cells.set(cell, [deck]);
    }
  const index = { cells, closed: decks.some(deck => deck.closed), revision: roads.revision };
  indexes.set(roads, index);
  return index;
};

const deckIndex = (context: SettlementContext) => deckIndexState(context).cells;

const decksAt = (context: SettlementContext, point: SettlementPoint) =>
  deckIndex(context).get(Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x));

/**
 * A completed bridge carries land traffic over its clear deck rectangle only: water stays closed
 * everywhere else, under construction and beside the railings.
 */
export const isOnCompletedBridgeDeck = (context: SettlementContext, point: SettlementPoint) => {
  const cells = deckIndex(context);
  if (!cells.size) return false;
  const { world } = context.options;
  const decks = cells.get(Math.floor(point.z) * world.cellsX + Math.floor(point.x));
  return Boolean(decks?.some(deck => isOnDeck(deck, point)));
};

/** The deck awaiting removal under a point (past its shore anchors), if any. */
export const closedDeckAt = (context: SettlementContext, point: SettlementPoint) => {
  if (!deckIndexState(context).closed) return undefined;
  return decksAt(context, point)?.find(deck => deck.closed && isPastAnchors(deck, point));
};

/**
 * A step from outside onto a deck awaiting removal: nobody new may walk onto it, while the people
 * already on it walk off along their own paths.
 */
export const entersClosedDeck = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  const deck = closedDeckAt(context, to);
  return Boolean(deck && !isPastAnchors(deck, from));
};

/**
 * Half width of the deck lane a rider may use: the clear deck less a horse's body half width. The
 * mounted clearance circle (1.05, for trees and boulders) is wider than the deck allows, and the deck
 * holds no such obstacles, so a horse crosses on this inner lane at any crossing angle.
 */
export const MOUNTED_DECK_LANE_HALF_WIDTH = BRIDGE_DECK_HALF_WIDTH - 0.45;
/**
 * The lane continues this far onto each bank: the planner keeps 1.5 of safe dry shore behind every
 * anchor, so the horse leaves the deck over the abutment without its clearance circle reaching the
 * river beside the mouth.
 */
const MOUNTED_MOUTH_REACH = 1.05;

/** True on a completed deck's inner rider lane, including its mouths onto both banks. */
export const isOnMountedDeckLane = (context: SettlementContext, point: SettlementPoint) => {
  const cells = deckIndex(context);
  if (!cells.size) return false;
  const { world } = context.options;
  const decks = cells.get(Math.floor(point.z) * world.cellsX + Math.floor(point.x));
  return Boolean(decks?.some(deck => {
    const { across, along } = deckCoordinates(deck, point);
    return along >= -MOUNTED_MOUTH_REACH && along <= deck.length + MOUNTED_MOUTH_REACH &&
      Math.abs(across) <= MOUNTED_DECK_LANE_HALF_WIDTH;
  }));
};
/**
 * Both shore anchors of the completed deck under a point, nearer first. A long angled deck edge has
 * no road node within the usual rejoin reach mid-span, so an actor caught on it rejoins at an anchor.
 */
export const bridgeDeckAnchorsAt = (context: SettlementContext, point: SettlementPoint): SettlementPoint[] => {
  const { world } = context.options;
  const decks = deckIndex(context).get(Math.floor(point.z) * world.cellsX + Math.floor(point.x));
  const deck = decks?.find(candidate => isOnDeck(candidate, point));
  if (!deck) return [];
  const distance = (anchor: SettlementPoint) => DMath.hypot(anchor.x - point.x, anchor.z - point.z);
  return distance(deck.end) < distance(deck.start) ? [deck.end, deck.start] : [deck.start, deck.end];
};
