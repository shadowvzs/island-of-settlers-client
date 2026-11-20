export interface ExplorationInputListenerHandlers {
  onBlur: () => void;
  onDocumentMouseMove: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onPointerLockChange: () => void;
  onPointerLockError: () => void;
  onViewportChange: () => void;
  onVisibilityChange: () => void;
}

/** Window/document listeners that clear held input or drive pointer lock; returned cleanup is idempotent. */
export const bindExplorationInputListeners = (
  win: Window,
  doc: Document,
  handlers: ExplorationInputListenerHandlers
) => {
  win.addEventListener("keydown", handlers.onKeyDown as EventListener, { capture: true });
  win.addEventListener("keyup", handlers.onKeyUp as EventListener, { capture: true });
  win.addEventListener("blur", handlers.onBlur);
  win.addEventListener("orientationchange", handlers.onViewportChange);
  win.addEventListener("resize", handlers.onViewportChange);
  doc.addEventListener("mousemove", handlers.onDocumentMouseMove as EventListener);
  doc.addEventListener("pointerlockchange", handlers.onPointerLockChange);
  doc.addEventListener("pointerlockerror", handlers.onPointerLockError);
  doc.addEventListener("visibilitychange", handlers.onVisibilityChange);
  win.screen?.orientation?.addEventListener?.("change", handlers.onViewportChange);
  return () => {
    win.removeEventListener("keydown", handlers.onKeyDown as EventListener, { capture: true });
    win.removeEventListener("keyup", handlers.onKeyUp as EventListener, { capture: true });
    win.removeEventListener("blur", handlers.onBlur);
    win.removeEventListener("orientationchange", handlers.onViewportChange);
    win.removeEventListener("resize", handlers.onViewportChange);
    doc.removeEventListener("mousemove", handlers.onDocumentMouseMove as EventListener);
    doc.removeEventListener("pointerlockchange", handlers.onPointerLockChange);
    doc.removeEventListener("pointerlockerror", handlers.onPointerLockError);
    doc.removeEventListener("visibilitychange", handlers.onVisibilityChange);
    win.screen?.orientation?.removeEventListener?.("change", handlers.onViewportChange);
  };
};
