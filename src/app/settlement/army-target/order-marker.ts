import type { ScreenPoint } from "../army-selection";
import { ARMY_TARGET_MARKER_MS } from "./constants";

import "./order-marker.css";

/**
 * The 0.6 s order marker at the clicked point: a ring in the order's tone, a red cross on a refusal.
 * One reused DOM element under the window layer, CSS animated: no GPU resources, Minimal-safe.
 */
export const createArmyOrderMarker = (viewport: HTMLElement) => {
  const element = document.createElement("div");
  element.className = "army-order-marker";
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  viewport.append(element);
  let timer = 0;
  const hide = () => { element.hidden = true; };
  return {
    show: (point: ScreenPoint, tone: string) => {
      window.clearTimeout(timer);
      element.dataset.order = tone;
      element.style.transform = `translate(${point.x}px, ${point.y}px)`;
      // Restart the CSS animation for a quick second order.
      element.hidden = true;
      void element.offsetWidth;
      element.hidden = false;
      timer = window.setTimeout(hide, ARMY_TARGET_MARKER_MS);
    },
    dispose: () => { window.clearTimeout(timer); element.remove(); }
  };
};
