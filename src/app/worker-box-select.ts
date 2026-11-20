import { type ScreenBox,toScreenBox } from "./worker-selection";

/** A Shift press that moves less than this (CSS pixels) is a Shift + click, not a box. */
const CLICK_MOVE_PIXELS = 6;

export interface BoxSelectOptions {
  /** The map canvas: only presses on it start a box (not the panels above it). */
  canvas: HTMLElement;
  /** Box selection applies (no map editor tool is active). */
  canStart: () => boolean;
  onBox: (box: ScreenBox) => void;
  /** A Shift + click without a drag (viewport CSS pixels). */
  onShiftClick: (x: number, y: number) => void;
  viewport: HTMLElement;
}

const createBoxElement = (viewport: HTMLElement) => {
  const element = document.createElement("div");
  element.className = "selection-box";
  element.hidden = true;
  viewport.append(element);
  return element;
};

const drawBox = (element: HTMLElement, box: ScreenBox) => {
  element.style.transform = `translate(${box.left}px, ${box.top}px)`;
  element.style.width = `${box.right - box.left}px`;
  element.style.height = `${box.bottom - box.top}px`;
};

/**
 * Shift + left drag on the map draws a selection box (a DOM overlay without pointer events);
 * the press is captured on the viewport before the camera, felling, editor and click input
 * see it, so the camera does not pan meanwhile.
 */
export const createBoxSelect = (options: BoxSelectOptions) => {
  const { canvas, viewport } = options;
  const element = createBoxElement(viewport);
  let start: { x: number; y: number } | null = null;

  const toViewportPoint = (event: PointerEvent) => {
    const bounds = viewport.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.shiftKey || event.target !== canvas) return;
    if (!options.canStart()) return;
    event.stopPropagation();
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    start = toViewportPoint(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!start) return;
    const point = toViewportPoint(event);
    element.hidden = false;
    drawBox(element, toScreenBox(start.x, start.y, point.x, point.y));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!start) return;
    const point = toViewportPoint(event);
    const moved = Math.hypot(point.x - start.x, point.y - start.y);
    const box = toScreenBox(start.x, start.y, point.x, point.y);
    start = null;
    element.hidden = true;
    if (moved <= CLICK_MOVE_PIXELS) options.onShiftClick(point.x, point.y);
    else options.onBox(box);
  };

  const onPointerCancel = () => {
    start = null;
    element.hidden = true;
  };

  viewport.addEventListener("pointerdown", onPointerDown, { capture: true });
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerCancel);
  return () => {
    viewport.removeEventListener("pointerdown", onPointerDown, { capture: true });
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", onPointerUp);
    viewport.removeEventListener("pointercancel", onPointerCancel);
    element.remove();
  };
};
