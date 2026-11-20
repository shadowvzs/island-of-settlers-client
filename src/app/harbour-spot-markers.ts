import type { TerrainRenderer } from "../render-common/renderer-contract";
import { storedHarbourSpots } from "../shared/settlement/harbour-spot-index";
import { sampleSmooth } from "../shared/world/grid-geometry";
import type { HarbourSpot, WorldData } from "../shared/world/world-data";

/**
 * HARBOUR-SPOTS markers (owner 2026-11-09): the generator's stored harbour plots drawn on a 2D overlay,
 * projected with the renderer's camera. "subtle" is the game's hint while a harbour is being placed;
 * "prominent" is the map editor's (author must see exactly where a harbour can be built).
 */
export type HarbourSpotMarkerStyle = "prominent" | "subtle";

interface MarkerLook {
  arrow: boolean;
  fill: string;
  halo: string;
  haloWidth: number;
  line: string;
  lineWidth: number;
}

const LOOKS: Record<HarbourSpotMarkerStyle, MarkerLook> = {
  prominent: { arrow: true, fill: "rgb(40 170 255 / 30%)", halo: "rgb(8 20 40 / 80%)", haloWidth: 6,
    line: "#3ec8ff", lineWidth: 3 },
  subtle: { arrow: false, fill: "rgb(150 215 255 / 14%)", halo: "rgb(8 20 40 / 35%)", haloWidth: 3.5,
    line: "rgb(190 235 255 / 70%)", lineWidth: 1.5 }
};
/** Half the 6×6 harbour footprint (cells) and the lift that keeps the outline off the ground. */
const HALF_FOOTPRINT = 3;
const LIFT = .08;
/** The berth arrow points towards the berth water but stops this far (cells) from the plot centre. */
const MAX_ARROW_CELLS = 9;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

type Project = TerrainRenderer["projectToViewport"];

const projectGround = (world: WorldData, project: Project, x: number, z: number) =>
  project(x, sampleSmooth(world, world.heights, x, z) + LIFT, z);

const tracePlot = (context: CanvasRenderingContext2D, world: WorldData, project: Project, spot: HarbourSpot) => {
  context.beginPath();
  CORNERS.forEach(([dx, dz], index) => {
    const point = projectGround(world, project, spot.x + dx * HALF_FOOTPRINT, spot.z + dz * HALF_FOOTPRINT);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
};

/** A short arrow from the plot towards its berth water point: the side ships will moor on. */
const traceBerthArrow = (context: CanvasRenderingContext2D, world: WorldData, project: Project,
  spot: HarbourSpot) => {
  const from = projectGround(world, project, spot.x, spot.z);
  const dx = spot.water.x - spot.x, dz = spot.water.z - spot.z, length = Math.hypot(dx, dz) || 1;
  const reach = Math.min(length, MAX_ARROW_CELLS) / length;
  const to = project(spot.x + dx * reach, world.seaLevel + LIFT, spot.z + dz * reach);
  const angle = Math.atan2(to.y - from.y, to.x - from.x), head = 10;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.moveTo(to.x - Math.cos(angle - .5) * head, to.y - Math.sin(angle - .5) * head);
  context.lineTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle + .5) * head, to.y - Math.sin(angle + .5) * head);
};

const stroke = (context: CanvasRenderingContext2D, look: MarkerLook) => {
  context.lineWidth = look.haloWidth;
  context.strokeStyle = look.halo;
  context.stroke();
  context.lineWidth = look.lineWidth;
  context.strokeStyle = look.line;
  context.stroke();
};

const drawLabel = (context: CanvasRenderingContext2D, world: WorldData, project: Project, spot: HarbourSpot,
  label: string) => {
  const point = projectGround(world, project, spot.x, spot.z);
  context.font = "600 13px system-ui, sans-serif";
  context.textAlign = "center";
  context.lineWidth = 4;
  context.strokeStyle = "rgb(8 20 40 / 85%)";
  context.strokeText(label, point.x, point.y - 4);
  context.fillStyle = "#e8f8ff";
  context.fillText(label, point.x, point.y - 4);
};

/** True when the map stores harbour spots (the layer has something to show). */
export const hasHarbourSpotMarkers = (world: WorldData) => storedHarbourSpots(world).length > 0;

/**
 * Draws every stored spot, or only `spots` (the caller cleared the canvas and set its transform). A handful of
 * plots, four projected corners each: no terrain or navigation work.
 */
export const drawHarbourSpotMarkers = (context: CanvasRenderingContext2D, world: WorldData, project: Project,
  style: HarbourSpotMarkerStyle, label?: string, spots: readonly HarbourSpot[] = storedHarbourSpots(world)) => {
  const look = LOOKS[style];
  context.lineJoin = "round";
  for (const spot of spots) {
    tracePlot(context, world, project, spot);
    context.fillStyle = look.fill;
    context.fill();
    stroke(context, look);
    if (look.arrow) {
      traceBerthArrow(context, world, project, spot);
      stroke(context, look);
    }
    if (label) drawLabel(context, world, project, spot, label);
  }
};
