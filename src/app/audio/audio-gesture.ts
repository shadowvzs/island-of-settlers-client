interface GestureEvent { isTrusted?: boolean; repeat?: boolean }
interface GestureTarget {
  addEventListener: (type: string, listener: (event: GestureEvent) => void, capture: boolean) => void;
  removeEventListener: (type: string, listener: (event: GestureEvent) => void, capture: boolean) => void;
}

/** One capture pair shared by soundscape and music; records Start/Load gestures during async boot. */
export const createAudioGestureOwner = (target?: GestureTarget) => {
  const listeners = new Set<() => void>();
  let seen = false, bound = false;
  const unbind = () => {
    if (!bound) return;
    target?.removeEventListener("pointerdown", onGesture, true);
    target?.removeEventListener("keydown", onGesture, true);
    bound = false;
  };
  const onGesture = (event: GestureEvent) => {
    if (!event.isTrusted || event.repeat) return;
    seen = true;
    for (const listener of listeners) listener();
    if (!listeners.size) unbind();
  };
  const bind = () => {
    if (bound || !target) return;
    bound = true;
    target.addEventListener("pointerdown", onGesture, true);
    target.addEventListener("keydown", onGesture, true);
  };
  bind();
  return {
    hasSeenGesture: () => seen,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      bind();
      return () => { listeners.delete(listener); if (seen && !listeners.size) unbind(); };
    },
    dispose: () => { listeners.clear(); unbind(); }
  };
};

export const audioGestures = createAudioGestureOwner(typeof window === "undefined" ? undefined : window);
