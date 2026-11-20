import { bumpBuildRevision } from "../world/save/world-change-journal";
import { type BridgeConstructionSnapshot, bridgeConstructionStage } from "./bridge-construction";
import { bridgeSiteFor } from "./bridge-construction-runtime";
import { type BridgeDeck, bridgeDecks } from "./bridge-deck";
import { occupiesDeck, removeClosedDeck, replanDeckCrossings } from "./bridge-removal";
import { bridgeTiles } from "./bridge-road";
import { BRIDGE_DECK_WIDTH, type RoadSegment } from "./road-types";
import { removeRoadWorkShell } from "./road-work-shell";
import type { SettlementContext } from "./settlement-types";
import { stockSplitBlockedByTrade } from "./stock-land-pools";
import { markStrandedScan } from "./stranded-relocation";

/** Owner 2026-11-07: people still on a closed deck after this long are set on the nearer bank. */
export const BRIDGE_CLOSING_TIMEOUT_SECONDS = 60;
/** The reverse construction stages run this long per tile, without a builder. */
export const BRIDGE_DISMANTLE_SECONDS_PER_TILE = 2.5;

/**
 * A removal in progress (saved). "closing": the deck stands, marked `closed`, until nobody is on it
 * (or the safety timeout); "dismantling": its edges are gone and the structure comes down stage by
 * stage, `progress` running from 1 to 0.
 */
export interface BridgeRemoval {
  /** Seconds the deck has been closing. */
  elapsed: number;
  id: number;
  phase: "closing" | "dismantling";
  /** Structure left standing while dismantling (1 → 0). */
  progress: number;
  /** The span's tiles as built (level kept, no closure flag): the model the reverse stages show. */
  segments: RoadSegment[];
}

export type BridgeRemovalResult =
  | { ok: true; completed: boolean; site: boolean }
  | { ok: false; reason: "missing" | "removing" };

const removals = (context: SettlementContext) => context.bridgeRemovals ??= [];

/** The removal in progress for a bridge, if any. */
export const bridgeRemovalFor = (context: SettlementContext, id: number) =>
  context.bridgeRemovals?.find(entry => entry.id === id);

const builtSegments = (tiles: readonly RoadSegment[]) =>
  [...tiles].sort((a, b) => a.bridge!.tile - b.bridge!.tile).map(segment => {
    const { closed: _closed, ...bridge } = segment.bridge!;
    return { ...segment, start: { ...segment.start }, end: { ...segment.end }, bridge };
  });

/**
 * Closes a completed bridge to new entries (one road revision): no route may use it any more, the
 * journeys planned over it re-plan (or wait), and the people on it walk off along their own paths.
 */
const closeBridge = (context: SettlementContext, id: number) => {
  const roads = context.options.roads;
  const existing = roads.segments?.() ?? [];
  const tiles = bridgeTiles(existing, id);
  const deck = bridgeDecks(tiles)[0];
  if (!deck || deck.closed) return false;
  const closed = existing.map(segment => segment.bridge?.id === id
    ? { ...segment, bridge: { ...segment.bridge, closed: true as const } } : segment);
  if (!roads.replaceSegments?.(closed)) return false;
  removals(context).push({ elapsed: 0, id, phase: "closing", progress: 1, segments: builtSegments(tiles) });
  replanDeckCrossings(context, { ...deck, closed: true }, true);
  return true;
};

/**
 * Removes a bridge: its construction or upgrade site first (the construction refund returns
 * delivered stock and displaces carriers bringing more), then the completed deck closes and is
 * dismantled once empty. A completed bridge is a demolition and refunds nothing, as for buildings.
 */
export const removeBridge = (context: SettlementContext, id: number): BridgeRemovalResult => {
  if (bridgeRemovalFor(context, id)) return { ok: false, reason: "removing" };
  const site = bridgeSiteFor(context, id);
  if (site) removeRoadWorkShell(context, site);
  const completed = closeBridge(context, id);
  if (!site && !completed) return { ok: false, reason: "missing" };
  return { completed, ok: true, site: Boolean(site) };
};

const closingDeck = (context: SettlementContext, id: number): BridgeDeck | undefined =>
  bridgeDecks(bridgeTiles(context.options.roads.segments?.() ?? [], id))[0];

const advanceClosing = (context: SettlementContext, entry: BridgeRemoval, dt: number) => {
  entry.elapsed += dt;
  const deck = closingDeck(context, entry.id);
  if (deck) {
    const occupied = context.actors.some(actor => occupiesDeck(context, deck, actor));
    if (occupied && entry.elapsed < BRIDGE_CLOSING_TIMEOUT_SECONDS) return;
    if (!removeClosedDeck(context, deck)) return;
  }
  entry.phase = "dismantling";
  entry.elapsed = 0;
};

/** Returns true when the structure is gone. */
const advanceDismantling = (entry: BridgeRemoval, dt: number) => {
  const tiles = entry.segments[0]?.bridge?.tiles ?? 1;
  entry.progress = Math.max(0, entry.progress - dt / (BRIDGE_DISMANTLE_SECONDS_PER_TILE * tiles));
  return entry.progress <= 0;
};

/**
 * One fixed step of every removal, after the actor pass (people leave the deck first). The
 * finished ones leave the list; `onRemoved` runs once per bridge that is gone.
 */
export const updateBridgeRemovals = (
  context: SettlementContext, dt: number, onRemoved?: (entry: BridgeRemoval) => void
) => {
  const list = context.bridgeRemovals;
  if (!list?.length) return;
  for (const entry of list.slice()) {
    if (entry.phase === "closing") {
      advanceClosing(context, entry, dt);
      continue;
    }
    if (!advanceDismantling(entry, dt) || stockSplitBlockedByTrade(context, entry.id)) continue;
    list.splice(list.indexOf(entry), 1);
    bumpBuildRevision(context.options.world, null);
    // The banks' stock lands split now: people on one without storage go home.
    markStrandedScan(context);
    onRemoved?.(entry);
  }
};

const copySegments = (segments: readonly RoadSegment[]) => segments.map(segment => ({
  ...segment, start: { ...segment.start }, end: { ...segment.end }, bridge: { ...segment.bridge! }
}));

/** The dismantling bridges in the construction-site shape: the renderer runs their stages backwards. */
export const bridgeDismantlingSnapshots = (context: SettlementContext): BridgeConstructionSnapshot[] =>
  (context.bridgeRemovals ?? []).filter(entry => entry.phase === "dismantling").map(entry => {
    const first = entry.segments[0]!, last = entry.segments.at(-1)!;
    return {
      builders: 0, consumed: {}, cost: { logs: 0, planks: 0, stone: 0 }, delivered: {}, dismantling: true, end: { ...last.end }, id: entry.id,
      incoming: {}, kind: first.bridge!.kind, progress: entry.progress, required: {},
      segments: copySegments(entry.segments), siteUid: -1, stage: bridgeConstructionStage(entry.progress),
      start: { ...first.start }, status: `Dismantling the bridge (${Math.round(entry.progress * 100)}%)`,
      stockPoint: { ...first.start }, tiles: first.bridge!.tiles, width: BRIDGE_DECK_WIDTH
    };
  });
