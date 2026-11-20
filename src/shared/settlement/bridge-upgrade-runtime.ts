import { BRIDGE_FLARE_LENGTH } from "./bridge-approaches";
import { type BridgeConstructionSite, bridgeSiteProblem, bridgeSiteStockProblem } from "./bridge-construction";
import { bridgeSiteFor, createBridgeSiteShell } from "./bridge-construction-runtime";
import { type BridgeDeck, bridgeDecks } from "./bridge-deck";
import { bridgeTiles } from "./bridge-road";
import { bridgeUpgradeCapped } from "./building-availability-rules";
import { bridgeUpgradeCost } from "./bridge-upgrade";
import { BRIDGE_DECK_WIDTH, type BridgeSavedLevel, MAX_BRIDGE_LEVEL, type RoadPoint, snapRoadPoint } from "./road-types";
import { removeRoadWorkShell, storageBuildings } from "./road-work-shell";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementContext } from "./settlement-types";

/** Why a bridge cannot start an upgrade now; the UI words each reason. */
export type BridgeUpgradeRefusal = "missing" | "busy" | "max-level" | "map-cap" | "no-storage" | "missing-material";

export interface BridgeUpgradeAvailability {
  available: boolean;
  cost: Record<string, number>;
  reason?: BridgeUpgradeRefusal;
  /** Stock of each cost ware in storage road-connected to the bridge. */
  supply: Record<string, number>;
}

const completedDeck = (context: SettlementContext, id: number) =>
  bridgeDecks(bridgeTiles(context.options.roads.segments?.() ?? [], id))[0];

const connectedStorages = (context: SettlementContext, anchor: RoadPoint) =>
  storageBuildings(context).filter(storage => isOwnBuilding(storage) &&
    context.options.roads.route(storage.access, anchor) !== null);

/** The bank whose anchor reaches storage by road: the upgrade stock is delivered there. */
const upgradeBank = (context: SettlementContext, deck: BridgeDeck) => {
  for (const [anchor, direction] of [[deck.start, -1], [deck.end, 1]] as const) {
    const storages = connectedStorages(context, anchor);
    if (storages.length) return { anchor, direction, storages };
  }
  return undefined;
};

const supplyIn = (storages: ReturnType<typeof connectedStorages>, cost: Record<string, number>) =>
  Object.fromEntries(Object.keys(cost).map(ware =>
    [ware, storages.reduce((sum, storage) => sum + (storage.inventory[ware] ?? 0), 0)]));

/** Whether the bridge can start its next upgrade, with the cost and the connected supply. */
export const bridgeUpgradeAvailability = (context: SettlementContext, id: number): BridgeUpgradeAvailability => {
  const deck = completedDeck(context, id);
  const refused = (reason: BridgeUpgradeRefusal, cost: Record<string, number> = {}, supply = {}) =>
    ({ available: false, cost, reason, supply });
  if (!deck) return refused("missing");
  const cost = bridgeUpgradeCost(deck.kind, deck.level);
  if (deck.level >= MAX_BRIDGE_LEVEL - 1) return refused("max-level");
  // The map's highest tier caps bridge levels like building levels (MAP BUILDING AVAILABILITY).
  if (bridgeUpgradeCapped(context, deck.level)) return refused("map-cap", cost);
  // A bridge awaiting removal takes no refit.
  if (deck.closed || bridgeSiteFor(context, id)) return refused("busy", cost);
  const bank = upgradeBank(context, deck);
  if (!bank) return refused("no-storage", cost);
  const supply = supplyIn(bank.storages, cost);
  if (Object.entries(cost).some(([ware, count]) => (supply[ware] ?? 0) < count))
    return refused("missing-material", cost, supply);
  return { available: true, cost, supply };
};

export type BridgeUpgradeResult = { ok: true; siteUid: number } | { ok: false; reason: BridgeUpgradeRefusal };

/**
 * Starts the next upgrade as a builder site at the connected bank: carriers deliver the tier material,
 * one builder refits the bridge, and it stays open meanwhile (no gameplay change, visual only).
 */
export const requestBridgeUpgrade = (context: SettlementContext, id: number): BridgeUpgradeResult => {
  const availability = bridgeUpgradeAvailability(context, id);
  const deck = completedDeck(context, id);
  if (!availability.available || !deck) return { ok: false, reason: availability.reason ?? "missing" };
  const bank = upgradeBank(context, deck)!;
  const tiles = bridgeTiles(context.options.roads.segments?.() ?? [], id)
    .sort((a, b) => a.bridge!.tile - b.bridge!.tile);
  const site: BridgeConstructionSite = {
    id,
    kind: deck.kind,
    tiles: deck.tiles,
    width: BRIDGE_DECK_WIDTH,
    start: { ...deck.start },
    end: { ...deck.end },
    stockPoint: snapRoadPoint({
      x: bank.anchor.x + deck.unitX * bank.direction * BRIDGE_FLARE_LENGTH,
      z: bank.anchor.z + deck.unitZ * bank.direction * BRIDGE_FLARE_LENGTH
    }),
    segments: tiles.map(segment => ({ ...segment, bridge: { ...segment.bridge! } })),
    upgrade: { level: (deck.level + 1) as BridgeSavedLevel }
  };
  if (bridgeSiteProblem(site) ?? bridgeSiteStockProblem(site, availability.cost))
    return { ok: false, reason: "missing" };
  return { ok: true, siteUid: createBridgeSiteShell(context, site, bank.anchor, { ...availability.cost }).uid };
};

/** Cancels a running upgrade; delivered stock returns to storage through the construction refund. */
export const cancelBridgeUpgrade = (context: SettlementContext, id: number) => {
  const site = bridgeSiteFor(context, id);
  if (!site?.bridgeSite?.upgrade) return false;
  removeRoadWorkShell(context, site);
  return true;
};
