import type { TerrainRenderer } from "../render-common/renderer-contract";
import type { WorkerGroup } from "../render-common/workers/worker-group";
import { createClickDetector, createLongPressDetector } from "./click-detector";
import { createBoxSelect } from "./worker-box-select";
import { listWorkersInBox, pickWorkerAt, selectionAfterClick } from "./worker-selection";

export interface WorkerInputOptions {
  enabled?: () => boolean;
  /** Box selection applies (no map editor tool is active: then Shift + drag pans). */
  canBoxSelect: () => boolean;
  /** The map canvas. */
  canvas: HTMLElement;
  group: Pick<WorkerGroup, "command" | "frames" | "select">;
  renderer: TerrainRenderer;
  viewport: HTMLElement;
}

/**
 * Worker input: left click selects the worker under the pointer (or clears the selection),
 * Shift + click toggles one, Shift + left drag box-selects, right click (a long press on touch)
 * sends the selection.
 * Every pick uses the renderer's last frame projection, so it works with every camera.
 */
export const createWorkerInput = (options: WorkerInputOptions) => {
  const { group, renderer, viewport } = options;
  const pick = (x: number, y: number) =>
    options.enabled?.() === false ? -1 : pickWorkerAt(renderer, group.frames, x, y);
  const selectAt = (x: number, y: number, toggle: boolean) =>
    options.enabled?.() === false
      ? undefined
      : group.select(selectionAfterClick(group.frames, pick(x, y), toggle));
  const left = createClickDetector(viewport, (x, y) => selectAt(x, y, false));
  const commandAt = (x: number, y: number) => {
    if (options.enabled?.() === false) return;
    if (!group.frames.some((frame) => frame.selected)) return;
    const point = renderer.pickGround(x, y);
    if (point) group.command(point.x, point.z);
  };
  const right = createClickDetector(viewport, commandAt, 2);
  const longPress = createLongPressDetector(viewport, commandAt);
  const box = createBoxSelect({
    canStart: options.canBoxSelect,
    canvas: options.canvas,
    onBox: (screenBox) => group.select(listWorkersInBox(renderer, group.frames, screenBox)),
    onShiftClick: (x, y) => selectAt(x, y, true),
    viewport
  });
  const context = (event: MouseEvent) => event.preventDefault();
  viewport.addEventListener("contextmenu", context);
  return {
    dispose: () => {
      left();
      right();
      longPress();
      box();
      viewport.removeEventListener("contextmenu", context);
    }
  };
};
