interface MapToolCancelOptions {
  active: () => boolean;
  cancel: () => void;
  surface: HTMLElement;
}

/** Cancels the pending map tool before camera/worker commands see the same right click. */
export const createMapToolCancel = ({ active, cancel, surface }: MapToolCancelOptions) => {
  const target = surface.ownerDocument.defaultView;
  // These events may arrive in either order; clear each as it arrives instead of keeping a stale gesture latch.
  let rightReleasePending = false;
  let rightContextPending = false;
  const consume = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const overSurface = (event: Event) => event.composedPath().includes(surface);
  const onDown = (event: PointerEvent) => {
    // A new gesture ends suppression, even if the previous release happened outside the window.
    rightReleasePending = false;
    rightContextPending = false;
    if (event.button !== 2 || !overSurface(event) || !active()) return;
    rightReleasePending = true;
    rightContextPending = true;
    cancel();
    consume(event);
  };
  const onUp = (event: PointerEvent) => {
    if (event.button !== 2 || !rightReleasePending) return;
    rightReleasePending = false;
    consume(event);
  };
  const onContext = (event: MouseEvent) => {
    if (!rightContextPending) {
      if (!overSurface(event) || !active()) return;
      cancel();
    }
    rightContextPending = false;
    consume(event);
  };
  target?.addEventListener("pointerdown", onDown, true);
  target?.addEventListener("pointerup", onUp, true);
  target?.addEventListener("contextmenu", onContext, true);
  return () => {
    target?.removeEventListener("pointerdown", onDown, true);
    target?.removeEventListener("pointerup", onUp, true);
    target?.removeEventListener("contextmenu", onContext, true);
  };
};
