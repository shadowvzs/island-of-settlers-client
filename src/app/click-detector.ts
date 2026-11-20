import {
  classifyPress,
  LONG_PRESS_MS,
  TAP_MAX_MOVE_PIXELS
} from "../render-common/pointer-gestures";

interface Press {
  maxPointers: number;
  pointerId: number;
  pointerType: string;
  time: number;
  x: number;
  y: number;
}

type PressListener = (event: PointerEvent) => void;

/** The event position relative to the element (CSS pixels). */
const toElementPoint = (element: HTMLElement, event: PointerEvent) => {
  const bounds = element.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
};

const getMovedPixels = (press: Press, event: PointerEvent) =>
  Math.hypot(event.clientX - press.x, event.clientY - press.y);

const listen = (element: HTMLElement, listeners: Record<string, PressListener>) => {
  for (const [type, listener] of Object.entries(listeners)) {
    element.addEventListener(type, listener as EventListener);
  }
  return () => {
    for (const [type, listener] of Object.entries(listeners)) {
      element.removeEventListener(type, listener as EventListener);
    }
  };
};

/**
 * Follows one press of `button` on the element; any further pointer down meanwhile (a second
 * finger) is counted, so a pinch never ends as a click. A primary pointer down (no other
 * pointer of its kind is down) starts afresh.
 */
const trackPresses = (
  element: HTMLElement,
  button: number,
  handlers: {
    /** The press ended: released (`pointerup`) or cancelled by the browser. */
    onEnd?: (press: Press, event: PointerEvent) => void;
    onMove?: (press: Press, event: PointerEvent) => void;
    onStart?: (press: Press) => void;
  }
) => {
  const down = new Set<number>();
  let press: Press | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.isPrimary) down.clear();
    down.add(event.pointerId);
    if (press) {
      press.maxPointers = Math.max(press.maxPointers, down.size);
      return;
    }
    if (down.size > 1 || event.button !== button) return;
    const { clientX: x, clientY: y, pointerId, pointerType } = event;
    press = { maxPointers: 1, pointerId, pointerType, time: performance.now(), x, y };
    handlers.onStart?.(press);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (press?.pointerId === event.pointerId) handlers.onMove?.(press, event);
  };
  const onPointerUp = (event: PointerEvent) => {
    down.delete(event.pointerId);
    if (press?.pointerId !== event.pointerId) return;
    const finished = press;
    press = null;
    handlers.onEnd?.(finished, event);
  };
  return listen(element, {
    pointercancel: onPointerUp,
    pointerdown: onPointerDown,
    pointermove: onPointerMove,
    pointerup: onPointerUp
  });
};

/**
 * Short presses that barely move are clicks (a tap on touch); longer or moving presses stay
 * camera drags, and a press joined by a second finger (a pinch) is none either.
 * Reports the position relative to the element (CSS pixels).
 */
export const createClickDetector = (
  element: HTMLElement,
  onClick: (x: number, y: number, event: PointerEvent) => void,
  button = 0
) =>
  trackPresses(element, button, {
    onEnd: (press, event) => {
      if (event.type !== "pointerup") return;
      const kind = classifyPress({
        durationMs: performance.now() - press.time,
        maxPointers: press.maxPointers,
        movedPixels: getMovedPixels(press, event)
      });
      if (kind !== "tap") return;
      const point = toElementPoint(element, event);
      onClick(point.x, point.y, event);
    }
  });

/**
 * A still one-finger touch press held LONG_PRESS_MS (the touch right click): fires while the
 * finger is still down; moving it or a second finger cancels.
 */
export const createLongPressDetector = (
  element: HTMLElement,
  onLongPress: (x: number, y: number) => void
) => {
  let timer = 0;
  const cancel = () => window.clearTimeout(timer);
  const stop = trackPresses(element, 0, {
    onEnd: cancel,
    onMove: (press, event) => {
      if (getMovedPixels(press, event) > TAP_MAX_MOVE_PIXELS) cancel();
    },
    onStart: (press) => {
      cancel();
      if (press.pointerType !== "touch") return;
      timer = window.setTimeout(() => {
        if (press.maxPointers > 1) return;
        const bounds = element.getBoundingClientRect();
        onLongPress(press.x - bounds.left, press.y - bounds.top);
      }, LONG_PRESS_MS);
    }
  });
  return () => {
    cancel();
    stop();
  };
};
