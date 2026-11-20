import type { ViewportPoint } from "../../../render-common/iso-projection";
import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementPoint } from "../../../shared/settlement/settlement-types";
import { isOnScreen } from "../../helpers";
import { ARMY_QUEUE_WAYPOINT_RADIUS, SVG_NAMESPACE } from "./constants";
import { type ArmyQueueRoute, groupCentre, selectedQueueRoutes } from "./helpers";

import "./queue-waypoints.css";

interface DrawnRoute {
  /** Live actor objects of the members (the simulation moves them in place): the line starts at their mean. */
  bodies: readonly SettlementActor[];
  steps: ArmyQueueRoute["steps"];
}

export interface ArmyQueueWaypointOptions {
  /** Ground height at a world point (the markers sit on the terrain). */
  groundHeight: (x: number, z: number) => number;
  mount: HTMLElement;
  /** The renderer's last-frame projection (follows rotated and cinematic cameras). */
  project: (x: number, y: number, z: number) => ViewportPoint;
  selected: () => ReadonlySet<number>;
  simulation: Pick<SettlementSimulation, "frames" | "militaryOrderQueues">;
}

const createSvgElement = <Name extends "circle" | "polyline" | "svg">(name: Name) =>
  document.createElementNS(SVG_NAMESPACE, name);

/**
 * Shift-queue waypoints of the selected soldier groups: a dashed line from each group through its queued points and
 * a dot per step in the order's tone. One pooled SVG under the window layer, re-projected each animation frame only
 * while a selected group has a queue; no GPU resources, so it costs the same on every preset (Minimal-safe). The
 * queue data is read on `refresh` (selection changes, orders and the HUD's half-second update).
 */
export const createArmyQueueWaypoints = (options: ArmyQueueWaypointOptions) => {
  const svg = createSvgElement("svg");
  svg.classList.add("army-queue-waypoints");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "none";
  options.mount.append(svg);
  const lines: SVGPolylineElement[] = [];
  const dots: SVGCircleElement[] = [];
  let routes: DrawnRoute[] = [];
  let frame = 0;

  const pooledLine = (index: number) => {
    const line = lines[index] ?? svg.appendChild(createSvgElement("polyline"));
    lines[index] = line;
    line.classList.add("army-queue-waypoints__route");
    return line;
  };
  const pooledDot = (index: number) => {
    const dot = dots[index] ?? svg.appendChild(createSvgElement("circle"));
    dots[index] = dot;
    dot.classList.add("army-queue-waypoints__step");
    dot.setAttribute("r", ARMY_QUEUE_WAYPOINT_RADIUS);
    return dot;
  };
  const toScreen = (point: SettlementPoint) =>
    options.project(point.x, options.groundHeight(point.x, point.z), point.z);
  /** Draws one route from `dotIndex`; returns the next free dot index. */
  const drawRoute = (route: DrawnRoute, line: SVGPolylineElement, dotIndex: number) => {
    const coordinates: string[] = [];
    const centre = groupCentre(route.bodies);
    const start = centre && toScreen(centre);
    if (start && isOnScreen(start)) coordinates.push(`${start.x},${start.y}`);
    let next = dotIndex;
    for (const step of route.steps) {
      const point = toScreen(step);
      if (!isOnScreen(point)) continue;
      coordinates.push(`${point.x},${point.y}`);
      const dot = pooledDot(next++);
      dot.setAttribute("cx", `${point.x}`);
      dot.setAttribute("cy", `${point.y}`);
      dot.dataset.order = step.tone;
      dot.style.display = "";
    }
    line.setAttribute("points", coordinates.join(" "));
    line.style.display = "";
    return next;
  };
  const draw = () => {
    let dotIndex = 0;
    routes.forEach((route, index) => { dotIndex = drawRoute(route, pooledLine(index), dotIndex); });
    for (let index = routes.length; index < lines.length; index++) lines[index]!.style.display = "none";
    for (let index = dotIndex; index < dots.length; index++) dots[index]!.style.display = "none";
  };
  const loop = () => {
    frame = requestAnimationFrame(loop);
    draw();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    svg.style.display = "none";
  };
  /** Re-reads the selected groups' queues; the frame loop runs only while one has steps to show. */
  const refresh = () => {
    const selected = options.selected();
    const selectedRoutes = selected.size ? selectedQueueRoutes(options.simulation.militaryOrderQueues(), selected) : [];
    if (!selectedRoutes.length) { routes = []; stop(); return; }
    const actors = new Map(options.simulation.frames().map(actor => [actor.uid, actor]));
    routes = selectedRoutes.map(route => ({
      bodies: route.members.flatMap(uid => actors.get(uid) ?? []), steps: route.steps
    }));
    svg.style.display = "";
    if (!frame) frame = requestAnimationFrame(loop);
  };
  return {
    refresh,
    dispose: () => { stop(); svg.remove(); }
  };
};
