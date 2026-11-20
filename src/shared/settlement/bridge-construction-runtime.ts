import { DMath } from "../math/deterministic-math";
import { sampleBilinear } from "../world/grid-geometry";
import { BLOCKING, SLOPE } from "../world/world-data";
import {
  type BridgeConstructionSite,
  type BridgeConstructionSnapshot,
  bridgeConstructionStage,
  bridgeEdgeKey,
  bridgeSiteProblem,
  bridgeSiteStatus,
  bridgeSiteStockProblem
} from "./bridge-construction";
import {
  bridgeDeckGroundClear,
  bridgeOverlapsConstruction,
  bridgeOverlapsRoad
} from "./bridge-placement-conflicts";
import {
  type BridgePlan,
  type BridgePlanningRules,
  type BridgePlanRejection,
  planBridge,
  riverWaterEligibility} from "./bridge-planning";
import {
  BRIDGE_DECK_WIDTH,
  type BridgeCost,
  bridgeCost,
  type BridgeKind,
  isBridgeKind,
  ROAD_STONE_WIDTH,
  type RoadPoint,
  type RoadSegment,
  snapRoadPoint
} from "./road-types";
import { createRoadWorkShell, removeRoadWorkShell, stockReachable, storageBuildings } from "./road-work-shell";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** `BridgePlanRejection` plus command-level checks that need the live road/storage graph. */
export type BridgeBuildRejection =
  | BridgePlanRejection
  | "bridge-overlaps-construction"
  | "bridge-overlaps-road"
  | "no-storage"
  | "shore-road-missing"
  | "shore-stock-unreachable";

export interface BridgePreviewConnections {
  start: boolean;
  end: boolean;
  stock: boolean;
}

export interface BridgePreview {
  ok: boolean;
  reason?: BridgeBuildRejection;
  plan?: BridgePlan;
  connections: BridgePreviewConnections;
}

export type BridgeBuildResult =
  | { ok: true; id: number; plan: BridgePlan; cost: BridgeCost; siteUid: number }
  | { ok: false; reason: BridgeBuildRejection };

const WATER_EPSILON = 1e-6;

/** Dry, clear, buildable shore ground; occupied building plots and blocking props are refused. */
const bridgeShoreSafe = (context: SettlementContext, point: RoadPoint) => {
  const { world } = context.options;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z) ||
    point.x < 0 || point.z < 0 || point.x > world.cellsX || point.z > world.cellsZ) return false;
  if (sampleBilinear(world, world.waterDepth, point.x, point.z) > WATER_EPSILON) return false;
  const cellX = Math.min(world.cellsX - 1, Math.floor(point.x));
  const cellZ = Math.min(world.cellsZ - 1, Math.floor(point.z));
  const cell = cellZ * world.cellsX + cellX;
  if (world.blocking[cell] !== BLOCKING.free) return false;
  if ((world.slopeClass?.[cell] ?? 0) > SLOPE.gentle) return false;
  return !context.occupied[cell];
};

const shorePlanningRules = (context: SettlementContext): BridgePlanningRules => ({
  isClearUnderDeck: point => bridgeDeckGroundClear(context, point),
  isEligibleWater: riverWaterEligibility(context.options.world),
  isSafeShore: point => bridgeShoreSafe(context, point)
});

const hasRoadNode = (context: SettlementContext, point: RoadPoint) =>
  context.options.roads.route(point, point) !== null;

export const activeBridgeSites = (context: SettlementContext) =>
  context.buildings.filter(building => building.bridgeSite !== undefined);
/** The one construction or upgrade site of a bridge id, if any. */
export const bridgeSiteFor = (context: SettlementContext, id: number) =>
  activeBridgeSites(context).find(building => building.bridgeSite!.id === id);

const nextBridgeId = (context: SettlementContext) => {
  const ids = [
    ...(context.options.roads.segments?.() ?? []).flatMap(segment => segment.bridge ? [segment.bridge.id] : []),
    ...activeBridgeSites(context).map(site => site.bridgeSite!.id),
    ...(context.bridgeRemovals ?? []).map(entry => entry.id)
  ];
  return ids.length ? Math.max(...ids) + 1 : 1;
};

const inspectBridge = (
  context: SettlementContext, pointer: SettlementPoint, kind: BridgeKind, bank?: SettlementPoint
): BridgePreview => {
  const connections = { start: false, end: false, stock: false };
  if (!isBridgeKind(kind)) return { ok: false, reason: "invalid-kind", connections };
  const planned = planBridge({
    ...(bank ? { bank } : {}),
    id: 0,
    kind,
    pointer,
    approachWidth: ROAD_STONE_WIDTH,
    rules: shorePlanningRules(context),
    world: context.options.world
  });
  if (!planned.ok) return { ok: false, reason: planned.reason, connections };
  const plan = planned.plan;
  connections.start = hasRoadNode(context, plan.start);
  connections.end = hasRoadNode(context, plan.end);
  const startDistance = bank ? DMath.hypot(bank.x - plan.start.x, bank.z - plan.start.z) : 0;
  const endDistance = bank ? DMath.hypot(bank.x - plan.end.x, bank.z - plan.end.z) : 0;
  const stockPoint = bank && endDistance < startDistance ? plan.end : plan.start;
  connections.stock = storageBuildings(context).length > 0 && stockReachable(context, stockPoint);
  // A blocked crossing is refused before a fixable missing shore road (the placement overlay hides it).
  if (bridgeOverlapsRoad(context, plan.segments))
    return { ok: false, reason: "bridge-overlaps-road", plan, connections };
  if (bridgeOverlapsConstruction(context, plan.segments))
    return { ok: false, reason: "bridge-overlaps-construction", plan, connections };
  if (!connections.start || !connections.end)
    return { ok: false, reason: "shore-road-missing", plan, connections };
  if (!storageBuildings(context).length)
    return { ok: false, reason: "no-storage", plan, connections };
  if (!connections.stock)
    return { ok: false, reason: "shore-stock-unreachable", plan, connections };
  return { ok: true, plan, connections };
};

/** Hidden builder shell of one bridge order (new span or upgrade). */
export const createBridgeSiteShell = (
  context: SettlementContext, site: BridgeConstructionSite, anchor: RoadPoint, required: Record<string, number>
) => createRoadWorkShell(context, { anchor, required, status: bridgeSiteStatus(site, 0),
  stockPoint: site.stockPoint, work: { bridgeSite: site } });

const copySegments = (segments: readonly RoadSegment[]) => segments.map(segment => ({
  ...segment,
  start: { ...segment.start },
  end: { ...segment.end },
  bridge: { ...segment.bridge! }
}));

const bridgeSiteSnapshot = (context: SettlementContext, site: SettlementBuilding): BridgeConstructionSnapshot => {
  const data = site.bridgeSite!;
  return {
    id: data.id,
    kind: data.kind,
    tiles: data.tiles,
    width: data.width,
    start: { ...data.start },
    end: { ...data.end },
    stockPoint: { ...data.stockPoint },
    segments: copySegments(data.segments),
    siteUid: site.uid,
    progress: site.construction,
    stage: bridgeConstructionStage(site.construction),
    status: site.status,
    builders: siteBuilders(context, site),
    required: { ...site.required },
    delivered: { ...site.input },
    incoming: { ...site.incoming },
    consumed: { ...site.constructionConsumed },
    cost: bridgeCost(data.kind, data.tiles),
    ...(data.upgrade ? { upgrade: { ...data.upgrade } } : {})
  };
};

/** Builder construction site tied to the plan; no bridge edge enters the road graph here. */
export const createBridgeConstruction = (context: SettlementContext) => {
  const preview = (pointer: SettlementPoint, kind: BridgeKind, bank?: SettlementPoint) =>
    inspectBridge(context, pointer, kind, bank);

  const build = (pointer: SettlementPoint, kind: BridgeKind, bank?: SettlementPoint): BridgeBuildResult => {
    const inspected = inspectBridge(context, pointer, kind, bank);
    if (!inspected.ok || !inspected.plan) return { ok: false, reason: inspected.reason ?? "unsafe-shore" };
    const plan = inspected.plan;
    const startDistance = bank ? DMath.hypot(bank.x - plan.start.x, bank.z - plan.start.z) : 0;
    const endDistance = bank ? DMath.hypot(bank.x - plan.end.x, bank.z - plan.end.z) : 0;
    const bankIndex = bank && endDistance < startDistance ? 1 : 0;
    const approach = plan.approaches[bankIndex]!;
    const id = nextBridgeId(context);
    const cost = bridgeCost(kind, plan.tiles);
    const site: BridgeConstructionSite = {
      id,
      kind,
      tiles: plan.tiles,
      width: BRIDGE_DECK_WIDTH,
      start: { ...plan.start },
      end: { ...plan.end },
      stockPoint: { ...approach.outer },
      segments: plan.segments.map(segment => ({
        ...segment,
        start: { ...segment.start },
        end: { ...segment.end },
        bridge: { ...segment.bridge!, id }
      }))
    };
    const builtPlan: BridgePlan = { ...plan, segments: site.segments };
    const problem = bridgeSiteProblem(site) ?? bridgeSiteStockProblem(site, cost);
    if (problem) return { ok: false, reason: "unsafe-shore" };
    const siteUid = createBridgeSiteShell(context, site, approach.anchor, { ...cost }).uid;
    return { ok: true, id, plan: builtPlan, cost, siteUid };
  };

  const cancel = (id: number) => {
    const site = bridgeSiteFor(context, id);
    if (!site?.bridgeSite || site.bridgeSite.upgrade) return false;
    removeRoadWorkShell(context, site);
    return true;
  };

  const snapshot = (): BridgeConstructionSnapshot[] =>
    activeBridgeSites(context).map(site => bridgeSiteSnapshot(context, site));

  return {
    bankSafe: (point: SettlementPoint) => bridgeShoreSafe(context, snapRoadPoint(point)),
    build,
    cancel,
    preview,
    snapshot
  };
};

const siteBuilders = (context: SettlementContext, site: SettlementBuilding) =>
  context.actors.filter(actor => actor.job === "Builder" && actor.building === site.uid &&
    !actor.demolitionReturning && actor.phase !== "retired").length;

/** Adds a finished span's edges; false when the road graph refuses them. */
const commitBridgeSpan = (context: SettlementContext, data: BridgeConstructionSite) => {
  const existing = context.options.roads.segments?.() ?? [];
  const present = new Set(existing.map(segment => bridgeEdgeKey(segment.start, segment.end)));
  const additions = data.segments.filter(segment => !present.has(bridgeEdgeKey(segment.start, segment.end)));
  return Boolean(context.options.roads.replaceSegments?.([...existing, ...additions]));
};

/** Rewrites every tile of the upgraded bridge with its new level (one road revision). */
const commitBridgeUpgrade = (context: SettlementContext, data: BridgeConstructionSite) => {
  const level = data.upgrade!.level;
  const existing = context.options.roads.segments?.() ?? [];
  if (!existing.some(segment => segment.bridge?.id === data.id)) return true;
  const upgraded = existing.map(segment => segment.bridge?.id === data.id
    ? { ...segment, bridge: { ...segment.bridge, level } } : segment);
  return Boolean(context.options.roads.replaceSegments?.(upgraded));
};

/**
 * Completes every finished site after the actor pass: the bridge edges appear (or the upgraded tiles
 * change level) only now, and the construction shell (with its hidden stock) is then removed through
 * the normal refund path.
 */
export const updateBridgeConstruction = (context: SettlementContext) => {
  for (const site of activeBridgeSites(context)) {
    const data = site.bridgeSite!;
    if (site.construction < 1) {
      site.status = bridgeSiteStatus(data, site.construction);
      continue;
    }
    const committed = data.upgrade ? commitBridgeUpgrade(context, data) : commitBridgeSpan(context, data);
    if (!committed) {
      site.status = "Bridge completion blocked";
      continue;
    }
    if (!data.upgrade) context.options.onBridgeCompleted?.(data);
    removeRoadWorkShell(context, site);
  }
};
