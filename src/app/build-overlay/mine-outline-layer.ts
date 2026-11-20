import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { ORE_COLORS, type Rgb } from "../minimap/minimap-image";
import type { ViewBounds } from "./build-spots";
import {
  type CellOutline,
  type DepositOutline,
  getMineOutlineKey,
  type MineOutlines,
  traceMineOutlines} from "./mine-outline";

/** Halo under every line: dark (light lines) or pale (dark lines), so it reads on snow too. */
const HALO = { dark: "rgb(20 16 12 / 70%)", pale: "rgb(246 240 226 / 85%)" } as const;
/** The mine land border: warm amber over a dark halo (gravel, grass and snow alike). */
const MINE_LAND_LINE = "#ffc23d";
/** Line widths (CSS px): halo and line of the mine land, then of the surveyed deposits. */
const WIDTH = { depositHalo: 6, depositLine: 3, halo: 5.5, line: 2.75 } as const;
/** Opacity of the ore tint inside a surveyed deposit. */
const DEPOSIT_TINT_ALPHA = 0.22;
/** Outlines a bit beyond the view still drawn (their lines enter the screen). */
const VIEW_MARGIN = 2;

const toCss = ([red, green, blue]: Rgb, alpha = 1) => `rgb(${red} ${green} ${blue} / ${alpha})`;

/** Pale halo under dark ore lines (coal), dark halo under the light ones. */
const getHaloFor = ([red, green, blue]: Rgb) =>
  red * 0.3 + green * 0.59 + blue * 0.11 < 90 ? HALO.pale : HALO.dark;

const overlapsView = (outline: CellOutline, view: ViewBounds) =>
  outline.maxX >= view.minX - VIEW_MARGIN &&
  outline.minX <= view.maxX + VIEW_MARGIN &&
  outline.maxZ >= view.minZ - VIEW_MARGIN &&
  outline.minZ <= view.maxZ + VIEW_MARGIN;

/** Strokes a halo, then the line over it, along the current path. */
const strokeWithHalo = (
  context: CanvasRenderingContext2D,
  colors: { halo: string; line: string },
  widths: { halo: number; line: number }
) => {
  context.lineWidth = widths.halo;
  context.strokeStyle = colors.halo;
  context.stroke();
  context.lineWidth = widths.line;
  context.strokeStyle = colors.line;
  context.stroke();
};

/**
 * Mine field outlines of the build overlay: the mine land border (amber) and every surveyed ore
 * deposit (its ore colour), following the cell borders over the terrain, projected with the
 * renderer's camera. The outlines are traced once per mine land / survey change; a draw only
 * projects the corners of the outlines in view. The pulse is a CSS opacity animation of the
 * layer canvas (no redraw).
 */
export const createMineOutlineLayer = (
  world: WorldData,
  renderer: Pick<TerrainRenderer, "projectToViewport">
) => {
  let outlines: MineOutlines | null = null;
  let tracedKey = "";

  const getOutlines = () => {
    const key = getMineOutlineKey(world);
    if (!outlines || key !== tracedKey) outlines = traceMineOutlines(world);
    tracedKey = key;
    return outlines;
  };

  const addPath = (context: CanvasRenderingContext2D, outline: CellOutline) => {
    const { points } = outline;
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index]!;
      const z = points[index + 1]!;
      const point = renderer.projectToViewport(x, sampleSmooth(world, world.heights, x, z), z);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
  };

  const drawMineLand = (
    context: CanvasRenderingContext2D,
    list: CellOutline[],
    view: ViewBounds
  ) => {
    context.beginPath();
    for (const outline of list) if (overlapsView(outline, view)) addPath(context, outline);
    const colors = { halo: HALO.dark, line: MINE_LAND_LINE };
    strokeWithHalo(context, colors, { halo: WIDTH.halo, line: WIDTH.line });
  };

  /** A deposit: its loops as one path (holes stay open), a faint ore tint, then the line. */
  const drawDeposit = (
    context: CanvasRenderingContext2D,
    deposit: DepositOutline,
    view: ViewBounds
  ) => {
    const ore = ORE_COLORS[deposit.ore];
    if (!ore || !deposit.outlines.some((outline) => overlapsView(outline, view))) return;
    context.beginPath();
    for (const outline of deposit.outlines) addPath(context, outline);
    context.fillStyle = toCss(ore, DEPOSIT_TINT_ALPHA);
    context.fill("evenodd");
    const colors = { halo: getHaloFor(ore), line: toCss(ore) };
    strokeWithHalo(context, colors, { halo: WIDTH.depositHalo, line: WIDTH.depositLine });
  };

  return {
    /** Draws the outlines in view (the caller cleared the canvas and set its transform). */
    draw: (context: CanvasRenderingContext2D, view: ViewBounds) => {
      const found = getOutlines();
      context.lineJoin = "round";
      drawMineLand(context, found.mineLand, view);
      for (const deposit of found.deposits) drawDeposit(context, deposit, view);
    }
  };
};
