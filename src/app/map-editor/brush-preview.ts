import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import { clamp } from "../../shared/world/noise";
import type { WorldData } from "../../shared/world/world-data";
import { createOverlayCanvas, fitCanvasToViewport } from "../helpers";

const RING_SEGMENTS = 48;
const RING_COLORS = { normal: "#f6f1de", refused: "#ff8a7a" } as const;
/** A selected object's ground ring: the colour of a selected soldier's ring. */
export const SELECTION_RING_COLOR = "#ffd15c";
const BADGE_FONT = "600 13px system-ui, sans-serif";
/** Badge offset from the ring centre on screen (CSS pixels, right and up of the cursor). */
const BADGE_OFFSET = { x: 14, y: -12 } as const;

/** The ring to draw: centre and radius on the ground (world units). */
export interface BrushRing {
  /** Short label next to the centre (a terrain tool: raise / lower and the level it gives). */
  badge?: string;
  radius: number;
  refused: boolean;
  x: number;
  z: number;
}

export interface BrushPreviewOptions {
  /** Ring colour while not refused (default: the brush's light ring). */
  color?: string;
  /** Ring stroke width in CSS pixels (a dark outline 2px wider underlines it). */
  lineWidth?: number;
  renderer: Pick<TerrainRenderer, "projectToViewport">;
  viewport: HTMLElement;
  world: WorldData;
}

/** The badge of a terrain ghost: up or down and the level the click gives ("▲ 4", "▼ 2"). */
export const formatGhostBadge = ({ level, raises }: { level: number; raises: boolean }) =>
  `${raises ? "▲" : "▼"} ${level}`;

/** Ring points on the ground (heights follow the terrain), clamped to the map. */
const listRingPoints = (world: WorldData, ring: BrushRing) =>
  Array.from({ length: RING_SEGMENTS + 1 }, (_, index) => {
    const angle = (index / RING_SEGMENTS) * Math.PI * 2;
    const x = clamp(ring.x + Math.cos(angle) * ring.radius, 0, world.cellsX);
    const z = clamp(ring.z + Math.sin(angle) * ring.radius, 0, world.cellsZ);
    return { x, y: sampleSmooth(world, world.heights, x, z), z };
  });

/**
 * The brush preview: a ring on the ground under the cursor, drawn in screen space over the map
 * with the renderer's own projection (every camera); red after a refused stamp. A
 * terrain tool's ring carries a badge: raise or lower and the level the click gives.
 */
export const createBrushPreview = ({
  color = RING_COLORS.normal, lineWidth = 1.5, renderer, viewport, world
}: BrushPreviewOptions) => {
  const canvas = createOverlayCanvas(viewport, "brush-preview");
  const context = canvas.getContext("2d")!;
  let shown = false;

  const traceRing = (ring: BrushRing) => {
    context.beginPath();
    listRingPoints(world, ring).forEach(({ x, y, z }, index) => {
      const point = renderer.projectToViewport(x, y, z);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
  };

  /** The badge beside the ring centre, on the ground height there (outlined for any ground). */
  const drawBadge = (ring: BrushRing) => {
    if (!ring.badge) return;
    const height = sampleSmooth(world, world.heights, ring.x, ring.z);
    const centre = renderer.projectToViewport(ring.x, height, ring.z);
    const x = centre.x + BADGE_OFFSET.x;
    const y = centre.y + BADGE_OFFSET.y;
    context.font = BADGE_FONT;
    context.lineWidth = 3;
    context.strokeStyle = "rgb(0 0 0 / 60%)";
    context.strokeText(ring.badge, x, y);
    context.fillStyle = ring.refused ? RING_COLORS.refused : color;
    context.fillText(ring.badge, x, y);
  };

  const draw = (ring: BrushRing | null) => {
    if (!ring && !shown) return;
    const ratio = fitCanvasToViewport(canvas, viewport);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    shown = ring !== null;
    if (!ring) return;
    traceRing(ring);
    context.lineWidth = lineWidth + 2;
    context.strokeStyle = "rgb(0 0 0 / 45%)";
    context.stroke();
    context.lineWidth = lineWidth;
    context.strokeStyle = ring.refused ? RING_COLORS.refused : color;
    context.stroke();
    drawBadge(ring);
  };

  return {
    dispose: () => canvas.remove(),
    draw
  };
};
