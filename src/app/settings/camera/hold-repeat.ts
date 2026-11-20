/** Seconds of movement applied by a tap (pointer down or a keyboard click). */
const TAP_SECONDS = 0.12;
/** Longest frame gap a held button integrates. */
const MAX_HOLD_FRAME_SECONDS = 0.05;

/** The parts of a pointer event a hold reads (a DOM or React pointer event). */
export interface HoldPointerEvent {
  button: number;
  currentTarget: Element;
  pointerId: number;
}

/**
 * A camera button that keeps acting while held, outside React: a press applies one tap and starts a frame
 * loop that mutates the camera directly; it stops on release, lost capture, or once the button is hidden
 * or removed. Keyboard clicks (no pointer) apply one tap.
 */
export const createHoldRepeat = (apply: (seconds: number) => void) => {
  let held: Element | null = null;
  let lastTime = 0;
  let running = false;
  const frame = (time: number) => {
    if (!held || !held.isConnected || held.closest("[hidden]")) {
      held = null;
      running = false;
      return;
    }
    apply(Math.min((time - lastTime) / 1000, MAX_HOLD_FRAME_SECONDS));
    lastTime = time;
    requestAnimationFrame(frame);
  };
  return {
    click: (detail: number) => {
      if (detail === 0) apply(TAP_SECONDS);
    },
    press: ({ button, currentTarget, pointerId }: HoldPointerEvent) => {
      if (button !== 0) return;
      currentTarget.setPointerCapture(pointerId);
      apply(TAP_SECONDS);
      held = currentTarget;
      lastTime = performance.now();
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    },
    release: () => { held = null; }
  };
};

export type HoldRepeat = ReturnType<typeof createHoldRepeat>;
