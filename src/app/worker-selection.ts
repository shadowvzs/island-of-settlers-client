import type { TerrainRenderer } from "../render-common/renderer-contract";
import { WORKER_HEIGHT } from "../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../render-common/workers/worker-unit";

type Projector = Pick<TerrainRenderer, "projectToViewport">;

/** A selection rectangle in viewport CSS pixels. */
export interface ScreenBox {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** Whether a viewport point lies on the worker's figure (its foot to head axis, widened). */
export const isWorkerUnderPointer = (
  renderer: Projector,
  worker: WorkerFrame,
  x: number,
  y: number
) => {
  const foot = renderer.projectToViewport(worker.x, worker.y, worker.z);
  const head = renderer.projectToViewport(worker.x, worker.y + WORKER_HEIGHT, worker.z);
  // Depth is NDC z of the active camera; hit testing uses the screen coordinates only.
  if (![foot.x, foot.y, head.x, head.y].every(Number.isFinite)) return false;
  const h = Math.hypot(foot.x - head.x, foot.y - head.y),
    radius = Math.max(9, h * 0.28);
  const dx = foot.x - head.x,
    dy = foot.y - head.y,
    length = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - head.x) * dx + (y - head.y) * dy) / Math.max(1, length)));
  return Math.hypot(x - head.x - dx * t, y - head.y - dy * t) <= radius;
};

/**
 * The worker under the pointer, or -1. Overlapping figures: the one standing lowest on screen
 * (nearest the camera in every view) wins.
 */
export const pickWorkerAt = (
  renderer: Projector,
  workers: readonly WorkerFrame[],
  x: number,
  y: number
) => {
  let picked = -1;
  let pickedFootY = -Infinity;
  workers.forEach((worker, index) => {
    if (!isWorkerUnderPointer(renderer, worker, x, y)) return;
    const footY = renderer.projectToViewport(worker.x, worker.y, worker.z).y;
    if (footY <= pickedFootY) return;
    picked = index;
    pickedFootY = footY;
  });
  return picked;
};

/** The box spanned by a drag from (startX, startY) to (endX, endY), in any direction. */
export const toScreenBox = (startX: number, startY: number, endX: number, endY: number) => ({
  bottom: Math.max(startY, endY),
  left: Math.min(startX, endX),
  right: Math.max(startX, endX),
  top: Math.min(startY, endY)
});

export const isInsideBox = (box: ScreenBox, x: number, y: number) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** Selection flags of a box: the workers whose body centre is projected inside it. */
export const listWorkersInBox = (
  renderer: Projector,
  workers: readonly WorkerFrame[],
  box: ScreenBox
) =>
  workers.map((worker) => {
    const center = renderer.projectToViewport(worker.x, worker.y + WORKER_HEIGHT / 2, worker.z);
    return isInsideBox(box, center.x, center.y);
  });

/** Selection flags after a click: only the hit worker (none on empty ground), or a toggle. */
export const selectionAfterClick = (
  workers: readonly WorkerFrame[],
  hit: number,
  toggle: boolean
) =>
  workers.map((worker, index) => {
    if (!toggle) return index === hit;
    return index === hit ? !worker.selected : worker.selected;
  });
