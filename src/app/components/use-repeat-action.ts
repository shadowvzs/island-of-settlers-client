import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";

/** One step on press, then repeats while held; keyboard/accessibility clicks still step once. */
export const useRepeatAction = (action: () => void, enabled = true) => {
  const currentAction = useRef(action);
  useEffect(() => { currentAction.current = action; }, [action]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const stop = useCallback(() => {
    held.current = false;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => {
    if (!enabled) { stop(); return; }
    const onVisibility = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, stop]);
  return {
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (enabled && event.detail === 0) currentAction.current();
    },
    onLostPointerCapture: stop,
    onPointerCancel: stop,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!enabled || event.button !== 0) return;
      stop();
      held.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      currentAction.current();
      const repeat = () => {
        if (!held.current) return;
        currentAction.current();
        timer.current = setTimeout(repeat, 60);
      };
      timer.current = setTimeout(repeat, 300);
    },
    onPointerUp: stop
  };
};
