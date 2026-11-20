import { isShiftDragSelecting } from "../../render-common/camera-input-mode";
import { TAP_MAX_MOVE_PIXELS } from "../../render-common/pointer-gestures";
import type { ScreenBox } from "../worker-selection";
import { boxFromCorners, type ScreenPoint } from "./army-selection";

interface BoxPress { from: ScreenPoint; moved: boolean; pointerId: number }

/**
 * While active (the rail's touch-first "Box select"), and on every device with Shift held (§5.1), a left /
 * one-finger drag that starts on the map `surface` draws a selection box; `onSelect` receives it in
 * `element` coordinates. A second finger (a pinch) cancels the box.
 */
export const createArmyBoxSelect = (options: {
  element: HTMLElement;
  surface: HTMLElement;
  onSelect: (box: ScreenBox) => void;
}) => {
  const { element, surface } = options;
  const events = new AbortController();
  const rectangle = document.createElement("div");
  rectangle.className = "army-box-select"; rectangle.hidden = true;
  element.append(rectangle);
  let active = false;
  let press: BoxPress | null = null;
  const local = (event: PointerEvent): ScreenPoint => {
    const bounds = element.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const cancel = () => { press = null; rectangle.hidden = true; };
  const draw = (box: ScreenBox) => {
    Object.assign(rectangle.style, { height: `${box.bottom - box.top}px`, left: `${box.left}px`,
      top: `${box.top}px`, width: `${box.right - box.left}px` });
    rectangle.hidden = false;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (press) { cancel(); return; }
    if (event.button !== 0 || !event.isPrimary || event.target !== surface) return;
    if (!active && !isShiftDragSelecting(event)) return;
    press = { from: local(event), moved: false, pointerId: event.pointerId };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const point = local(event);
    // A press that moves past a tap draws the box (a tap stays a click).
    press.moved ||= Math.hypot(point.x - press.from.x, point.y - press.from.y) > TAP_MAX_MOVE_PIXELS;
    if (press.moved) draw(boxFromCorners(press.from, point));
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { from, moved } = press;
    cancel();
    if (moved && event.type === "pointerup") options.onSelect(boxFromCorners(from, local(event)));
  };
  const signal = events.signal;
  element.addEventListener("pointerdown", onPointerDown, { signal });
  element.addEventListener("pointermove", onPointerMove, { signal });
  element.addEventListener("pointerup", onPointerUp, { signal });
  element.addEventListener("pointercancel", onPointerUp, { signal });
  return {
    setActive: (value: boolean) => { active = value; if (!value) cancel(); },
    dispose: () => { events.abort(); rectangle.remove(); }
  };
};
