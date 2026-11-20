import { createRandom, type Random } from "../../shared/world/rng";
import type { AtlasCanvas } from "./atlas-canvas";
import { type CellArea, paintLeaf, paintLeafShadow, paintStem, type Rgb } from "./foliage-strokes";

/**
 * Birch atlas cells (256 px): slender brown twigs with alternating serrated triangular-ovate
 * leaves on thin reddish-brown petioles. Original procedural strokes, no photo pixels.
 */
export type BirchCellKind = "hanging" | "leaf" | "shadow" | "spray" | "young";

const TWIG: Rgb = [0.15, 0.095, 0.065];
const PETIOLE: Rgb = [0.24, 0.1, 0.06];
const CATKIN: Rgb = [0.36, 0.33, 0.16];
const DRY_LEAF: Rgb = [0.32, 0.25, 0.06];

/**
 * Leaf greens per cell kind: fresh main, young yellow-green, cool deep shadow green. The birch
 * is the lightest, freshest tree green (oak crowns deeper and bluer, conifers darkest).
 */
const GREENS: Record<Exclude<BirchCellKind, "leaf">, Rgb[]> = {
  hanging: [
    [0.11, 0.22, 0.042],
    [0.145, 0.265, 0.052]
  ],
  shadow: [
    [0.055, 0.125, 0.05],
    [0.072, 0.148, 0.058]
  ],
  spray: [
    [0.125, 0.235, 0.042],
    [0.16, 0.28, 0.052],
    [0.195, 0.315, 0.062]
  ],
  young: [
    [0.2, 0.3, 0.06],
    [0.25, 0.33, 0.08]
  ]
};

type Point = readonly [number, number];

interface BirchPainter {
  area: CellArea;
  canvas: AtlasCanvas;
  first: number;
  kind: BirchCellKind;
  placed: { radius: number; x: number; y: number }[];
  random: Random;
  stroke: number;
}

const next = (painter: BirchPainter) => {
  painter.stroke += 1;
  return { layer: (painter.stroke - painter.first) * 0.012, surface: painter.stroke };
};

/** Contact shadow of a leaf on what lies below it (towards the twig base, away from the light). */
const LEAF_SHADOW = { offset: [-1.2, -2.2] as const, strength: 0.38 };

/** How one leaf looks: its green, whether it shows the paler underside, ageing. */
interface LeafLook {
  color: Rgb;
  spots: number;
  underside: boolean;
}

/** Underside of a turned birch leaf: paler and a little greyer, its veins raised. */
const toUnderside = (color: Rgb): Rgb => [color[0] * 1.28 + 0.02, color[1] * 1.18 + 0.02,
  color[2] * 1.3 + 0.015];

/**
 * Per leaf colour: a green of the cell's family with its own brightness and a slight warm / cool
 * hue shift, the inner (first painted) leaves in the spray's own shade, a few turned leaves
 * showing the underside and about 3 % yellowing with brown speckles.
 */
const pickLook = (painter: BirchPainter, inner: boolean, turned: boolean): LeafLook => {
  const { kind, random } = painter;
  if (kind !== "shadow" && random() < 0.03) return { color: DRY_LEAF, spots: 0.6, underside: false };
  const greens = GREENS[kind === "leaf" ? "spray" : kind];
  const green = greens[Math.floor(random() * greens.length)]!;
  const value = (0.84 + random() * 0.3) * (inner ? 0.78 : 1.06);
  const warm = (random() - 0.5) * 0.16;
  const color: Rgb = [green[0] * value * (1 + warm), green[1] * value, green[2] * value * (1 - warm)];
  return { color: turned ? toUnderside(color) : color, spots: 0, underside: turned };
};

/** A gently curving twig path in cell pixels. */
const twigPath =
  (from: Point, angle: number, length: number, bend: number) =>
  (t: number): Point => {
    const curve = angle + bend * t;
    return [from[0] + Math.cos(curve) * length * t, from[1] + Math.sin(curve) * length * t];
  };

const paintTwig = (painter: BirchPainter, path: (t: number) => Point, thickness: Point) => {
  const id = next(painter);
  for (let segment = 0; segment < 10; segment += 1) {
    const t0 = segment / 10;
    const t1 = (segment + 1) / 10;
    paintStem(painter.canvas, painter.area, {
      ...id,
      color: TWIG,
      from: path(t0),
      thickness: [
        thickness[0] + (thickness[1] - thickness[0]) * t0,
        thickness[0] + (thickness[1] - thickness[0]) * t1
      ],
      to: path(t1)
    });
  }
};

const isCrowded = (painter: BirchPainter, x: number, y: number, radius: number) =>
  painter.placed.some((leaf) => Math.hypot(leaf.x - x, leaf.y - y) < (leaf.radius + radius) * 0.5);

const isOutside = (area: CellArea, x: number, y: number, radius: number) =>
  x - radius < 2 || y - radius < 2 || x + radius > area.width - 2 || y + radius > area.height - 2;

/** One leaf on its long thin petiole, unless it would cover an earlier one or leave the cell. */
const paintPetiolatedLeaf = (painter: BirchPainter, base: Point, angle: number, length: number) => {
  const { random } = painter;
  const stalk = length * (0.28 + random() * 0.1);
  const centreX = base[0] + Math.cos(angle) * (stalk + length * 0.45);
  const centreY = base[1] + Math.sin(angle) * (stalk + length * 0.45);
  const radius = length * 0.4;
  if (isOutside(painter.area, centreX, centreY, radius * 1.1)) return;
  if (isCrowded(painter, centreX, centreY, radius)) return;
  painter.placed.push({ radius, x: centreX, y: centreY });
  const blade: Point = [base[0] + Math.cos(angle) * stalk, base[1] + Math.sin(angle) * stalk];
  paintStem(painter.canvas, painter.area, {
    ...next(painter),
    color: PETIOLE,
    from: base,
    thickness: [0.8, 0.6],
    to: blade
  });
  const turned = random() < 0.25;
  const narrowing = turned ? 0.5 + random() * 0.25 : 0.85 + random() * 0.15;
  const look = pickLook(painter, painter.placed.length < 4, turned && random() < 0.6);
  const leaf = {
    ...next(painter),
    angle: angle + (random() - 0.5) * 0.25,
    color: look.color,
    fold: (random() - 0.5) * 0.3,
    length,
    rim: 0.18,
    roundness: 0.8,
    sheen: look.underside ? 0 : 0.35,
    spots: look.spots,
    teeth: 6 + Math.floor(random() * 3),
    toothDepth: 0.12,
    underside: look.underside,
    veins: 7,
    width: length * 0.38 * narrowing,
    x: blade[0],
    y: blade[1]
  };
  paintLeafShadow(painter.canvas, painter.area, leaf, LEAF_SHADOW);
  paintLeaf(painter.canvas, painter.area, leaf);
};

/** Leaves alternating along a twig, leaning forward (towards the tip) and drooping a little. */
const paintLeavesAlong = (
  painter: BirchPainter,
  path: (t: number) => Point,
  count: number,
  size: Point
) => {
  const { random } = painter;
  for (let leaf = 0; leaf < count; leaf += 1) {
    const t = Math.min(1, 0.12 + (0.88 * (leaf + 0.3 + random() * 0.5)) / count);
    const [x, y] = path(t);
    const [aheadX, aheadY] = path(Math.min(1, t + 0.03));
    const heading = Math.atan2(aheadY - y, aheadX - x);
    const side = leaf % 2 === 0 ? 1 : -1;
    const last = leaf === count - 1;
    const angle = last ? heading : heading + side * (0.55 + random() * 0.55);
    paintPetiolatedLeaf(painter, [x, y], angle, size[0] + random() * (size[1] - size[0]));
  }
};

/** Small hanging catkins (tan-green), on the spray cells that carry them. */
const paintCatkin = (painter: BirchPainter, from: Point) => {
  const length = painter.area.height * (0.12 + painter.random() * 0.05);
  const to: Point = [from[0] + (painter.random() - 0.5) * 6, from[1] + length];
  paintStem(painter.canvas, painter.area, {
    ...next(painter),
    color: CATKIN,
    from,
    thickness: [1.6, 2.4],
    to
  });
};

/** Leaf spray: a slender twig with one or two short side shoots and 6-10 leaves. */
const paintSpray = (painter: BirchPainter, catkins: boolean) => {
  const { area, random } = painter;
  const cell = area.width;
  const main = twigPath(
    [cell * (0.4 + random() * 0.2), 2],
    Math.PI / 2 + (random() - 0.5) * 0.4,
    cell * (0.78 + random() * 0.1),
    (random() - 0.5) * 0.6
  );
  const sides = Array.from({ length: 1 + Math.floor(random() * 2) }, (_, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    return twigPath(
      main(0.3 + index * 0.22 + random() * 0.1),
      Math.PI / 2 - side * (0.55 + random() * 0.4),
      cell * (0.3 + random() * 0.12),
      side * 0.3
    );
  });
  const size: Point = [cell * 0.17, cell * 0.23];
  paintTwig(painter, main, [1.5, 0.6]);
  for (const path of sides) paintTwig(painter, path, [1, 0.5]);
  paintLeavesAlong(painter, main, 9 + Math.floor(random() * 3), size);
  for (const path of sides) paintLeavesAlong(painter, path, 4, size);
  if (catkins) paintCatkin(painter, main(0.55));
};

/** Hanging twig: a long, thin, slightly swaying twig with small leaves all along it. */
const paintHanging = (painter: BirchPainter) => {
  const { area, random } = painter;
  const main = twigPath(
    [area.width * (0.45 + random() * 0.1), 2],
    Math.PI / 2 + (random() - 0.5) * 0.2,
    area.height * 0.95,
    (random() - 0.5) * 0.35
  );
  paintTwig(painter, main, [1.1, 0.5]);
  paintLeavesAlong(painter, main, 12, [area.width * 0.13, area.width * 0.18]);
};

/** Single leaf reference: front (left half) and the paler back with raised veins (right). */
const paintSingleLeaf = (painter: BirchPainter) => {
  const { area } = painter;
  const half = area.width / 2;
  const length = area.height * 0.62;
  for (const [index, tone] of [1, 1.45].entries()) {
    const green = GREENS.spray[1]!;
    const color: Rgb = [
      green[0] * tone + index * 0.05,
      green[1] * tone,
      green[2] * tone + index * 0.04
    ];
    const x = half * index + half / 2;
    paintStem(painter.canvas, painter.area, {
      ...next(painter),
      color: PETIOLE,
      from: [x, 4],
      thickness: [1.4, 1],
      to: [x, area.height * 0.26]
    });
    paintLeaf(painter.canvas, painter.area, {
      ...next(painter),
      angle: Math.PI / 2,
      color,
      length,
      roundness: 0.8,
      teeth: 8,
      width: half * 0.42,
      x,
      y: area.height * 0.26
    });
  }
};

/** Paints one birch cell; `seed` makes every cell different. */
export const paintBirchCell = (
  canvas: AtlasCanvas,
  area: CellArea,
  kind: BirchCellKind,
  seed: number,
  firstStroke: number
) => {
  const random = createRandom(seed);
  const painter: BirchPainter = {
    area,
    canvas,
    first: firstStroke,
    kind,
    placed: [],
    random,
    stroke: firstStroke
  };
  if (kind === "leaf") paintSingleLeaf(painter);
  else if (kind === "hanging") paintHanging(painter);
  else paintSpray(painter, kind === "spray" && seed % 3 === 0);
};
