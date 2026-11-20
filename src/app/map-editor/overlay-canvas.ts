import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** A full-viewport 2D overlay above the map (inspection evidence, outlines); never takes pointer input. */
export const createOverlayCanvas = (viewport: HTMLElement) => {
  const canvas = document.createElement("canvas");
  canvas.className = "map-editor-overlay";
  canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5";
  canvas.setAttribute("aria-hidden", "true");
  viewport.append(canvas);
  return canvas;
};

/** Matches the overlay to the viewport size and clears it; null without a 2D context. */
export const fitOverlayCanvas = (canvas: HTMLCanvasElement, viewport: HTMLElement) => {
  if (canvas.width !== viewport.clientWidth) canvas.width = viewport.clientWidth;
  if (canvas.height !== viewport.clientHeight) canvas.height = viewport.clientHeight;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  return context;
};

const isOnCanvas = (canvas: HTMLCanvasElement, point: { x: number; y: number }) =>
  point.x >= 0 && point.y >= 0 && point.x <= canvas.width && point.y <= canvas.height;

/** A navigation clearance dot at a projected point: green when clear, red when blocked; skipped off canvas. */
export const drawClearanceDot = (
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, point: { x: number; y: number }, clear: boolean
) => {
  if (!isOnCanvas(canvas, point)) return;
  ctx.fillStyle = clear ? "#66ee99b0" : "#ff6666b0";
  ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fill();
};

/** Most boundary cells drawn per frame: a fragmented contour cannot raise projection work without bound. */
const MAX_BOUNDARY_DOTS = 2048;

/** Small squares on a contour's boundary cells, `lift` above the ground or water surface. */
export const drawBoundaryCells = (
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, renderer: TerrainRenderer, world: WorldData,
  boundary: ArrayLike<number>, lift: number, colour: string
) => {
  ctx.fillStyle = colour;
  const stride = Math.max(1, Math.ceil(boundary.length / MAX_BOUNDARY_DOTS));
  for (let i = 0; i < boundary.length; i += stride) {
    const cell = boundary[i]!, x = cell % world.cellsX + .5, z = Math.floor(cell / world.cellsX) + .5;
    const y = Math.max(sampleSmooth(world, world.heights, x, z), sampleSmooth(world, world.waterSurface, x, z));
    const point = renderer.projectToViewport(x, y + lift, z);
    if (isOnCanvas(canvas, point)) ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
  }
};
