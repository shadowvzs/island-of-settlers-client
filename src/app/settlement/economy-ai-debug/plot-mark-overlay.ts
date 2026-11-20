import type { TerrainRenderer } from "../../../render-common/renderer-contract";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import type { WorldData } from "../../../shared/world/world-data";
import { createOverlayCanvas, fitCanvasToViewport, isOnScreen } from "../../helpers";
import { PLOT_MARK_COLOURS, PLOT_MARK_FONT, PLOT_MARK_LABEL_OFFSET, PLOT_MARK_RADIUS } from "./constants";
import type { EconomyAiPlotMark } from "./types";

interface PlotMarkOverlayOptions {
  renderer: Pick<TerrainRenderer, "projectToViewport">;
  viewport: HTMLElement;
  world: WorldData;
}

/**
 * The "why" window's map marks (like the military AI overlay's labels): a dot and a short label on every plot the
 * planner refused or still considers, projected with the renderer's last camera. It draws only while it holds
 * marks: without them there is no frame callback.
 */
export const createPlotMarkOverlay = ({ renderer, viewport, world }: PlotMarkOverlayOptions) => {
  const canvas = createOverlayCanvas(viewport, "economy-ai-plot-marks");
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d")!;
  let marks: readonly EconomyAiPlotMark[] = [], frame = 0;

  const drawMark = ({ kind, label, x, z }: EconomyAiPlotMark) => {
    const point = renderer.projectToViewport(x, sampleSmooth(world, world.heights, x, z), z);
    if (!isOnScreen(point)) return;
    context.fillStyle = PLOT_MARK_COLOURS[kind];
    context.beginPath();
    context.arc(point.x, point.y, PLOT_MARK_RADIUS, 0, Math.PI * 2);
    context.fill();
    const width = context.measureText(label).width + PLOT_MARK_LABEL_OFFSET;
    const left = point.x + PLOT_MARK_LABEL_OFFSET;
    context.fillRect(left, point.y - PLOT_MARK_LABEL_OFFSET, width, PLOT_MARK_LABEL_OFFSET * 2);
    context.fillStyle = PLOT_MARK_COLOURS.text;
    context.fillText(label, left + PLOT_MARK_LABEL_OFFSET / 2, point.y);
  };
  const clear = () => {
    const ratio = fitCanvasToViewport(canvas, viewport);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, viewport.clientWidth, viewport.clientHeight);
  };
  const draw = () => {
    frame = 0;
    clear();
    if (!marks.length) return;
    context.font = PLOT_MARK_FONT;
    context.textBaseline = "middle";
    marks.forEach(drawMark);
    frame = requestAnimationFrame(draw);
  };
  return {
    dispose: () => {
      cancelAnimationFrame(frame);
      canvas.remove();
    },
    setMarks: (next: readonly EconomyAiPlotMark[]) => {
      marks = next;
      canvas.hidden = !next.length;
      if (!frame) frame = requestAnimationFrame(draw);
    }
  };
};
