import { registerSettlementWindowOrder } from "./window-order";

/**
 * Keep the movable panel within the screen, including touch devices and resized viewports. It stays above the
 * settlement bar found in `getScope()` (the panel's parent unless given).
 */
export const makeSettlementPanelDraggable = (
  panel: HTMLElement, handle: HTMLElement, getScope: () => Element | null = () => panel.parentElement
) => {
  const events = new AbortController();
  const { signal } = events;
  const activate = registerSettlementWindowOrder(panel, signal);
  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
  const move = (left: number, top: number) => {
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const bar = getScope()?.querySelector(".settlement-ui__bar");
    const bottom = bar?.getBoundingClientRect().top ?? window.innerHeight - 82;
    const maxTop = Math.max(0, bottom - panel.offsetHeight - 12);
    panel.style.left = `${Math.max(0, Math.min(maxLeft, left))}px`;
    panel.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
    panel.style.bottom = "auto";
    panel.style.right = "auto";
  };
  handle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || (event.target as Element).closest("button, input, select")) return;
      const bounds = panel.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: bounds.left,
        top: bounds.top
      };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("is-dragging");
      event.preventDefault();
    },
    { signal }
  );
  handle.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      move(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    },
    { signal }
  );
  const stop = () => {
    drag = undefined;
    panel.classList.remove("is-dragging");
  };
  handle.addEventListener("pointerup", stop, { signal });
  handle.addEventListener("pointercancel", stop, { signal });
  handle.addEventListener("lostpointercapture", stop, { signal });
  handle.addEventListener(
    "keydown",
    (event) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      };
      const direction = directions[event.key];
      if (!direction) return;
      const bounds = panel.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 12;
      move(bounds.left + direction[0] * step, bounds.top + direction[1] * step);
      event.preventDefault();
    },
    { signal }
  );
  const constrain = () => {
    if (!panel.style.top || panel.hidden) return;
    // A panel hidden by its owner's CSS has no layout box. Clamping that zero rect would overwrite
    // the saved drag position with (0, 0) before the window is shown again.
    if (!panel.offsetWidth || !panel.offsetHeight) return;
    const bounds = panel.getBoundingClientRect();
    move(bounds.left, bounds.top);
  };
  window.addEventListener("resize", constrain, { signal });
  const observer = new ResizeObserver(constrain);
  observer.observe(panel);
  return {
    activate,
    constrain,
    dispose: () => {
      events.abort();
      observer.disconnect();
    }
  };
};
