interface DebugClickModeOptions {
  /** Shown when the mode turns on: what to click and how to leave. Resolved at display time. */
  activeMessage: string | (() => string);
  cancelPlacement: () => void;
  /** Shown when the mode turns off. Resolved at display time. */
  inactiveMessage: string | (() => string);
  message: (text: string, warning?: boolean) => void;
  onClick: (x: number, y: number) => void;
}

const resolveMessage = (message: string | (() => string)) =>
  typeof message === "function" ? message() : message;

/**
 * A Development toggle that takes over map clicks while on: Escape or its button turns it off, and the
 * watcher (the button's active state) hears every switch.
 */
export const createDebugClickMode = (options: DebugClickModeOptions) => {
  const { message } = options;
  let active = false;
  let listener: ((active: boolean) => void) | undefined;
  let cancelRightClick = false;
  const events = new AbortController();
  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    if (next) options.cancelPlacement();
    message(resolveMessage(next ? options.activeMessage : options.inactiveMessage));
    listener?.(next);
  };
  window.addEventListener("keydown", event => {
    if (!active || event.key !== "Escape") return;
    setActive(false); event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  window.addEventListener("pointerdown", event => {
    if (!active || event.button !== 2) return;
    cancelRightClick = true;
    setActive(false); event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  window.addEventListener("pointerup", event => {
    if (!cancelRightClick || event.button !== 2) return;
    event.preventDefault(); event.stopImmediatePropagation();
    setTimeout(() => { cancelRightClick = false; }, 0);
  }, { capture: true, signal: events.signal });
  window.addEventListener("contextmenu", event => {
    if (!active && !cancelRightClick) return;
    setActive(false); cancelRightClick = false;
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  return {
    active: () => active,
    click: options.onClick,
    dispose: () => events.abort(),
    set: setActive,
    watch: (onChange: (active: boolean) => void) => { listener = onChange; }
  };
};

export type DebugClickMode = ReturnType<typeof createDebugClickMode>;
