import type { BridgePreview } from "../../shared/settlement/bridge-construction-runtime";
import type { BridgePlan } from "../../shared/settlement/bridge-planning";
import type { BridgeSpot } from "../../shared/settlement/bridge-spots";

type Point = { x: number; z: number };
type Project = (point: Point) => { x: number; y: number };
type Trace = (points: Point[], close?: boolean) => void;

/** Most crossings outlined at once, nearest the pointer first (the building overlay caps ghosts too). */
const SHOWN_SPOTS = 48;

const SPOT_STYLE = {
  "needs-road": { fill: "#e8bb7e1f", stroke: "#e8bb7eb3" },
  ready: { fill: "#b2e4b326", stroke: "#d9edb6cc" }
} as const;

const traceDeck = (trace: Trace, plan: Pick<BridgePlan, "deckWidth" | "end" | "start">) => {
  const dx = plan.end.x - plan.start.x, dz = plan.end.z - plan.start.z;
  const length = Math.hypot(dx, dz) || 1, half = plan.deckWidth / 2;
  const nx = -dz / length * half, nz = dx / length * half;
  trace([
    { x: plan.start.x + nx, z: plan.start.z + nz },
    { x: plan.end.x + nx, z: plan.end.z + nz },
    { x: plan.end.x - nx, z: plan.end.z - nz },
    { x: plan.start.x - nx, z: plan.start.z - nz }
  ], true);
};

const anchorDot = (
  context: CanvasRenderingContext2D, project: Project, shore: Point, radius: number, fill: string
) => {
  const screen = project(shore);
  context.beginPath(); context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.fillStyle = fill; context.fill();
  context.strokeStyle = "#4a4337"; context.lineWidth = 1.5; context.stroke();
};

/** The hovered (snapped) crossing: deck outline plus both golden or red road-connection markers. */
export const drawBridgePreview = (
  context: CanvasRenderingContext2D,
  project: Project,
  trace: Trace,
  plan: BridgePlan,
  preview: BridgePreview
) => {
  traceDeck(trace, plan);
  context.fillStyle = preview.ok ? "#b2e4b333" : "#e3645633";
  context.fill(); context.strokeStyle = preview.ok ? "#d9edb6" : "#ff9385";
  context.lineWidth = 2; context.stroke();
  anchorDot(context, project, plan.start, 6, preview.connections.start ? "#e8bb7e" : "#ff9385");
  anchorDot(context, project, plan.end, 6, preview.connections.end ? "#e8bb7e" : "#ff9385");
};

/**
 * Every buildable crossing near the pointer as a faint dashed deck outline: green when it can be
 * built now, amber when a shore road or storage connection is still missing.
 */
export const drawBridgeSpots = (
  context: CanvasRenderingContext2D,
  project: Project,
  trace: Trace,
  spots: readonly BridgeSpot[],
  focus: Point,
  hovered: BridgeSpot | null
) => {
  const gap = (spot: BridgeSpot) => Math.hypot(
    (spot.plan.start.x + spot.plan.end.x) / 2 - focus.x, (spot.plan.start.z + spot.plan.end.z) / 2 - focus.z);
  const nearest = [...spots].sort((a, b) => gap(a) - gap(b)).slice(0, SHOWN_SPOTS);
  context.setLineDash([5, 4]);
  for (const spot of nearest) {
    if (spot === hovered) continue;
    const style = SPOT_STYLE[spot.status];
    traceDeck(trace, spot.plan);
    context.fillStyle = style.fill; context.fill();
    context.strokeStyle = style.stroke; context.lineWidth = 1.5; context.stroke();
  }
  context.setLineDash([]);
  for (const spot of nearest) {
    if (spot === hovered) continue;
    anchorDot(context, project, spot.plan.start, 3.5, "#e8bb7e");
    anchorDot(context, project, spot.plan.end, 3.5, "#e8bb7e");
  }
};
