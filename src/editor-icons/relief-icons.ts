import { WATER_COLORS } from "../app/minimap/minimap-image";
import { MATERIAL } from "../shared/world/world-data";
import { paintTile } from "./ground-icons";
import { createCanvas, getContext } from "./icon-fit";

/** Drawing size of the relief and eraser icons (scaled down to the icon later). */
export const SIZE = 512;
export const OUTLINE = "rgb(20 26 30 / 70%)";

export type Context = CanvasRenderingContext2D;
export type Point = readonly [number, number];

export const toCss = ([red, green, blue]: readonly number[]) => `rgb(${red} ${green} ${blue})`;

/** Fills a path with a material's painted tile (the terrain's own texture). */
export const fillWithTile = (context: Context, material: number, path: Path2D) => {
  context.save();
  context.clip(path);
  context.drawImage(paintTile(material), 0, 0, SIZE, SIZE);
  context.restore();
};

export const toPath = (points: readonly Point[]) => {
  const path = new Path2D();
  points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  return path;
};

export const createIconCanvas = () => {
  const canvas = createCanvas(SIZE, SIZE);
  return { canvas, context: getContext(canvas) };
};

const PEAK: readonly Point[] = [
  [40, 430],
  [150, 250],
  [205, 190],
  [262, 70],
  [330, 170],
  [372, 200],
  [472, 430]
];
const SNOW: readonly Point[] = [
  [205, 190],
  [262, 70],
  [330, 170],
  [316, 196],
  [292, 222],
  [266, 204],
  [240, 236],
  [222, 214]
];
/** The shaded (east) face: the ridge from the summit down to the foot. */
const SHADED_FACE: readonly Point[] = [
  [262, 70],
  [330, 170],
  [372, 200],
  [472, 430],
  [290, 430],
  [276, 260]
];

/** Mountain: a rock peak with a snow cap on a mine gravel apron (rock -> gravel). */
export const renderMountainIcon = () => {
  const { canvas, context } = createIconCanvas();
  const apron = new Path2D();
  apron.ellipse(256, 430, 240, 52, 0, 0, Math.PI * 2);
  fillWithTile(context, MATERIAL.mine, apron);
  fillWithTile(context, MATERIAL.rock, toPath(PEAK));
  fillWithTile(context, MATERIAL.snow, toPath(SNOW));
  context.fillStyle = "rgb(18 24 34 / 34%)";
  context.fill(toPath(SHADED_FACE));
  context.lineWidth = 6;
  context.strokeStyle = OUTLINE;
  context.stroke(toPath(PEAK));
  return canvas;
};

/** A staggered Alpine ridgeline: distinct from the single procedural mountain peak. */
export const renderAlpineMountainIcon = () => {
  const { canvas, context } = createIconCanvas();
  const peak = renderMountainIcon();
  context.drawImage(peak, 0, 118, 320, 350);
  context.drawImage(peak, 128, 0, 380, 480);
  return canvas;
};

/** A lowered peak: a low, flat topped rock hill on its gravel apron. */
const LOW_PEAK: readonly Point[] = [
  [40, 452],
  [140, 352],
  [214, 318],
  [300, 318],
  [372, 352],
  [472, 452]
];
/** The down arrow above the hill (shaft and head). */
const DOWN_ARROW: readonly Point[] = [
  [212, 40],
  [300, 40],
  [300, 160],
  [360, 160],
  [256, 282],
  [152, 160],
  [212, 160]
];

/** Lower (the toggle): a big down arrow pressing a rock hill a level lower. */
export const renderLowerIcon = () => {
  const { canvas, context } = createIconCanvas();
  const apron = new Path2D();
  apron.ellipse(256, 452, 240, 44, 0, 0, Math.PI * 2);
  fillWithTile(context, MATERIAL.mine, apron);
  const hill = toPath(LOW_PEAK);
  fillWithTile(context, MATERIAL.rock, hill);
  context.lineWidth = 6;
  context.strokeStyle = OUTLINE;
  context.stroke(hill);
  const arrow = toPath(DOWN_ARROW);
  context.lineJoin = "round";
  context.lineWidth = 28;
  context.stroke(arrow);
  context.fillStyle = "rgb(250 250 246)";
  context.fill(arrow);
  return canvas;
};

/** Lake: still water in a sandy bank on meadow ground. */
export const renderLakeIcon = () => {
  const { canvas, context } = createIconCanvas();
  const ellipse = (radiusX: number, radiusY: number) => {
    const path = new Path2D();
    path.ellipse(256, 280, radiusX, radiusY, -0.08, 0, Math.PI * 2);
    return path;
  };
  fillWithTile(context, MATERIAL.grass, ellipse(250, 180));
  fillWithTile(context, MATERIAL.sand, ellipse(205, 140));
  const water = context.createRadialGradient(236, 262, 10, 256, 280, 190);
  water.addColorStop(0, toCss(WATER_COLORS.deep));
  water.addColorStop(1, toCss(WATER_COLORS.shallow));
  context.fillStyle = water;
  context.fill(ellipse(178, 116));
  context.strokeStyle = "rgb(255 255 255 / 55%)";
  context.lineWidth = 9;
  context.lineCap = "round";
  for (const [x, y, length] of [
    [190, 250, 70],
    [270, 310, 90],
    [300, 236, 40]
  ] as const) {
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y - 6);
    context.stroke();
  }
  context.lineWidth = 6;
  context.strokeStyle = OUTLINE;
  context.stroke(ellipse(250, 180));
  return canvas;
};

/** An undo arrow (three quarter circle with an arrow head) at the given centre and radius. */
const drawUndoArrow = (context: Context, [x, y]: Point, radius: number) => {
  const arrow = new Path2D();
  arrow.arc(x, y, radius, Math.PI * 0.95, Math.PI * 2.45);
  const head = toPath([
    [x - radius - 46, y - 34],
    [x - radius + 46, y - 34],
    [x - radius, y + 34]
  ]);
  context.lineCap = "round";
  for (const [color, width] of [
    [OUTLINE, 64],
    ["rgb(250 250 246)", 40]
  ] as const) {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke(arrow);
    context.fillStyle = color;
    context.lineWidth = width - 36;
    context.fill(head);
    context.stroke(head);
  }
};

/** Reset ground: plain meadow with an undo mark. */
export const renderResetIcon = () => {
  const { canvas, context } = createIconCanvas();
  const tile = new Path2D();
  tile.roundRect(24, 24, SIZE - 48, SIZE - 48, 80);
  fillWithTile(context, MATERIAL.grass, tile);
  context.lineWidth = 6;
  context.strokeStyle = OUTLINE;
  context.stroke(tile);
  drawUndoArrow(context, [256, 270], 120);
  return canvas;
};

/** An eraser (original glyph): a tilted block with a coloured band, a few crumbs. */
export const renderEraserIcon = (band: string) => {
  const { canvas, context } = createIconCanvas();
  context.translate(256, 240);
  context.rotate(-0.62);
  const body = new Path2D();
  body.roundRect(-190, -95, 380, 190, 34);
  const sleeve = new Path2D();
  sleeve.roundRect(-30, -95, 220, 190, [0, 34, 34, 0]);
  context.fillStyle = "rgb(236 128 140)";
  context.fill(body);
  context.fillStyle = band;
  context.fill(sleeve);
  context.fillStyle = "rgb(255 255 255 / 30%)";
  context.fillRect(-170, -80, 340, 34);
  context.lineWidth = 12;
  context.strokeStyle = OUTLINE;
  context.stroke(body);
  context.resetTransform();
  context.fillStyle = "rgb(236 128 140 / 85%)";
  for (const [x, y, radius] of [
    [110, 420, 16],
    [160, 448, 11],
    [70, 456, 9]
  ] as const) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
};
