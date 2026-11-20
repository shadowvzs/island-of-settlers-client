import { useMemo } from "react";

import { type ExternalStore,useExternalStore } from "../../components/external-store";
import { getActiveClassName, joinClassNames } from "../../components/helpers";
import type { ZoomControl, ZoomDirection } from "./zoom-control";

const VIEW_BUTTON_CLASS = "camera-control-button";
const ZOOM_BUTTON_CLASS = "settings__icon camera-control-button";

const createZoomHandlers = (zoom: ZoomControl, direction: ZoomDirection) => ({
  onClick: (event: { detail: number }) => zoom.click(direction, event.detail),
  onPointerDown: (event: { button: number }) => zoom.press(direction, event.button)
});

/**
 * Camera panel values: the zoom buttons' limit state and the cinematic toggle (both external stores that
 * publish only on a change), with stable zoom handlers.
 */
export const useCameraPanel = (zoom: ZoomControl, cinematic: ExternalStore<boolean>) => {
  const limits = useExternalStore(zoom.limits);
  const cinematicActive = useExternalStore(cinematic);
  const handlers = useMemo(() => ({ zoomIn: createZoomHandlers(zoom, 1), zoomOut: createZoomHandlers(zoom, -1) }),
    [zoom]);
  return {
    cinematicClassName: joinClassNames(VIEW_BUTTON_CLASS, getActiveClassName(cinematicActive)),
    cinematicPressed: cinematicActive,
    viewClassName: VIEW_BUTTON_CLASS,
    zoomClassName: ZOOM_BUTTON_CLASS,
    zoomIn: { ...handlers.zoomIn, disabled: !limits.canZoomIn },
    zoomOut: { ...handlers.zoomOut, disabled: !limits.canZoomOut }
  };
};
