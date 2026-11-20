import { DMath } from "../math/deterministic-math";
import {
  isRoadVergeKind,
  ROAD_GRID_STEP,
  ROAD_VERGE_PLANK_COST,
  roadEdgeKey,
  type RoadPoint,
  type RoadSegment,
  type RoadVergeKind
} from "./road-types";
import { createRoadWorkShell, removeRoadWorkShell, stockReachable } from "./road-work-shell";
import { isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Why a verge stretch cannot start now; the Road tab words each reason. */
export type RoadVergeRefusal = "invalid-kind" | "no-road" | "nothing-to-plant" | "busy" | "no-storage";

/** One graph edge of a verge order: its endpoints identify the segment in the current road layout. */
export interface RoadVergeEdge {
  start: RoadPoint;
  end: RoadPoint;
}

/** The saved order of one player-planted verge stretch; the road graph changes only on completion. */
export interface RoadVergeSite {
  kind: RoadVergeKind;
  /** Stretch edges to plant: bridge tiles and edges already carrying this kind are absent. */
  segments: RoadVergeEdge[];
  /** Road node carriers deliver to and the builder starts from. */
  stockPoint: RoadPoint;
}

export interface RoadVergePreview {
  ok: boolean;
  reason?: RoadVergeRefusal;
  /** Edges this order would plant; empty while the stretch itself cannot be resolved. */
  segments: RoadVergeEdge[];
  planks: number;
}

/** Read-only progress view for the UI and tests; the site itself remains a hidden building shell. */
export interface RoadVergeSnapshot extends RoadVergeSite {
  siteUid: number;
  progress: number;
  status: string;
  required: Record<string, number>;
  /** Planks already at the site and not yet consumed by the builder; cancel refunds exactly this. */
  delivered: Record<string, number>;
  /** Stock carriers are bringing now (in transit). */
  incoming: Record<string, number>;
}

export type RoadVergePlantResult = { ok: true; siteUid: number } | { ok: false; reason: RoadVergeRefusal };

const vergeSites = (context: SettlementContext) => context.buildings.filter(
  (building): building is SettlementBuilding & { vergeSite: RoadVergeSite } =>
    building.vergeSite !== undefined);

const edgeKey = (start: RoadPoint, end: RoadPoint) => roadEdgeKey(start, end);
const plankCost = (segments: readonly RoadVergeEdge[]) => segments.length * ROAD_VERGE_PLANK_COST;
const copyEdge = (edge: RoadVergeEdge): RoadVergeEdge =>
  ({ start: { ...edge.start }, end: { ...edge.end } });

const VERGE_STATUS: Readonly<Record<RoadVergeKind, string>> = {
  flowers: "Planting roadside flowers"
};
export const roadVergeStatus = (kind: RoadVergeKind, progress: number) =>
  `${VERGE_STATUS[kind]} (${Math.round(progress * 100)}%)`;

/** The middle road node of the planned path, used as both delivery anchor and builder workplace. */
const middleNode = (stretch: readonly RoadSegment[]) => {
  const points = [stretch[0]!.start, ...stretch.map(segment => segment.end)];
  return { ...points[Math.floor(points.length / 2)]! };
};

/** Edges another active order already holds: two crews never plant the same stretch at once. */
const heldEdges = (context: SettlementContext) => {
  const held = new Set<string>();
  for (const site of vergeSites(context))
    for (const edge of site.vergeSite.segments) held.add(edgeKey(edge.start, edge.end));
  return held;
};

/** Bridge tiles and edges already carrying this kind stay untouched (they are not paid again). */
const plantableEdges = (stretch: readonly RoadSegment[], kind: RoadVergeKind): RoadVergeEdge[] =>
  stretch
    .filter(segment => !segment.bridge && segment.verge !== kind)
    .map(segment => ({ start: { ...segment.start }, end: { ...segment.end } }));

interface StretchInspection {
  reason?: RoadVergeRefusal;
  /** The whole planned path (bridge tiles included); empty until the two points resolve. */
  stretch: RoadSegment[];
  /** The edges the order would plant. */
  segments: RoadVergeEdge[];
}

const inspectStretch = (
  context: SettlementContext, start: SettlementPoint, end: SettlementPoint, kind: RoadVergeKind
): StretchInspection => {
  if (!isRoadVergeKind(kind)) return { reason: "invalid-kind", stretch: [], segments: [] };
  const stretch = context.options.roads.planStretch?.(start, end) ?? [];
  if (!stretch.length) return { reason: "no-road", stretch, segments: [] };
  const segments = plantableEdges(stretch, kind);
  if (!segments.length) return { reason: "nothing-to-plant", stretch, segments };
  const held = heldEdges(context);
  if (segments.some(edge => held.has(edgeKey(edge.start, edge.end))))
    return { reason: "busy", stretch, segments };
  if (!stockReachable(context, middleNode(stretch))) return { reason: "no-storage", stretch, segments };
  return { stretch, segments };
};

/** Whether the stretch can start planting now, with the edges and the plank cost it would pay. */
export const previewRoadVerge = (
  context: SettlementContext, start: SettlementPoint, end: SettlementPoint, kind: RoadVergeKind
): RoadVergePreview => {
  const inspection = inspectStretch(context, start, end, kind);
  return {
    ok: inspection.reason === undefined,
    ...(inspection.reason ? { reason: inspection.reason } : {}),
    segments: inspection.segments,
    planks: plankCost(inspection.segments)
  };
};

/** Starts the job: carriers deliver one plank per planted edge, and one builder plants the stretch. */
export const plantRoadVerge = (
  context: SettlementContext, start: SettlementPoint, end: SettlementPoint, kind: RoadVergeKind
): RoadVergePlantResult => {
  const inspection = inspectStretch(context, start, end, kind);
  if (inspection.reason) return { ok: false, reason: inspection.reason };
  const stockPoint = middleNode(inspection.stretch);
  const site: RoadVergeSite = { kind, segments: inspection.segments, stockPoint: { ...stockPoint } };
  const shell = createRoadWorkShell(context, {
    anchor: stockPoint,
    required: { planks: plankCost(inspection.segments) },
    status: roadVergeStatus(kind, 0),
    stockPoint,
    work: { vergeSite: site }
  });
  return { ok: true, siteUid: shell.uid };
};

/** Cancels a running order; delivered planks return to storage through the construction refund. */
export const cancelRoadVerge = (context: SettlementContext, siteUid: number) => {
  const site = vergeSites(context).find(building => building.uid === siteUid);
  if (!site) return false;
  removeRoadWorkShell(context, site);
  return true;
};

/** Revision whose road layout the site existence check already ran against (cheap per-tick guard). */
const checkedRoadRevision = new WeakMap<SettlementContext, number>();

const currentEdgeKeys = (context: SettlementContext) =>
  new Set((context.options.roads.segments?.() ?? []).map(segment =>
    edgeKey(segment.start, segment.end)));

/** A job whose anchor vanished or whose whole stretch left the road graph refunds itself. */
const dropGoneSites = (context: SettlementContext) => {
  const revision = context.options.roads.revision ?? 0;
  if (checkedRoadRevision.get(context) === revision) return;
  checkedRoadRevision.set(context, revision);
  const present = currentEdgeKeys(context);
  for (const site of vergeSites(context)) {
    const anchorExists = context.options.roads.route(site.vergeSite.stockPoint, site.vergeSite.stockPoint) !== null;
    const stretchExists = site.vergeSite.segments.some(edge => present.has(edgeKey(edge.start, edge.end)));
    if (!anchorExists || !stretchExists) removeRoadWorkShell(context, site);
  }
};

/** Writes the kind onto the edges that still exist, in one road revision. */
const commitRoadVerge = (context: SettlementContext, site: SettlementBuilding) => {
  const stretch = site.vergeSite!;
  const existing = context.options.roads.segments?.() ?? [];
  const byKey = new Map(existing.map(segment => [edgeKey(segment.start, segment.end), segment]));
  let changed = false;
  for (const edge of stretch.segments) {
    const segment = byKey.get(edgeKey(edge.start, edge.end));
    if (!segment || segment.bridge || segment.verge === stretch.kind) continue;
    segment.verge = stretch.kind;
    changed = true;
  }
  return changed ? Boolean(context.options.roads.replaceSegments?.(existing)) : true;
};

/**
 * Completes every finished order after the actor pass: the stretch gets its saved kind (only on
 * edges that still exist), then the shell is removed through the normal refund path.
 */
export const updateRoadVergePlanting = (context: SettlementContext) => {
  if (!vergeSites(context).length) return;
  dropGoneSites(context);
  for (const site of vergeSites(context)) {
    if (site.construction < 1) {
      site.status = roadVergeStatus(site.vergeSite!.kind, site.construction);
      continue;
    }
    if (!commitRoadVerge(context, site)) {
      site.status = "Verge planting completion blocked";
      continue;
    }
    removeRoadWorkShell(context, site);
  }
};

const distanceToEdge = (point: SettlementPoint, start: RoadPoint, end: RoadPoint) => {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (!lengthSquared) return DMath.hypot(point.x - start.x, point.z - start.z);
  const fraction = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return DMath.hypot(point.x - start.x - fraction * dx, point.z - start.z - fraction * dz);
};

/**
 * Nearest running order to a ground point (its anchor or any ordered edge), for the remove tool.
 * A plain query: it never mutates, so it is not journalled and safe to call while hovering.
 */
export const nearestRoadVergeSite = (
  context: SettlementContext, point: SettlementPoint, reach = 1.2
): RoadVergeSnapshot | null => {
  let nearest: RoadVergeSnapshot | null = null, distance = reach;
  for (const site of roadVergeSites(context)) {
    let gap = DMath.hypot(site.stockPoint.x - point.x, site.stockPoint.z - point.z);
    for (const edge of site.segments) gap = Math.min(gap, distanceToEdge(point, edge.start, edge.end));
    if (gap >= distance) continue;
    nearest = site;
    distance = gap;
  }
  return nearest;
};

/** Active orders with their progress, for the Road tab and the tests (no render data). */
export const roadVergeSites = (context: SettlementContext): RoadVergeSnapshot[] =>
  vergeSites(context).map(site => ({
    kind: site.vergeSite.kind,
    segments: site.vergeSite.segments.map(copyEdge),
    stockPoint: { ...site.vergeSite.stockPoint },
    siteUid: site.uid,
    progress: site.construction,
    status: site.status,
    required: { ...site.required },
    delivered: { ...site.input },
    incoming: { ...site.incoming }
  }));

const onRoadGrid = (value: number) =>
  Number.isFinite(value) && Math.abs(value / ROAD_GRID_STEP - Math.round(value / ROAD_GRID_STEP)) < 1e-8;
const onRoadGridPoint = (point: RoadPoint) => onRoadGrid(point.x) && onRoadGrid(point.z);
const savedVergeEdge = (value: unknown): value is RoadVergeEdge =>
  isSaveObject(value) && isSavePoint(value.start) && isSavePoint(value.end) &&
  onRoadGridPoint(value.start) && onRoadGridPoint(value.end);

/** Rejects a malformed saved verge order before its shell or the saved roads are accepted. */
export const roadVergeSiteProblem = (value: unknown, required: unknown): string | null => {
  if (!isSaveObject(value)) return "Invalid verge planting site";
  if (!isRoadVergeKind(value.kind)) return "Invalid verge planting kind";
  if (!Array.isArray(value.segments) || value.segments.length === 0 ||
    !value.segments.every(savedVergeEdge)) return "Invalid verge planting stretch";
  const segments = value.segments as RoadVergeEdge[];
  const keys = segments.map(edge => edgeKey(edge.start, edge.end));
  if (new Set(keys).size !== keys.length) return "Duplicate verge planting segment";
  if (!isSavePoint(value.stockPoint) || !onRoadGridPoint(value.stockPoint))
    return "Invalid verge planting stock point";
  if (!isSaveObject(required) || !isSaveInteger(required.planks) ||
    required.planks !== segments.length * ROAD_VERGE_PLANK_COST)
    return "Verge planting materials do not match the stretch";
  return null;
};

/** The Road tab's verge-tool simulation surface (journalled and exposed by the commands card). */
export const createRoadVergeCommands = (context: SettlementContext) => ({
  previewRoadVerge: (start: SettlementPoint, end: SettlementPoint, kind: RoadVergeKind) =>
    previewRoadVerge(context, start, end, kind),
  plantRoadVerge: (start: SettlementPoint, end: SettlementPoint, kind: RoadVergeKind) =>
    plantRoadVerge(context, start, end, kind),
  cancelRoadVerge: (siteUid: number) => cancelRoadVerge(context, siteUid),
  roadVergeSites: () => roadVergeSites(context),
  nearestRoadVergeSite: (point: SettlementPoint, reach?: number) =>
    nearestRoadVergeSite(context, point, reach)
});
