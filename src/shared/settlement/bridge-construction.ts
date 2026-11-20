import { bridgeDecks } from "./bridge-deck";
import { bridgeLatticeSpan } from "./bridge-lattice";
import { bridgeRoadProblem } from "./bridge-road";
import { bridgeUpgradeCost } from "./bridge-upgrade";
import {
  BRIDGE_DECK_WIDTH,
  BRIDGE_MAX_TILES,
  BRIDGE_MIN_TILES,
  type BridgeCost,
  bridgeCost,
  type BridgeKind,
  type BridgeSavedLevel,
  bridgeSavedLevel,
  isBridgeKind,
  isBridgeSavedLevel,
  isRoadTier,
  type RoadPoint,
  roadEdgeKey,
  type RoadSegment
} from "./road-types";
import { isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";

/** Road-tool modes: "stone" already names the paved road tier, so bridges use distinct ids. */
export const BRIDGE_ROAD_MODES = ["bridge-wood", "bridge-stone"] as const;
export type BridgeRoadMode = (typeof BRIDGE_ROAD_MODES)[number];
export const isBridgeRoadMode = (value: unknown): value is BridgeRoadMode =>
  typeof value === "string" && (BRIDGE_ROAD_MODES as readonly string[]).includes(value);
export const bridgeKindForMode = (mode: BridgeRoadMode): BridgeKind =>
  mode === "bridge-wood" ? "wood" : "stone";

/** Three builder stages; progress thresholds are deliberately coarse so the site can resume anywhere. */
export const BRIDGE_STAGES = ["foundations", "deck", "railings"] as const;
export type BridgeConstructionStage = (typeof BRIDGE_STAGES)[number];
export const bridgeConstructionStage = (progress: number): BridgeConstructionStage => {
  if (progress < 0.35) return "foundations";
  if (progress < 0.8) return "deck";
  return "railings";
};
/** Saved when the site is created: worker count follows the span length, never more than two. */
export const bridgeBuilderLimit = (tiles: number) => tiles >= 6 ? 2 : 1;
/** An upgrade refits an open bridge: one builder, whatever the span. */
export const bridgeSiteBuilderLimit = (site: Pick<BridgeConstructionSite, "tiles" | "upgrade">) =>
  site.upgrade ? 1 : bridgeBuilderLimit(site.tiles);
const STAGE_STATUS: Readonly<Record<BridgeConstructionStage, string>> = {
  deck: "Building the bridge deck",
  foundations: "Laying bridge foundations and piers",
  railings: "Fitting bridge railings"
};
export const bridgeStageStatus = (progress: number, percent = Math.round(progress * 100)) =>
  `${STAGE_STATUS[bridgeConstructionStage(progress)]} (${percent}%)`;
/** Status of a site: its construction stage, or the refit of an open bridge. */
export const bridgeSiteStatus = (site: Pick<BridgeConstructionSite, "upgrade">, progress: number) =>
  site.upgrade ? `Upgrading the bridge (${Math.round(progress * 100)}%)` : bridgeStageStatus(progress);

/**
 * The saved construction order of one bridge group. The road graph receives these segments only
 * after the site reaches 100%, so water stays impassable while the builders work.
 */
export interface BridgeConstructionSite {
  id: number;
  kind: BridgeKind;
  tiles: number;
  width: number;
  start: RoadPoint;
  end: RoadPoint;
  /** Land point behind the selected bank where the shore stock is shown. */
  stockPoint: RoadPoint;
  segments: RoadSegment[];
  /**
   * Present on an upgrade of a completed bridge: the saved level it reaches (1–4). The bridge stays
   * open; `segments` mirror its tiles at the current level and are rewritten on completion.
   */
  upgrade?: { level: BridgeSavedLevel };
}

/** Read-only progress view for the UI and tests; the site itself remains a hidden building shell. */
export interface BridgeConstructionSnapshot {
  id: number;
  kind: BridgeKind;
  tiles: number;
  width: number;
  start: RoadPoint;
  end: RoadPoint;
  stockPoint: RoadPoint;
  segments: RoadSegment[];
  siteUid: number;
  progress: number;
  stage: BridgeConstructionStage;
  status: string;
  builders: number;
  required: Record<string, number>;
  delivered: Record<string, number>;
  /** Stock carriers are bringing now (in transit). */
  incoming: Record<string, number>;
  consumed: Record<string, number>;
  cost: BridgeCost;
  upgrade?: { level: BridgeSavedLevel };
  /** A removed bridge coming down: its stages run backwards, without stock or builders. */
  dismantling?: true;
}

const samePoint = (a: RoadPoint, b: RoadPoint) => a.x === b.x && a.z === b.z;
const onRoadGrid = (value: number) => Number.isFinite(value) &&
  Math.abs(value / 0.5 - Math.round(value / 0.5)) < 1e-8;

/** Rejects a malformed saved bridge order before its building or road network is accepted. */
export const bridgeSiteProblem = (value: unknown): string | null => {
  if (!isSaveObject(value)) return "Invalid bridge construction site";
  if (!isSaveInteger(value.id)) return "Invalid bridge construction identity";
  if (!isBridgeKind(value.kind)) return "Invalid bridge construction kind";
  if (value.width !== BRIDGE_DECK_WIDTH) return "Invalid bridge construction deck width";
  if (!isSaveInteger(value.tiles) || value.tiles < BRIDGE_MIN_TILES ||
    value.tiles > BRIDGE_MAX_TILES) return "Invalid bridge construction span";
  if (!isSavePoint(value.start) || !isSavePoint(value.end) || !isSavePoint(value.stockPoint))
    return "Invalid bridge construction point";
  if (![value.start.x, value.start.z, value.end.x, value.end.z, value.stockPoint.x, value.stockPoint.z]
    .every(onRoadGrid)) return "Bridge construction is off the road grid";
  const span = bridgeLatticeSpan(value.start, value.end);
  if (!span || span.tiles !== value.tiles) return "Invalid bridge construction span";
  if (!Array.isArray(value.segments) || value.segments.length !== span.edges)
    return "Incomplete bridge construction order";
  const segments = value.segments as RoadSegment[];
  if (!segments.every(segment => isSaveObject(segment) && isSavePoint(segment.start) &&
    isSavePoint(segment.end) && isRoadTier(segment.tier) && isSaveObject(segment.bridge)))
    return "Invalid bridge construction order segment";
  const roadProblem = bridgeRoadProblem(segments);
  if (roadProblem) return roadProblem;
  const ordered = [...segments].sort((a, b) => a.bridge!.tile - b.bridge!.tile);
  for (const segment of ordered) {
    const bridge = segment.bridge!;
    if (bridge.id !== value.id || bridge.kind !== value.kind || bridge.width !== value.width ||
      bridge.tiles !== value.tiles) return "Inconsistent bridge construction order";
  }
  if (!samePoint(ordered[0]!.start, value.start) ||
    !samePoint(ordered.at(-1)!.end, value.end)) return "Bridge construction endpoints do not match";
  return bridgeSiteUpgradeProblem(value.upgrade, ordered);
};

const bridgeSiteUpgradeProblem = (upgrade: unknown, ordered: readonly RoadSegment[]) => {
  const current = bridgeSavedLevel(ordered[0]!.bridge!);
  if (upgrade === undefined) return current === 0 ? null : "A new bridge starts at level 1";
  if (!isSaveObject(upgrade) || Object.keys(upgrade).some(key => key !== "level") ||
    !isBridgeSavedLevel(upgrade.level) || upgrade.level !== current + 1) return "Invalid bridge upgrade";
  return null;
};

/** What the site consumes: the span cost of a new bridge, or the tier material of an upgrade. */
export const bridgeSiteCost = (site: Pick<BridgeConstructionSite, "kind" | "tiles" | "upgrade">):
  Record<string, number> => {
  if (site.upgrade) return bridgeUpgradeCost(site.kind, site.upgrade.level - 1);
  return Object.fromEntries(Object.entries(bridgeCost(site.kind, site.tiles)).filter(([, count]) => count > 0));
};

/** The construction receipt is exactly the planner's per-tile (or upgrade) cost; never a free bridge. */
export const bridgeSiteStockProblem = (site: BridgeConstructionSite, required: unknown) => {
  if (!isSaveObject(required)) return "Invalid bridge construction stock";
  const cost = bridgeSiteCost(site);
  for (const ware of new Set([...Object.keys(cost), ...Object.keys(required)]))
    if ((required[ware] ?? 0) !== (cost[ware] ?? 0))
      return "Bridge construction materials do not match the span cost";
  return null;
};

/**
 * A saved site and the saved roads must agree: one site per bridge, a new site never names a
 * completed bridge, and an upgrade site names a completed bridge at the level just below its target.
 */
export const bridgeSitesRoadProblem = (roads: readonly RoadSegment[], buildings: readonly unknown[]) => {
  const decks = new Map(bridgeDecks(roads).map(deck => [deck.id, deck]));
  const ids = new Set<number>();
  for (const building of buildings) {
    if (!isSaveObject(building) || !isSaveObject(building.bridgeSite)) continue;
    const site = building.bridgeSite as Partial<BridgeConstructionSite>;
    if (!isSaveInteger(site.id) || !isSavePoint(site.start) || !isSavePoint(site.end)) continue;
    if (ids.has(site.id)) return "Duplicate bridge construction site";
    ids.add(site.id);
    const deck = decks.get(site.id);
    if (!site.upgrade) {
      if (deck) return "Bridge construction duplicates a completed bridge";
      continue;
    }
    if (!deck || deck.level !== site.upgrade.level - 1 || !samePoint(deck.start, site.start) ||
      !samePoint(deck.end, site.end)) return "Bridge upgrade has no matching bridge";
  }
  return null;
};

/** Stable key for one undirected road graph edge. */
export const bridgeEdgeKey = roadEdgeKey;
