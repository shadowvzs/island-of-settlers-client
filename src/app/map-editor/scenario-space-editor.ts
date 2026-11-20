import type { I18n } from "@lingui/core";

import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import { createScenarioWildlifeSnapshot } from "../../shared/settlement/scenario-wildlife-inspection";
import type { ScenarioWorldReport } from "../../shared/settlement/scenario-world-inspection";
import type { ResourceTarget } from "../../shared/settlement/settlement-types";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { getWorldRevision } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, fitOverlayCanvas } from "./overlay-canvas";
import { getNavigationPhaseText, getSpaceStageText } from "./progress-text";
import { inspectScenarioWorldInWorker } from "./scenario-world-inspection-worker";
import { createSectionStore } from "./section-store";

const drawSpaceReport = (
  world: WorldData,
  renderer: TerrainRenderer,
  canvas: HTMLCanvasElement,
  report: ScenarioWorldReport,
  i18n?: I18n
) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "12px system-ui";
  context.strokeStyle = "#d6be82";
  context.lineWidth = 2;
  for (const road of report.roads.slice(0, 2048)) {
    const points = [road.start, road.end].map((point) =>
      renderer.projectToViewport(
        point.x,
        sampleSmooth(world, world.heights, point.x, point.z) + 0.12,
        point.z
      )
    );
    context.beginPath();
    context.moveTo(points[0]!.x, points[0]!.y);
    context.lineTo(points[1]!.x, points[1]!.y);
    context.stroke();
  }
  // Component representatives and route waypoints are schematic; native planner evidence
  // includes curved manoeuvres, so straight chords must not masquerade as swept hulls.
  for (const component of report.navigation.walking?.components.slice(0, 128) ?? []) {
    const point = renderer.projectToViewport(component.x, sampleSmooth(world, world.heights, component.x, component.z) + .2, component.z);
    context.fillStyle = "#ffc67a";
    context.fillText(translateMessage(i18n, M.inspection.landComponent, {
      id: component.id, nodes: component.nodes
    }), point.x, point.y);
  }
  context.fillStyle = "#80d9ff";
  for (const route of report.navigation.routes.slice(0, 128))
    for (const waypoint of route.points.slice(0, 256)) {
      const point = renderer.projectToViewport(waypoint.x, sampleSmooth(world, world.heights, waypoint.x, waypoint.z) + .2, waypoint.z);
      context.fillRect(point.x - 2, point.y - 2, 4, 4);
    }
  for (const witness of report.workspaces)
    for (const point of witness.points) {
      const screen = renderer.projectToViewport(
        point.x,
        sampleSmooth(world, world.heights, point.x, point.z) + 0.18,
        point.z
      );
      if (screen.x < 0 || screen.y < 0 || screen.x > canvas.width || screen.y > canvas.height)
        continue;
      context.fillStyle = witness.outcome === "witness" ? "#a7f3b2" : "#ffda65";
      context.beginPath();
      context.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      context.fill();
    }
  for (const site of [...report.expansion, ...report.harbours]) {
    const colour = site.typeId === 39 ? "#80d9ff" : "#baff92";
    const screen = (x: number, z: number) =>
      renderer.projectToViewport(x, sampleSmooth(world, world.heights, x, z) + 0.15, z);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ].map(([dx, dz]) => screen(site.x + (dx! * site.width) / 2, site.z + (dz! * site.depth) / 2));
    context.strokeStyle = colour;
    context.lineWidth = 2;
    context.beginPath();
    corners.forEach((point, index) =>
      index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)
    );
    context.closePath();
    context.stroke();
    const point = screen(site.x, site.z);
    context.fillStyle = "#152019de";
    context.fillRect(point.x - 45, point.y - 16, 90, 19);
    context.fillStyle = colour;
    context.fillText(getBuildingDefinition(site.typeId).name, point.x - 41, point.y - 2);
  }
};

const FINDINGS_LIMIT = 256;
const ROAD_DRAW_LIMIT = 2048;

/** The report's summary line. */
const summarize = (report: ScenarioWorldReport): EditorText => {
  const witnessed = report.workspaces.filter((item) => item.outcome === "witness").length;
  const walking = report.navigation.walking;
  return editorMessage(M.inspection.connectivitySummary, {
    components: walking?.complete ? walking.components.length : M.inspection.unknown,
    errors: report.authoredErrors.length,
    footprints: report.startupSpatialProved ? M.inspection.witnessed : M.inspection.unknown,
    harbours: report.harbours.length,
    routes: report.navigation.routes.length,
    witnessed,
    workspaces: report.workspaces.length
  });
};

/** The listed findings (bounded), with notes when the list or the road overlay is limited. */
export const listSpaceFindings = (report: ScenarioWorldReport): EditorText[] => {
  const messages: EditorText[] = [...report.messages,
    ...report.navigation.findings.map(item => editorMessage(M.inspection.finding, {
      detail: item.detail, name: item.name, outcome: item.outcome.toUpperCase()
    })),
    ...report.navigation.roadErrors];
  if (!report.navigation.complete) messages.push(M.inspection.unfinishedNote);
  if (report.budgetExhausted) messages.push(M.inspection.budgetNote);
  const findings = messages.slice(0, FINDINGS_LIMIT);
  if (messages.length > FINDINGS_LIMIT) findings.push(M.inspection.findingLimit);
  if (report.roads.length > ROAD_DRAW_LIMIT) findings.push(M.inspection.roadLimit);
  return findings;
};

/** Advisory evidence only: authoring never changes terrain, occupancy, territory or naval routes. */
export const createScenarioSpaceEditor = (
  world: WorldData,
  viewport: HTMLElement,
  renderer: TerrainRenderer,
  isShown: () => boolean,
  getHuntingTargets?: () => readonly ResourceTarget[],
  i18n?: I18n
) => {
  const section = createSectionStore({
    authoredValidation: "",
    busy: false,
    findings: [] as readonly EditorText[],
    startupSpatial: "",
    summary: "" as EditorText
  });
  const setSummary = (summary: EditorText) => section.update({ summary });
  const canvas = createOverlayCanvas(viewport);
  let report: ScenarioWorldReport | undefined;
  let revision = "",
    scenario = world.scenario,
    heights = world.heights,
    water = world.waterSurface;
  let lastProjection = "";
  const stamp = () =>
    getWorldRevision(world, { props: true, tier: true });
  let inspection: AbortController | undefined;
  const clearEvidence = () => section.update({ authoredValidation: "", startupSpatial: "" });
  const cancelInspection = () => {
    inspection?.abort();
    inspection = undefined;
    section.update({ busy: false });
  };
  const inspect = () => {
    cancelInspection();
    const job = new AbortController();
    inspection = job;
    const original = {
      revision: stamp(),
      scenario: world.scenario,
      heights: world.heights,
      water: world.waterSurface
    };
    const isCurrent = () =>
      !document.hidden && isShown() &&
      original.revision === stamp() &&
      original.scenario === world.scenario &&
      original.heights === world.heights &&
      original.water === world.waterSurface;
    report = undefined;
    canvas.hidden = true;
    clearEvidence();
    section.update({ busy: true, findings: [] });
    setSummary(M.inspection.checking);
    void inspectScenarioWorldInWorker(world, {
      wildlife: getHuntingTargets ? createScenarioWildlifeSnapshot(getHuntingTargets()) : undefined,
      maxMilliseconds: 5000,
      navigationMilliseconds: 30000,
      onPhase: (phase) => { if (inspection === job)
        setSummary(editorMessage(M.inspection.phase, { phase: getNavigationPhaseText(phase) })); },
      signal: job.signal,
      isCurrent,
      onProgress: (progress) => {
        if (inspection !== job) return;
        setSummary(editorMessage(M.inspection.progress, {
          expansionChecks: progress.expansionChecks,
          harbourChecks: progress.harbourChecks,
          plots: progress.plots,
          stage: getSpaceStageText(progress.stage)
        }));
      }
    })
      .then((result) => {
        if (inspection !== job) return;
        report = result;
        revision = stamp();
        scenario = world.scenario;
        heights = world.heights;
        water = world.waterSurface;
        lastProjection = "";
        section.update({
          authoredValidation: report.authoredErrors.length ? "errors" : "clear",
          findings: listSpaceFindings(report),
          startupSpatial: report.startupSpatialProved ? "witness" : "unknown",
          summary: summarize(report)
        });
      })
      .catch(() => {
        if (inspection === job) {
          report = undefined;
          clearEvidence();
          setSummary(M.inspection.failed);
        }
      })
      .finally(() => {
        if (inspection === job) cancelInspection();
      });
  };
  const clear = () => {
    cancelInspection();
    report = undefined;
    canvas.hidden = true;
    clearEvidence();
    setSummary(M.inspection.cancelled);
  };
  const draw = (visible: boolean) => {
    if (inspection && (!visible || !isShown())) {
      cancelInspection();
      clearEvidence();
      setSummary(M.inspection.cancelledHidden);
    }
    canvas.hidden = !visible || !report;
    if (!visible || !report) return;
    if (
      revision !== stamp() ||
      scenario !== world.scenario ||
      heights !== world.heights ||
      water !== world.waterSurface
    ) {
      report = undefined;
      canvas.hidden = true;
      clearEvidence();
      setSummary(M.inspection.mapChanged);
      return;
    }
    const projection =
      `${viewport.clientWidth}/${viewport.clientHeight}/` +
      [
        [0, 0, 0],
        [world.cellsX, 0, 0],
        [0, 0, world.cellsZ],
        [0, 10, 0]
      ]
        .map(([x, y, z]) => {
          const point = renderer.projectToViewport(x!, y!, z!);
          return `${point.x}/${point.y}/${point.depth}`;
        })
        .join("/");
    if (projection === lastProjection) return;
    lastProjection = projection;
    if (fitOverlayCanvas(canvas, viewport)) drawSpaceReport(world, renderer, canvas, report, i18n);
  };
  return { clear, draw, inspect, section };
};

export type ScenarioSpaceEditor = ReturnType<typeof createScenarioSpaceEditor>;
