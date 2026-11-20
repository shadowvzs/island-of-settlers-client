import { WATER_COLORS } from "../app/minimap/minimap-image";
import { MATERIAL } from "../shared/world/world-data";
import {
  type Context,
  createIconCanvas,
  fillWithTile,
  OUTLINE,
  type Point,
  toCss,
  toPath} from "./relief-icons";

/** The mark on a map icon's badge: what the action does with the map. */
export type MapMark = "delete" | "load" | "new" | "save";

const BADGE: Point = [372, 372];
const BADGE_RADIUS = 112;
const BADGE_COLORS: Record<MapMark, string> = {
  delete: "rgb(196 64 58)",
  load: "rgb(52 120 186)",
  new: "rgb(64 146 84)",
  save: "rgb(52 120 186)"
};
const GLYPH = "rgb(250 250 246)";

/** The island on the sheet: a meadow blob with a sandy rim in the sea. */
const ISLAND: readonly Point[] = [
  [150, 170],
  [214, 128],
  [292, 140],
  [338, 196],
  [318, 262],
  [250, 300],
  [176, 290],
  [128, 236]
];

/** A sheet of map paper (sand tile, lightened) with a painted island, slightly turned. */
const drawMapSheet = (context: Context) => {
  context.save();
  context.translate(236, 236);
  context.rotate(-0.08);
  context.translate(-236, -236);
  const sheet = new Path2D();
  sheet.roundRect(40, 56, 392, 360, 28);
  fillWithTile(context, MATERIAL.sand, sheet);
  context.fillStyle = "rgb(255 246 222 / 45%)";
  context.fill(sheet);
  const sea = new Path2D();
  sea.roundRect(84, 96, 304, 240, 18);
  context.fillStyle = toCss(WATER_COLORS.shallow);
  context.fill(sea);
  context.lineWidth = 22;
  context.strokeStyle = "rgb(214 196 150)";
  context.lineJoin = "round";
  context.stroke(toPath(ISLAND));
  fillWithTile(context, MATERIAL.grass, toPath(ISLAND));
  context.lineWidth = 8;
  context.strokeStyle = OUTLINE;
  context.stroke(sheet);
  context.restore();
};

/** An arrow along the badge's vertical axis (down: into the file, up: out of it). */
const drawArrow = (context: Context, direction: 1 | -1) => {
  const [x, y] = BADGE;
  const tip = y + direction * 62;
  context.beginPath();
  context.moveTo(x, y - direction * 60);
  context.lineTo(x, tip - direction * 20);
  context.stroke();
  context.fill(
    toPath([
      [x - 48, tip - direction * 44],
      [x + 48, tip - direction * 44],
      [x, tip]
    ])
  );
};

const drawCross = (context: Context, angle: number) => {
  const [x, y] = BADGE;
  const reach = 56;
  for (const turn of [angle, angle + Math.PI / 2]) {
    context.beginPath();
    context.moveTo(x - Math.cos(turn) * reach, y - Math.sin(turn) * reach);
    context.lineTo(x + Math.cos(turn) * reach, y + Math.sin(turn) * reach);
    context.stroke();
  }
};

const GLYPHS: Record<MapMark, (context: Context) => void> = {
  delete: (context) => drawCross(context, Math.PI / 4),
  load: (context) => drawArrow(context, -1),
  new: (context) => drawCross(context, 0),
  save: (context) => drawArrow(context, 1)
};

/** The round badge with the action's glyph. */
const drawBadge = (context: Context, mark: MapMark) => {
  const badge = new Path2D();
  badge.arc(BADGE[0], BADGE[1], BADGE_RADIUS, 0, Math.PI * 2);
  context.fillStyle = BADGE_COLORS[mark];
  context.fill(badge);
  context.lineWidth = 10;
  context.strokeStyle = OUTLINE;
  context.stroke(badge);
  context.fillStyle = GLYPH;
  context.strokeStyle = GLYPH;
  context.lineCap = "round";
  context.lineWidth = 30;
  GLYPHS[mark](context);
};

/** A map action (original glyph): a map sheet with a badge (save, load, new slot, delete). */
export const renderMapIcon = (mark: MapMark) => {
  const { canvas, context } = createIconCanvas();
  drawMapSheet(context);
  drawBadge(context, mark);
  return canvas;
};
