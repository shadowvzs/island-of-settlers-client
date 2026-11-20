import type { Random } from "../../shared/world/rng";
import type { AtlasCanvas } from "./atlas-canvas";
import { type CellArea, paintStem, type Rgb } from "./foliage-strokes";

/** Painting state of one atlas cell: every stroke gets the next stacking layer and surface. */
export interface Painter {
  area: CellArea;
  canvas: AtlasCanvas;
  next: () => { layer: number; surface: number };
  random: Random;
}

export const createPainter = (
  canvas: AtlasCanvas,
  area: CellArea,
  random: Random,
  first: number
): Painter => {
  let stroke = first;
  return {
    area,
    canvas,
    next: () => {
      stroke += 1;
      return { layer: (stroke - first) * 0.012, surface: stroke };
    },
    random
  };
};

/** Twig and stalk brown of the broadleaf and oak sprays. */
export const TWIG: Rgb = [0.11, 0.075, 0.045];

export type Point = readonly [number, number];

/** A path in cell pixels: t 0 (start) .. 1 (end). */
export type Twig = (t: number) => Point;

/** A curved twig as a polyline from `from` towards `angle`, bending by `bend`. */
export const twigPath =
  (from: Point, angle: number, length: number, bend: number): Twig =>
  (t) => {
    const curve = angle + bend * t;
    return [from[0] + Math.cos(curve) * length * t, from[1] + Math.sin(curve) * length * t];
  };

/** Tapering stem along a path in eight segments (one surface). */
export const paintPath = (painter: Painter, path: Twig, thickness: Point, color: Rgb) => {
  const id = painter.next();
  for (let segment = 0; segment < 8; segment += 1) {
    const t0 = segment / 8;
    const t1 = (segment + 1) / 8;
    paintStem(painter.canvas, painter.area, {
      ...id,
      color,
      from: path(t0),
      thickness: [
        thickness[0] + (thickness[1] - thickness[0]) * t0,
        thickness[0] + (thickness[1] - thickness[0]) * t1
      ],
      to: path(t1)
    });
  }
};

/** Colour with a random brightness (by `amount`) and a little red shift. */
export const jitter = (color: Rgb, random: Random, amount: number): Rgb => {
  const factor = 1 - amount / 2 + random() * amount;
  return [color[0] * factor * (0.92 + random() * 0.16), color[1] * factor, color[2] * factor];
};
