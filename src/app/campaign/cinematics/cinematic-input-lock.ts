/**
 * CIN3 input lock (plan section 3.7): while cinematic mode is on, the map gets no pointer, wheel or touch input and
 * the game no hotkeys. It listens on the window in the capture phase and stops the event there, so the Escape
 * chain never runs (no window closes). Escape (and Space without a line) is a skip press; Space, Enter and a click
 * advance the shown speak line. Cinematic UI marked `data-cinematic-ui` keeps its own pointer input.
 */
import {
  CINEMATIC_ADVANCE_CODES, CINEMATIC_ADVANCE_OR_SKIP_CODES, CINEMATIC_LOCKED_POINTER_EVENTS, CINEMATIC_SKIP_CODES,
  CINEMATIC_UI_SELECTOR
} from "./constants";

export interface CinematicInputLockOptions {
  /** True when a speak line consumed the advance. */
  onAdvance: () => boolean;
  onSkipPress: () => void;
  target: Pick<Window, "addEventListener" | "removeEventListener">;
  viewport: Pick<HTMLElement, "contains" | "dispatchEvent">;
}

const LISTENER_OPTIONS = { capture: true, passive: false } as const;

const insideCinematicUi = (target: EventTarget | null) =>
  typeof Element !== "undefined" && target instanceof Element && target.closest(CINEMATIC_UI_SELECTOR) !== null;

const swallow = (event: Event) => {
  event.stopImmediatePropagation();
  if (event.cancelable) event.preventDefault();
};

export const createCinematicInputLock = (options: CinematicInputLockOptions) => {
  const { target, viewport } = options;
  let active = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!active) return;
    // Game listeners never see the key; browser keys that are not ours keep their default (reload, devtools).
    event.stopImmediatePropagation();
    const handled = CINEMATIC_SKIP_CODES.has(event.code) || CINEMATIC_ADVANCE_CODES.has(event.code) ||
      CINEMATIC_ADVANCE_OR_SKIP_CODES.has(event.code);
    if (!handled) return;
    event.preventDefault();
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (CINEMATIC_SKIP_CODES.has(event.code)) options.onSkipPress();
    else if (CINEMATIC_ADVANCE_CODES.has(event.code)) options.onAdvance();
    else if (!options.onAdvance()) options.onSkipPress();
  };

  const onPointer = (event: Event) => {
    if (!active || insideCinematicUi(event.target)) return;
    if (!event.target || !viewport.contains(event.target as Node)) return;
    swallow(event);
    const pointer = event as PointerEvent;
    if (event.type === "pointerdown" && pointer.isPrimary && pointer.button === 0) options.onAdvance();
  };

  target.addEventListener("keydown", onKeyDown as EventListener, LISTENER_OPTIONS);
  for (const type of CINEMATIC_LOCKED_POINTER_EVENTS) target.addEventListener(type, onPointer, LISTENER_OPTIONS);

  return {
    active: () => active,
    dispose: () => {
      active = false;
      target.removeEventListener("keydown", onKeyDown as EventListener, LISTENER_OPTIONS);
      for (const type of CINEMATIC_LOCKED_POINTER_EVENTS) target.removeEventListener(type, onPointer, LISTENER_OPTIONS);
    },
    setActive: (next: boolean) => {
      if (next === active) return;
      active = next;
      // Hover feedback (tooltips, placement hover) clears when the map stops receiving pointer input.
      if (next && typeof MouseEvent !== "undefined") viewport.dispatchEvent(new MouseEvent("mouseleave"));
    }
  };
};

export type CinematicInputLock = ReturnType<typeof createCinematicInputLock>;
