import type { ViewportPoint } from "../render-common/iso-projection";
import type { ObservationSubject } from "./camera-follow";
import { selectedRoutePoints } from "./selected-route";

/** One SVG, at most 65 projected points, no Three meshes/draw calls or simulation commands. */
export const createSelectedRouteOverlay = (options: {
  viewport: HTMLElement;
  height: (x: number, z: number) => number;
  project: (x: number, y: number, z: number) => ViewportPoint;
  subject: () => ObservationSubject | null;
}) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("selected-route-overlay");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  const destination = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  destination.setAttribute("r", "4"); destination.setAttribute("fill", "#8bd7ff");
  destination.setAttribute("stroke", "#244b62"); destination.setAttribute("stroke-width", "2");
  destination.style.display = "none";
  svg.append(path, destination);
  options.viewport.append(svg);
  let enabled = false,
    age = 0;
  svg.style.display = "none";
  const setEnabled = (value: boolean) => {
    enabled = value;
    age = 1;
    if (!value) {
      svg.style.display = "none";
      path.removeAttribute("d");
      destination.style.display = "none";
    }
  };
  return {
    setEnabled,
    update: (delta: number) => {
      if (!enabled) return;
      age += delta;
      // Projection uses this frame's camera, capped at 20 updates/s while the selected overlay is on.
      if (age < 0.05) return;
      age = 0;
      const subject = options.subject();
      if (!subject) {
        setEnabled(false);
        return;
      }
      const route = subject.route?.();
      const points = selectedRoutePoints(subject, options.height, route);
      svg.style.display = points.length > 1 ? "block" : "none";
      let drawing = "",
        connected = false;
      for (const point of points) {
        const screen = options.project(point.x, point.y, point.z);
        if (
          ![screen.depth, screen.x, screen.y].every(Number.isFinite) ||
          screen.depth < -1 ||
          screen.depth > 1 ||
          Math.abs(screen.x) > 1e6 ||
          Math.abs(screen.y) > 1e6
        ) {
          connected = false;
          continue;
        }
        drawing += `${connected ? "L" : "M"}${screen.x.toFixed(1)},${screen.y.toFixed(1)} `;
        connected = true;
      }
      path.setAttribute("d", drawing);
      destination.style.display = "none";
      const target = route?.destination;
      if (target && [target.x, target.z].every(Number.isFinite)) {
        const y = route?.surfaceY ?? options.height(target.x, target.z);
        if (Number.isFinite(y)) {
          const goal = options.project(target.x, y + .15, target.z);
          if ([goal.x, goal.y, goal.depth].every(Number.isFinite) && goal.depth >= -1 && goal.depth <= 1 &&
            Math.abs(goal.x) < 1e6 && Math.abs(goal.y) < 1e6) {
            destination.setAttribute("cx", goal.x.toFixed(1)); destination.setAttribute("cy", goal.y.toFixed(1));
            destination.style.display = "block";
          }
        }
      }
    },
    dispose: () => {
      setEnabled(false);
      svg.remove();
    }
  };
};
