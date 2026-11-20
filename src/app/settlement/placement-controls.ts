/* oxlint-disable max-lines, max-lines-per-function -- one pointer-gesture controller owns every
   placement preview and command guard, so bridge, road and building tools share cancel semantics. */
import type { I18n } from "@lingui/core";

import type { RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { getPlacedBuildingLogistics } from "../../render-common/buildings/building-grid-metrics";
import { getPlacedBuildingSignpost } from "../../render-common/buildings/building-road-signpost";
import { classifyPress } from "../../render-common/pointer-gestures";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { ROAD_APPEARANCE } from "../../render-common/road-appearance";
import { displayBuildingName, displayJobName, displayWareName, translateDomainText } from "../../shared/i18n/domain";
import { translateMessage } from "../../shared/i18n/translate";
import {
  bridgeKindForMode,
  type BridgeRoadMode,
  isBridgeRoadMode
} from "../../shared/settlement/bridge-construction";
import type { BridgeBuildRejection, BridgePreview } from "../../shared/settlement/bridge-construction-runtime";
import type { RoadDecorationOrder } from "../../shared/settlement/road-decoration-state";
import {
  isRoadVergeMode,
  type RoadPreview,
  type RoadTier,
  roadVergeKindFromMode,
  type RoadVergeMode,
  snapRoadPoint
} from "../../shared/settlement/road-types";
import type { RoadVergePreview } from "../../shared/settlement/road-verge-planting";
import type { SettlementBuilding, SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SurveyAssignmentResult,SurveyJob } from "../../shared/settlement/settlement-surveying";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createOverlayCanvas, fitCanvasToViewport } from "../helpers";
import { ROAD_DECORATION_MESSAGES } from "../player-inventory/road-decoration-presentation";
import { drawBridgePreview, drawBridgeSpots } from "./bridge-placement-overlay";
import { createBridgeSpotScan } from "./bridge-spot-scan";
import { snapBuildingPlot } from "./building-plot";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import { createPlacementBadge } from "./placement-badge";
import { createPlacementCheck, type PlacementCheck } from "./placement-check";
import { announcePlacementRefusal, createPlacementReasonText } from "./placement-refusal";
import { createRoadDecorationMoveControl, createRoadDecorationTool } from "./road-decoration-tool";
import { snapExistingRoadEndpoint } from "./road-endpoint";
import { roadFacingRotation } from "./road-facing-placement";
import type { RoadPlotReservation } from "./road-plot-reservation";
import {
  roadVergeBadgeText, roadVergeCancelText, roadVergeOrderedText, roadVergeRefusalText,
  vergePreviewSegments
} from "./road-verge-tool";

type Point = { x: number; z: number };
type RoadMode = RoadTier | BridgeRoadMode | RoadVergeMode | "remove" | null;
export interface PlacementSelection { building: number | null; road: RoadMode; rotation: number; survey: SurveyJob | null }
export interface PlacementControlsOptions {
  roadDecorationHeld?: (item: RoadDecorationItemId) => number;
  onRoadDecoration?: (order: RoadDecorationOrder) => Promise<true | string>;
  onRoadDecorationMove?: (uid: number, order: RoadDecorationOrder) => Promise<true | string>;
  /** False during a session transition: previews may update, but no world command runs. */
  canCommand?: () => boolean;
  simulation: SettlementSimulation;
  world: WorldData;
  renderer: Pick<TerrainRenderer, "pickGround" | "projectToViewport">;
  canvas: HTMLCanvasElement;
  /** Active Lingui instance: canvas badges and placement notices follow the selected locale. */
  i18n?: I18n;
  viewport?: HTMLElement;
  onChange?: (selection: PlacementSelection) => void;
  onMessage?: (message: string) => void;
  /** A message about the current selection only (stale once the selection changes). */
  onNotice?: (message: string) => void;
  onPlaced?: (building: SettlementBuilding) => void;
  onSurvey?: (job: SurveyJob, target: Point) => SurveyAssignmentResult;
  /** Plot centre of the preview ghost under a viewport point: clicking a preview places there. */
  pickPreview?: (x: number, y: number) => Point | null;
  /** Lets the hovered plot's road preview route around the plot (the road network's blocker). */
  roadPlotReservation?: RoadPlotReservation;
}

/** Pick only public graph sections; building doorway ribbons stay owned by their buildings. */
export const nearestRoadSection = <T extends { start: Point; end: Point }>(point: Point, sections: T[]) => {
  let closest: T | null = null, distance = 0.45;
  for (const section of sections) {
    const dx = section.end.x - section.start.x, dz = section.end.z - section.start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (!lengthSquared) continue;
    const fraction = Math.max(0, Math.min(1,
      ((point.x - section.start.x) * dx + (point.z - section.start.z) * dz) / lengthSquared));
    const gap = Math.hypot(point.x - section.start.x - fraction * dx,
      point.z - section.start.z - fraction * dz);
    if (gap >= distance) continue;
    closest = section; distance = gap;
  }
  return closest;
};

const roadTierLabel = (tier: RoadTier, i18n?: I18n) => i18n
  ? displayWareName(tier, i18n).toLowerCase()
  : ROAD_APPEARANCE[tier].label.toLowerCase();
const roadResultMessage = (ok: unknown, targetTier: RoadTier | null, i18n?: I18n) => {
  if (!targetTier) return translateDomainText(
    ok ? "Dirt road connected." : "No clear road route between these points.", i18n);
  const label = roadTierLabel(targetTier, i18n);
  if (ok) return translateDomainText(`Road upgraded to ${label}.`, i18n);
  return translateDomainText(
    `No connected previous-tier road to upgrade, or insufficient ${label}. Upgrade one tier at a time.`, i18n);
};
const bridgeFailureText = (reason: BridgeBuildRejection | undefined, i18n?: I18n) => {
  switch (reason) {
    case "across-water-step":
      return translateDomainText("A bridge cannot span a waterfall, cascade or plunge pool.", i18n);
    case "ineligible-water": return translateDomainText("Open sea and still lakes cannot be bridged.", i18n);
    case "not-over-water": return translateDomainText("Aim at an inland river crossing.", i18n);
    case "not-across-river":
      return translateDomainText("A bridge must cross the river from one bank to the opposite bank.", i18n);
    case "selected-bank-too-far": return translateDomainText("Choose a bank beside this river crossing.", i18n);
    case "too-long": return translateDomainText("The river is too wide for a bridge span.", i18n);
    case "too-short": return translateDomainText("The crossing needs a span of at least three tiles.", i18n);
    case "unsafe-shore": return translateDomainText("Both shores need clear, dry building ground.", i18n);
    case "shore-road-missing": return translateDomainText("Connect a road to both shore anchors first.", i18n);
    case "shore-stock-unreachable": return translateDomainText("Connect the selected bank to a storage by road.", i18n);
    case "bridge-overlaps-road": return translateDomainText("A road already occupies this crossing.", i18n);
    case "bridge-overlaps-construction": return translateDomainText("Another bridge is already being built here.", i18n);
    case "no-storage": return translateDomainText("Build a storage before starting a bridge.", i18n);
    default: return translateDomainText("This crossing cannot be bridged here.", i18n);
  }
};
const bridgeCostText = (cost: { logs: number; planks: number; stone: number }, i18n?: I18n) =>
  Object.entries(cost).filter(([, count]) => count > 0)
    .map(([ware, count]) => `${count} ${displayWareName(ware, i18n)}`).join(" + ");
const bridgePreviewMessage = (preview: BridgePreview | null, bankSelected: boolean, i18n?: I18n) => {
  if (!bankSelected) return translateDomainText(preview?.plan
    ? "Click a clear shore bank to choose the bridge stock point"
    : bridgeFailureText(preview?.reason, i18n), i18n);
  if (!preview?.ok) return bridgeFailureText(preview?.reason, i18n);
  return translateDomainText(`Click to build the bridge · ${bridgeCostText(preview.plan!.cost, i18n)}`, i18n);
};
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName));

/** Pointer previews use the renderer's last-frame projection for every camera and detail level. */
export const createPlacementControls = (options: PlacementControlsOptions) => {
  const { canvas, i18n, renderer, simulation, world } = options;
  const viewport = options.viewport ?? canvas.parentElement ?? document.body;
  const overlay = createOverlayCanvas(viewport, "settlement-placement-preview");
  Object.assign(overlay.style, { position: "absolute", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "2" });
  const context = overlay.getContext("2d")!;
  const events = new AbortController();
  const { signal } = events;
  let building: number | null = null, road: RoadMode = null, rotation = 0;
  let manualRotation = false, facingKey = "";
  let survey: SurveyJob | null = null;
  let pointer: { x: number; y: number } | null = null, start: Point | null = null;
  /** Touch placement: the ground point of the last tap; tapping the same plot again confirms. */
  let pinned: Point | null = null;
  let check: PlacementCheck | null = null;
  const checkPlacement = createPlacementCheck(simulation, world, undefined, options.roadPlotReservation);
  const reasonText = createPlacementReasonText(i18n);
  let press: { id: number; x: number; y: number; time: number; maxPointers: number; moved: number } | null = null;
  let suppressContextMenu = false;
  const pointers = new Set<number>();
  let roadPreview: RoadPreview | null = null, bridgePreview: BridgePreview | null = null, previewKey = "";
  let vergePreview: RoadVergePreview | null = null;
  const bridgeSpots = createBridgeSpotScan({
    owned: () => simulation.territory().owned,
    preview: (pointer, kind) => simulation.previewBridge(pointer, kind),
    world
  });
  let hoveredBridgeSpot: ReturnType<typeof bridgeSpots.nearest> = null;
  /** Bridge spots rescan only when territory, roads, buildings, bridge sites or terrain changed. */
  const bridgeSpotKey = () => `${simulation.territory().revision}/${simulation.roadRevision()}/` +
    `${simulation.buildings().length}/${simulation.navigationRevision()}/` +
    `${simulation.bridgeConstructions().length}/${world.buildRevision ?? 0}/${world.terrainRevision ?? 0}`;
  const updateBridgeSpots = (point: Point | null) => {
    const kind = road !== null && isBridgeRoadMode(road) ? bridgeKindForMode(road) : null;
    bridgeSpots.update(kind, kind ? bridgeSpotKey() : "", point ?? simulation.headquarters);
  };
  /** A pointer on or beside a shown crossing snaps to it; elsewhere it plans from the river point. */
  /** The first click picks the stock bank where clicked; the second builds the (snapped) crossing. */
  const bridgeClickTarget = (point: Point) =>
    (start && bridgeSpots.nearest(point)?.pointer) || snapRoadPoint(point);
  const refreshRoadPreview = (point: Point | null) => {
    if (!point || road === null || road === "remove") {
      roadPreview = null; bridgePreview = null; vergePreview = null; hoveredBridgeSpot = null; previewKey = ""; return;
    }
    if (isRoadVergeMode(road)) {
      bridgePreview = null; hoveredBridgeSpot = null;
      if (!start) { roadPreview = null; vergePreview = null; previewKey = ""; return; }
      const target = roadPoint(point);
      if (target.x === start.x && target.z === start.z) {
        roadPreview = null; vergePreview = null; previewKey = ""; return;
      }
      const key = `${start.x}:${start.z}/${target.x}:${target.z}/${road}/${simulation.roadRevision()}`
        + `/${simulation.buildings().length}/${simulation.territory().revision}`;
      if (key === previewKey) return;
      previewKey = key;
      vergePreview = simulation.previewRoadVerge(start, target, roadVergeKindFromMode(road));
      roadPreview = { start: { ...start }, end: target, valid: vergePreview.ok, points: [],
        segments: vergePreviewSegments(vergePreview, simulation.roadSegments()) };
      return;
    }
    vergePreview = null;
    if (isBridgeRoadMode(road)) {
      hoveredBridgeSpot = bridgeSpots.nearest(point);
      const target = hoveredBridgeSpot?.pointer ?? snapRoadPoint(point);
      const key = `${start?.x ?? "none"}:${start?.z ?? "none"}/${target.x}:${target.z}/${road}`
        + `/${simulation.roadRevision()}/${simulation.bridgeConstructions().length}`;
      if (key === previewKey) return;
      previewKey = key;
      const preview = simulation.previewBridge(target, bridgeKindForMode(road), start ?? undefined);
      bridgePreview = preview;
      roadPreview = preview.plan ? {
        start: { ...preview.plan.start }, end: { ...preview.plan.end }, valid: preview.ok,
        points: [], segments: preview.plan.segments.map(segment => ({ ...segment, preview: true }))
      } : null;
      return;
    }
    bridgePreview = null;
    if (!start) { roadPreview = null; previewKey = ""; return; }
    const target = roadPoint(point);
    if (target.x === start.x && target.z === start.z) {
      roadPreview = null; previewKey = ""; return;
    }
    const key = `${start.x}:${start.z}/${target.x}:${target.z}/${road}/${simulation.roadRevision()}`
      + `/${simulation.buildings().length}/${simulation.territory().revision}`;
    if (key === previewKey) return;
    previewKey = key;
    const plan = simulation.planRoad(start, target, road);
    roadPreview = { start: { ...start }, end: target, valid: !!plan,
      points: plan?.points ?? [], segments: plan?.segments ?? [] };
  };
  const nearestBridgeSite = (point: Point) => simulation.bridgeConstructions()
    .map(site => ({ site, gap: Math.min(
      Math.hypot(site.stockPoint.x - point.x, site.stockPoint.z - point.z),
      Math.hypot(site.start.x - point.x, site.start.z - point.z),
      Math.hypot(site.end.x - point.x, site.end.z - point.z)
    ) }))
    .filter(entry => entry.gap <= 1.6)
    .sort((a, b) => a.gap - b.gap || a.site.id - b.site.id)[0]?.site;
  const faceRoad = (point: Point) => {
    if (building === null || manualRotation) return;
    const key = `${building}/${Math.floor(point.x * 2)}/${Math.floor(point.z * 2)}/${simulation.roadRevision()}/`
      + `${simulation.navigationRevision()}/${simulation.territory().revision}/${world.buildRevision ?? 0}`;
    if (key === facingKey) return;
    facingKey = key;
    const next = roadFacingRotation(building, point, rotation, simulation.roadSegments(),
      turn => checkPlacement(building!, point, turn));
    if (next === rotation) return;
    rotation = next; changed();
  };
  const decoration = createRoadDecorationTool({ simulation, world, held: options.roadDecorationHeld ?? (() => 0),
    commit: options.onRoadDecoration ?? (async () => "Road decoration custody is unavailable"),
    commitMove: options.onRoadDecorationMove,
    changed: () => { changed(); updatePreview(); }, message: text => options.onNotice?.(text) });
  const isInteracting = () => building !== null || road !== null || survey !== null || decoration.active();
  const changed = () => options.onChange?.({ building, road, rotation, survey });
  const cancel = () => { building = null; road = null; survey = null; start = null; press = null; pinned = null;
    decoration.cancel();
    pointers.clear(); changed(); updatePreview(); };
  const setPointer = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  /** The preview ghost under the pointer wins over the ground behind it while placing a building. */
  const picked = () => {
    if (!pointer) return null;
    const preview = building !== null ? options.pickPreview?.(pointer.x, pointer.y) : null;
    return preview ?? renderer.pickGround(pointer.x, pointer.y);
  };
  const roadPoint = (point: Point) => {
    let closest: Point | undefined, distance = 0.9;
    for (const entry of simulation.buildings()) {
      // Finishing a short manual connection must not snap back to its own entrance.
      if (start && Math.hypot(entry.access.x - start.x, entry.access.z - start.z) < .01) continue;
      let gap = Math.min(
        Math.hypot(entry.access.x - point.x, entry.access.z - point.z),
        Math.hypot(entry.doorThreshold.x - point.x, entry.doorThreshold.z - point.z),
        Math.hypot(entry.workerApproach.x - point.x, entry.workerApproach.z - point.z)
      );
      const { post } = getPlacedBuildingSignpost(entry.typeId, entry.x, entry.z, entry.rotation);
      gap = Math.min(gap, Math.hypot(post.x - point.x, post.z - point.z));
      if (pointer) {
        const icon = renderer.projectToViewport(post.x,
          sampleSmooth(world, world.heights, post.x, post.z) + .78, post.z);
        const screenGap = Math.hypot(icon.x - pointer.x, icon.y - pointer.y);
        if (screenGap < 22) gap = Math.min(gap, screenGap / 220);
      }
      if (gap < distance) { closest = entry.access; distance = gap; }
    }
    if (closest) return { ...closest };
    return snapExistingRoadEndpoint(point, simulation.roadSegments(), start) ??
      { x: Math.round(point.x * 2) / 2, z: Math.round(point.z * 2) / 2 };
  };
  const project = (point: Point) => renderer.projectToViewport(point.x,
    sampleSmooth(world, world.heights, point.x, point.z) + 0.035, point.z);
  const trace = (points: Point[], close = false) => {
    context.beginPath();
    points.forEach((point, index) => {
      const screen = project(point);
      if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
    });
    if (close) context.closePath();
  };
  const badge = createPlacementBadge(context, viewport, project);
  /** Harbour placement (owner, 2026-10-15): whether the spot gets a second berth, under the label. */
  const berthsBadge = (label: { x: number; y: number }, berths: number) => {
    const text = translateMessage(i18n,
      berths > 1 ? M.debug.placement.berthsMany : M.debug.placement.berthsOne, { count: berths });
    context.font = "700 11px system-ui";
    const width = context.measureText(text).width + 12, x = label.x, y = label.y - 6;
    context.fillStyle = berths > 1 ? "#2f6b3ee6" : "#4a4337e6";
    context.beginPath(); context.roundRect(x, y, width, 17, 8); context.fill();
    context.fillStyle = "#fff4dc"; context.fillText(text, x + 6, y + 12.5);
  };
  const updatePreview = () => {
    const ratio = fitCanvasToViewport(overlay, viewport);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, overlay.width, overlay.height);
    const point = isInteracting() ? (building !== null && pinned) || picked() : null;
    updateBridgeSpots(point);
    decoration.update(point);
    if (point && building !== null) faceRoad(point);
    refreshRoadPreview(point);
    check = point && building !== null ? checkPlacement(building, point, rotation) : null;
    if (!point) return;
    if (decoration.active()) {
      const valid = decoration.ghost()?.valid === true;
      badge(point, translateMessage(i18n, valid ? ROAD_DECORATION_MESSAGES.ready : ROAD_DECORATION_MESSAGES.clearSpot), !valid);
      return;
    }
    if (check && building !== null) {
      const { plot, reason } = check;
      const left = plot.x - plot.width / 2, top = plot.z - plot.depth / 2;
      trace([{ x: left, z: top }, { x: left + plot.width, z: top },
        { x: left + plot.width, z: top + plot.depth }, { x: left, z: top + plot.depth }], true);
      context.fillStyle = reason ? "#e3645633" : "#b2e4b333";
      context.fill(); context.strokeStyle = reason ? "#ff9385" : "#d9edb6";
      context.lineWidth = 2; context.stroke();
      const logistics = getPlacedBuildingLogistics(building, plot.x, plot.z, rotation);
      trace([logistics.doorThreshold, logistics.workerApproach, logistics.road]);
      context.setLineDash([4, 4]); context.stroke();
      context.setLineDash([]);
      const label = badge(plot, reason ? reasonText(reason) : readyMessage(building, plot), !!reason);
      if (check.berths !== undefined) berthsBadge(label, check.berths);
      return;
    }
    if (road !== null && isBridgeRoadMode(road)) {
      const preview = bridgePreview;
      drawBridgeSpots(context, project, trace, bridgeSpots.spots(), point, hoveredBridgeSpot);
      if (preview?.plan) drawBridgePreview(context, project, trace, preview.plan, preview);
      badge(snapRoadPoint(point), bridgePreviewMessage(preview, !!start, i18n),
        !preview?.plan || !preview.ok);
      return;
    }
    if (road === "remove") {
      const bridgeSite = nearestBridgeSite(point);
      if (bridgeSite) {
        const screen = project(bridgeSite.stockPoint);
        context.beginPath(); context.arc(screen.x, screen.y, 7, 0, Math.PI * 2);
        context.fillStyle = "#ff9385"; context.fill();
        badge(point, translateDomainText(
          `Cancel ${bridgeSite.kind} bridge construction (${Math.round(bridgeSite.progress * 100)}%)?`, i18n), true);
        return;
      }
      const vergeSite = simulation.nearestRoadVergeSite(point);
      if (vergeSite) {
        context.strokeStyle = "#ff9385"; context.lineWidth = 7;
        for (const edge of vergeSite.segments) { trace([edge.start, edge.end]); context.stroke(); }
        badge(point, roadVergeCancelText(vergeSite, i18n), true);
        return;
      }
      const section = nearestRoadSection(point, simulation.roadSegments());
      if (section) {
        trace([section.start, section.end]);
        context.strokeStyle = "#ff9385"; context.lineWidth = 7; context.stroke();
      }
      badge(point, translateDomainText(section
        ? "Click to remove this road section" : "Choose a public road section", i18n), !section);
      return;
    }
    const target = survey === "Geologist" ? point : roadPoint(point), screen = project(target);
    context.beginPath(); context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    context.fillStyle = roadPreview?.valid === false ? "#ff9385" : "#e8bb7e"; context.fill();
    if (isRoadVergeMode(road)) {
      badge(target, roadVergeBadgeText(vergePreview, start !== null, i18n),
        vergePreview !== null && !vergePreview.ok);
      return;
    }
    const targetTier = road !== null && road !== "dirt" ? road : null;
    const refused = translateDomainText(targetTier
      ? "No connected previous-tier road to upgrade" : "No clear road route", i18n);
    const ready = targetTier
      ? translateMessage(i18n, M.debug.placement.clickUpgrade, { tier: roadTierLabel(targetTier, i18n) })
      : translateDomainText("Click to build this road", i18n);
    let badgeMessage = translateDomainText("Choose road start", i18n);
    if (survey) badgeMessage = translateMessage(i18n, M.debug.placement.sendJob, {
      job: displayJobName(survey, i18n)
    });
    else if (start && !roadPreview) badgeMessage = translateDomainText("Choose road end", i18n);
    else if (start) badgeMessage = roadPreview?.valid ? ready : refused;
    badge(target, badgeMessage, roadPreview?.valid === false);
  };
  const readyMessage = (id: number, plot: { depth: number; width: number }) => translateMessage(i18n,
    pinned ? M.debug.placement.readyTap : M.debug.placement.readyRotate, {
      building: displayBuildingName(id, simulation.playerNation(), i18n),
      depth: plot.depth,
      width: plot.width
    });
  /** Touch taps first pin the ghost; a second tap on the same plot builds it. */
  const tapBuilding = (id: number) => {
    const point = picked();
    if (!point) return;
    const target = snapBuildingPlot(id, point, rotation);
    const current = pinned && snapBuildingPlot(id, pinned, rotation);
    if (current && current.x === target.x && current.z === target.z) { place(pinned); return; }
    pinned = point; updatePreview();
  };
  const refuseBuilding = (reason: string) => {
    options.onNotice?.(reason);
    announcePlacementRefusal(reason, i18n);
  };
  const place = (point: Point | null = picked()) => {
    if (!point || !(options.canCommand?.() ?? true)) return;
    if (decoration.active()) { decoration.update(point); void decoration.place(); return; }
    if (building !== null) {
      faceRoad(point);
      const plot = snapBuildingPlot(building, point, rotation);
      const result = simulation.placeBuilding(building, plot.x, plot.z, rotation);
      if (!result.ok) { refuseBuilding(result.reason ?? "Cannot place here"); return; }
      if (result.building) {
        options.onPlaced?.(result.building);
        options.onMessage?.("Building plan placed. Connect its road endpoint to another road.");
      }
      pinned = null; updatePreview(); return;
    }
    if (road !== null && isBridgeRoadMode(road)) {
      const target = bridgeClickTarget(point);
      if (!start) {
        if (!simulation.bridgeBankSafe(target)) {
          options.onNotice?.(translateDomainText("Select a clear shore bank for the bridge stock point.", i18n));
          return;
        }
        start = target;
        options.onNotice?.(translateDomainText("Bank selected. Click the river span to build.", i18n));
        updatePreview(); return;
      }
      const result = simulation.buildBridge(target, bridgeKindForMode(road), start);
      if (!result.ok) {
        options.onNotice?.(bridgeFailureText(result.reason, i18n));
        updatePreview(); return;
      }
      options.onMessage?.(translateDomainText(
        `${result.plan.kind === "wood" ? "Wooden" : "Stone"} bridge started: ${result.plan.tiles} tiles, ` +
        `${bridgeCostText(result.cost, i18n)} delivered to the shore stock point.`, i18n));
      start = null; updatePreview(); return;
    }
    if (road !== null && isRoadVergeMode(road)) {
      const kind = roadVergeKindFromMode(road);
      const target = roadPoint(point);
      if (!start) {
        start = target;
        options.onNotice?.(translateMessage(i18n, M.debug.placement.vergeStart));
        updatePreview(); return;
      }
      if (start.x === target.x && start.z === target.z) return;
      const preview = simulation.previewRoadVerge(start, target, kind);
      if (!preview.ok) {
        options.onNotice?.(roadVergeRefusalText(preview.reason, i18n));
        updatePreview(); return;
      }
      const result = simulation.plantRoadVerge(start, target, kind);
      if (!result.ok) {
        options.onNotice?.(roadVergeRefusalText(result.reason, i18n));
        updatePreview(); return;
      }
      options.onMessage?.(roadVergeOrderedText(preview, i18n));
      start = null; changed(); updatePreview(); return;
    }
    if (road === "remove") {
      const bridgeSite = nearestBridgeSite(point);
      if (bridgeSite) {
        const cancelled = simulation.cancelBridgeConstruction(bridgeSite.id);
        options.onMessage?.(translateDomainText(cancelled
          ? "Bridge construction cancelled; delivered materials return to storage."
          : "Bridge construction is no longer there.", i18n));
        updatePreview(); return;
      }
      const vergeSite = simulation.nearestRoadVergeSite(point);
      if (vergeSite) {
        const cancelled = simulation.cancelRoadVerge(vergeSite.siteUid);
        options.onMessage?.(translateMessage(i18n, cancelled ? M.debug.placement.vergeCancelled
          : M.debug.placement.vergeCancelGone));
        updatePreview(); return;
      }
      const section = nearestRoadSection(point, simulation.roadSegments());
      const removed = section && simulation.removeRoad(section.start, section.end);
      if (removed) options.onMessage?.("Road section removed.");
      else options.onNotice?.("Choose a public road section.");
      updatePreview(); return;
    }
    const target = survey === "Geologist" ? point : roadPoint(point);
    if (survey) {
      const result = options.onSurvey?.(survey, target);
      if (!result?.ok) { options.onNotice?.(result?.reason ?? "Surveying is unavailable"); return; }
      options.onMessage?.(`${survey} dispatched from storage.`); cancel(); return;
    }
    if (!start) { start = target; options.onNotice?.("Choose the road's second endpoint."); updatePreview(); return; }
    if (start.x === target.x && start.z === target.z) return;
    const targetTier = road !== null && road !== "dirt" ? road : null;
    const ok = targetTier ? simulation.upgradeRoad(start, target, targetTier)
      : simulation.connectRoads(start, target);
    options.onMessage?.(roadResultMessage(ok, targetTier, i18n));
    if (ok) start = null;
    changed(); updatePreview();
  };
  const listen = <K extends keyof HTMLElementEventMap>(type: K, action: (event: HTMLElementEventMap[K]) => void) =>
    canvas.addEventListener(type, action, { capture: true, signal });
  listen("pointerdown", (event) => {
    if (!isInteracting()) return;
    setPointer(event);
    if (event.button === 2) {
      event.stopImmediatePropagation(); event.preventDefault(); suppressContextMenu = true; cancel(); return;
    }
    pointers.add(event.pointerId);
    if (press) { press.maxPointers = Math.max(press.maxPointers, pointers.size); return; }
    if (event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(),
      maxPointers: pointers.size, moved: 0 };
    canvas.setPointerCapture(event.pointerId);
  });
  // Camera gestures may transfer pointer capture from the canvas to the viewport.
  // Match the original canvas press globally so release is never lost to that transfer.
  window.addEventListener("pointerdown", (event) => {
    if (!press || press.id === event.pointerId) return;
    pointers.add(event.pointerId);
    press.maxPointers = Math.max(press.maxPointers, pointers.size);
  }, { capture: true, signal });
  window.addEventListener("pointermove", (event) => {
    if (!isInteracting() || (!press && event.target !== canvas)) return;
    setPointer(event);
    if (event.pointerType === "mouse") pinned = null;
    if (press) press.moved = Math.max(press.moved, Math.hypot(event.clientX - press.x, event.clientY - press.y));
    updatePreview();
  }, { capture: true, signal });
  window.addEventListener("pointerup", (event) => {
    if (!isInteracting() || !press) return;
    pointers.delete(event.pointerId); setPointer(event);
    if (press?.id !== event.pointerId) return;
    const finished = press; press = null;
    finished.moved = Math.max(finished.moved, Math.hypot(event.clientX - finished.x, event.clientY - finished.y));
    if (classifyPress({ durationMs: performance.now() - finished.time, maxPointers: finished.maxPointers,
      movedPixels: finished.moved }) === "tap" &&
      !document.elementFromPoint(event.clientX, event.clientY)?.closest(".settlement-ui")) {
      if (building !== null && event.pointerType !== "mouse") tapBuilding(building);
      else place();
    }
  }, { capture: true, signal });
  window.addEventListener("pointercancel", () => { press = null; pointers.clear(); }, { capture: true, signal });
  listen("pointerleave", () => { if (!press && !pinned) { pointer = null; updatePreview(); } });
  listen("contextmenu", (event) => {
    if (!isInteracting() && !suppressContextMenu) return;
    suppressContextMenu = false; event.preventDefault(); event.stopImmediatePropagation(); cancel();
  });
  window.addEventListener("keydown", (event) => {
    if (!isInteracting() || event.repeat || editableTarget(event.target)) return;
    if (event.key === "Escape") { cancel(); event.preventDefault(); }
    else if (event.key.toLowerCase() === "r" && (building !== null || decoration.active()) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (decoration.active()) decoration.rotate();
      else { manualRotation = true; rotation = (rotation + 1) % 4; }
      changed(); updatePreview(); event.preventDefault();
    }
  }, { signal });
  return {
    selectBuilding: (id: number | null) => {
      decoration.cancel();
      manualRotation = false; facingKey = "";
      building = id === 0 ? null : id; road = null; survey = null; start = null; pinned = null;
      if (id === 0) options.onMessage?.("Headquarters is the starting building."); changed(); updatePreview(); },
    selectRoad: (mode: RoadMode) => {
      decoration.cancel();
      road = mode; building = null; survey = null; start = null; pinned = null; changed(); updatePreview();
    },
    selectSurvey: (job: SurveyJob | null) => { decoration.cancel(); survey = job; building = null; road = null; start = null; changed(); updatePreview(); },
    selectRoadDecoration: (item: RoadDecorationItemId) => { cancel(); decoration.select(item); changed(); updatePreview(); },
    moveRoadDecoration: createRoadDecorationMoveControl({ canCommand: options.canCommand, cancel,
      changed: () => { changed(); updatePreview(); }, move: decoration.move }),
    roadDecorationGhost: decoration.ghost,
    selectedSurvey: () => survey,
    rotate: () => {
      if (decoration.active()) decoration.rotate();
      else if (building !== null) { manualRotation = true; rotation = (rotation + 1) % 4; }
      else return;
      changed(); updatePreview();
    },
    cancel, selectedBuilding: () => building, selectedRoad: () => road, rotation: () => rotation,
    isInteracting, updatePreview, roadPreview: () => roadPreview,
    /** The building ghost of the latest preview (null: no building is being placed). */
    ghost: () => check?.ghost ?? null,
    dispose: () => { events.abort(); overlay.remove(); }
  };
};
