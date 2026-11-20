import type { I18n } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { ROAD_APPEARANCE } from "../../render-common/road-appearance";
import { translateMessage } from "../../shared/i18n/translate";
import { ROAD_TIERS } from "../../shared/settlement/road-types";
import { rotatedFootprint } from "../../shared/settlement/settlement-debug-raise";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, fitOverlayCanvas } from "./overlay-canvas";

/** Projection follows the active camera; authored definitions remain untouched. */
export const createScenarioRoadOverlay = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  i18n?: I18n) => {
  const canvas = createOverlayCanvas(viewport);
  return (visible: boolean) => {
    const scenario = world.scenario;
    canvas.hidden = !visible || !scenario;
    if (!visible || !scenario) return;
    const context = fitOverlayCanvas(canvas, viewport); if (!context) return;
    const screen = (point: { x: number; z: number }) => renderer.projectToViewport(point.x,
      sampleSmooth(world, world.heights, point.x, point.z) + .15, point.z);
    for (const tier of ROAD_TIERS) {
      context.strokeStyle = ROAD_APPEARANCE[tier].colour;
      context.lineWidth = tier !== "dirt" ? 4 : 3; context.beginPath();
      for (const road of scenario.roads ?? []) {
        if (road.tier !== tier) continue;
        const start = screen(road.start), end = screen(road.end);
        context.moveTo(start.x, start.y); context.lineTo(end.x, end.y);
      }
      context.stroke();
    }
    const harbour = scenario.harbourPlot;
    if (!harbour) return;
    const { depth, width } = rotatedFootprint(39, harbour.rotation);
    context.strokeStyle = "#81e7ff"; context.lineWidth = 2; context.setLineDash([6, 3]); context.beginPath();
    for (const [index, [dx, dz]] of [[-1, -1], [1, -1], [1, 1], [-1, 1]].entries()) {
      const point = screen({ x: harbour.x + dx! * width / 2, z: harbour.z + dz! * depth / 2 });
      if (index) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
    }
    context.closePath(); context.stroke(); context.setLineDash([]);
    const centre = screen(harbour);
    context.fillStyle = "#81e7ff"; context.font = "12px system-ui";
    context.fillText(translateMessage(i18n, M.road.harbourReservation), centre.x - 55, centre.y);
  };
};
