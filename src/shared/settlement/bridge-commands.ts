import type { BridgeConstructionSnapshot } from "./bridge-construction";
import { createBridgeConstruction } from "./bridge-construction-runtime";
import { bridgeDecks } from "./bridge-deck";
import { bridgeDismantlingSnapshots, type BridgeRemoval, bridgeRemovalFor, removeBridge } from "./bridge-dismantling";
import { bridgeIdAt } from "./bridge-removal";
import { bridgeUpgradeAvailability, cancelBridgeUpgrade, requestBridgeUpgrade } from "./bridge-upgrade-runtime";
import { type BridgeKind, bridgeSavedLevel, type RoadPoint } from "./road-types";
import type { SettlementContext, SettlementPoint } from "./settlement-types";
import { takeStorageFades } from "./stranded-relocation";

/** One bridge for the panel and the renderer: completed, under construction, or being upgraded. */
export interface BridgeOverview {
  completed: boolean;
  end: RoadPoint;
  id: number;
  kind: BridgeKind;
  /** Panel level 1–5. */
  level: number;
  /** Remove ordered: closing to new entries, or coming down (`progress` of the structure left). */
  removal?: { phase: BridgeRemoval["phase"]; progress: number };
  /** Its construction or upgrade site, when one is active. */
  site?: BridgeConstructionSnapshot;
  start: RoadPoint;
  tiles: number;
}

const removalOf = (context: SettlementContext, id: number) => {
  const removal = bridgeRemovalFor(context, id);
  return removal ? { removal: { phase: removal.phase, progress: removal.progress } } : {};
};

const dismantling = (context: SettlementContext): BridgeOverview[] =>
  bridgeDismantlingSnapshots(context).map(site => ({
    completed: false, end: { ...site.end }, id: site.id, kind: site.kind,
    level: bridgeSavedLevel(site.segments[0]!.bridge!) + 1, ...removalOf(context, site.id),
    start: { ...site.start }, tiles: site.tiles
  }));

const overview = (context: SettlementContext, sites: readonly BridgeConstructionSnapshot[]): BridgeOverview[] => {
  const byId = new Map(sites.map(site => [site.id, site]));
  const completed = bridgeDecks(context.options.roads.segments?.() ?? []).map(deck => ({
    completed: true, end: { ...deck.end }, id: deck.id, kind: deck.kind, level: deck.level + 1,
    ...removalOf(context, deck.id), ...(byId.has(deck.id) ? { site: byId.get(deck.id)! } : {}),
    start: { ...deck.start }, tiles: deck.tiles
  }));
  const ids = new Set(completed.map(bridge => bridge.id));
  const planned = sites.filter(site => !ids.has(site.id)).map(site => ({
    completed: false, end: { ...site.end }, id: site.id, kind: site.kind, level: 1, site,
    start: { ...site.start }, tiles: site.tiles
  }));
  return [...completed, ...planned, ...dismantling(context)].sort((a, b) => a.id - b.id);
};

/** Every bridge command and query of the simulation surface; the journalled ones mutate here only. */
export const createBridgeCommands = (context: SettlementContext) => {
  const construction = createBridgeConstruction(context);
  return {
    previewBridge: construction.preview,
    buildBridge: construction.build,
    bridgeBankSafe: construction.bankSafe,
    bridgeConstructions: construction.snapshot,
    /** Sites the renderer draws: construction and upgrade sites, then the bridges coming down. */
    bridgeSiteFrames: () => [...construction.snapshot(), ...bridgeDismantlingSnapshots(context)],
    cancelBridgeConstruction: construction.cancel,
    /** Completed bridges and sites, sorted by id (the bridge panel and its selection). */
    bridges: () => overview(context, construction.snapshot()),
    removeBridge: (id: number) => removeBridge(context, id),
    bridgeUpgradeAvailability: (id: number) => bridgeUpgradeAvailability(context, id),
    requestBridgeUpgrade: (id: number) => requestBridgeUpgrade(context, id),
    cancelBridgeUpgrade: (id: number) => cancelBridgeUpgrade(context, id),
    /**
     * People moved to a storage since the last call (carriers a removed bridge cut off, anyone left on
     * land without storage), for the fade presentation.
     */
    takeStorageFades: () => takeStorageFades(context),
    /** The bridge owning a road edge, or undefined for an ordinary road. */
    bridgeIdAt: (start: SettlementPoint, end: SettlementPoint) => bridgeIdAt(context, start, end)
  };
};
