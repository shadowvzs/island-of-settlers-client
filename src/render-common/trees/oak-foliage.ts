import type { Random } from "../../shared/world/rng";
import { type CellArea, paintLeaf, paintLeafShadow, paintStem, type Rgb } from "./foliage-strokes";
import {
  jitter,
  type Painter,
  paintPath,
  type Point,
  TWIG,
  type Twig,
  twigPath} from "./spray-painter";

/**
 * Oak atlas cells (256 px): irregular twigs with many small, separate lobed oak leaves. Every
 * leaf has its own outline, fold light, tone and a soft contact shadow on the leaves below, so
 * sprays read as individual leaves rather than flat clumps. Original procedural strokes.
 */

/** Oak greens: deeper and bluer than the generic broadleaf (shrubs) and the birch. */
const OAK_GREENS: Rgb[] = [
  [0.04, 0.112, 0.036],
  [0.057, 0.14, 0.043],
  [0.08, 0.178, 0.052],
  [0.116, 0.215, 0.064]
];
const YELLOWING_LEAF: Rgb = [0.17, 0.16, 0.04];
/** Light in cell space: from the spray's tip side (the card's outer, sunlit end). */
const LIGHT: Point = [0.45, 0.89];
/** Contact shadow of a leaf on the leaves below it: away from the light, in pixels. */
const SHADOW = { offset: [-LIGHT[0] * 3, -LIGHT[1] * 3] as Point, strength: 0.42 };
/** Darker blade margin: outlines each leaf against the ones behind it. */
const RIM = 0.3;
const FOLD = 0.16;

/** Leaves placed on one cell so far: centres and radii, to keep gaps between them. */
type Placed = { radius: number; x: number; y: number }[];

const isCrowded = (placed: Placed, x: number, y: number, radius: number) =>
  placed.some((leaf) => Math.hypot(leaf.x - x, leaf.y - y) < (leaf.radius + radius) * 0.55);

/** A leaf must stay inside its cell (a cut leaf shows a straight edge on the card). */
const isOutside = (area: CellArea, x: number, y: number, radius: number) =>
  x - radius < 2 || y - radius < 2 || x + radius > area.width - 2 || y + radius > area.height - 2;

/** Underside of a leaf turned away from the viewer: paler, a touch greyer (not bluer). */
const toUnderside = (color: Rgb): Rgb => [
  color[0] * 1.14 + 0.01,
  color[1] * 1.1 + 0.01,
  color[2] * 1.06 + 0.008
];

/**
 * Back layer leaves sit in the cluster's own shade (darker, bluer); a few leaves yellow; each
 * leaf has its own brightness, and turned leaves show their paler underside.
 */
const getOakLeafColor = (random: Random, back: boolean, turned: boolean): Rgb => {
  if (random() < 0.02) return jitter(YELLOWING_LEAF, random, 0.25);
  const green = jitter(OAK_GREENS[Math.floor(random() * OAK_GREENS.length)]!, random, 0.36);
  const face = turned ? toUnderside(green) : green;
  if (!back) return [face[0] * 1.09, face[1] * 1.09, face[2]];
  return [face[0] * 0.6, face[1] * 0.68, face[2] * 0.85];
};

/** Fold light of a blade pointing at `angle`: its +across half faces the light or away. */
const getFold = (angle: number) =>
  FOLD * (-Math.sin(angle) * LIGHT[0] + Math.cos(angle) * LIGHT[1]);

interface OakTwigLeaves {
  back: boolean;
  count: number;
  /** Leaf length range in pixels. */
  size: Point;
}

interface LeafPlacement {
  angle: number;
  length: number;
  stalk: number;
  twigPoint: Point;
}

/**
 * Where the n-th leaf sits along the twig: alternating sides at uneven angles, crowding towards
 * the shoot tip (where oak leaves bunch) and larger there; the last one at the tip.
 */
const placeLeaf = (twig: Twig, leaves: OakTwigLeaves, leaf: number, random: Random) => {
  const t = Math.min(1, 0.2 + 0.8 * Math.sqrt((leaf + 0.3 + random() * 0.5) / leaves.count));
  const twigPoint = twig(t);
  const [aheadX, aheadY] = twig(Math.min(1, t + 0.04));
  const heading = Math.atan2(aheadY - twigPoint[1], aheadX - twigPoint[0]);
  const last = leaf === leaves.count - 1 && t > 0.9;
  const side = leaf % 2 === 0 ? 1 : -1;
  const angle = last ? heading : heading + side * (0.3 + random() * 1.1);
  const length = (leaves.size[0] + random() * (leaves.size[1] - leaves.size[0])) * (0.8 + t * 0.3);
  return { angle, length, stalk: length * (0.08 + random() * 0.06), twigPoint };
};

/** Claims room for a leaf; false when it would leave the cell or cover an earlier one. */
const claimRoom = (painter: Painter, placement: LeafPlacement, placed: Placed) => {
  const { angle, length, stalk, twigPoint } = placement;
  const centreX = twigPoint[0] + Math.cos(angle) * (stalk + length * 0.5);
  const centreY = twigPoint[1] + Math.sin(angle) * (stalk + length * 0.5);
  const radius = length * 0.42;
  if (isOutside(painter.area, centreX, centreY, radius * 1.15)) return false;
  if (isCrowded(placed, centreX, centreY, radius)) return false;
  placed.push({ radius, x: centreX, y: centreY });
  return true;
};

/** Short stalk, then the blade with its shadow cast on the leaves below. */
const paintOakLeaf = (painter: Painter, placement: LeafPlacement, back: boolean) => {
  const { random } = painter;
  const { angle, length, stalk, twigPoint } = placement;
  const base: Point = [
    twigPoint[0] + Math.cos(angle) * stalk,
    twigPoint[1] + Math.sin(angle) * stalk
  ];
  const turned = random() < 0.25;
  const narrowing = turned ? 0.62 + random() * 0.22 : 0.85 + random() * 0.15;
  const bladeAngle = angle + (random() - 0.5) * 0.3;
  paintStem(painter.canvas, painter.area, {
    ...painter.next(),
    color: TWIG,
    from: twigPoint,
    thickness: [1, 0.75],
    to: base
  });
  const blade = {
    ...painter.next(),
    angle: bladeAngle,
    color: getOakLeafColor(random, back, turned),
    fold: getFold(bladeAngle),
    length,
    lobes: 4 + Math.floor(random() * 2),
    rim: RIM,
    roundness: 0.8,
    width: length * 0.38 * narrowing,
    x: base[0],
    y: base[1]
  };
  paintLeafShadow(painter.canvas, painter.area, blade, SHADOW);
  paintLeaf(painter.canvas, painter.area, blade);
};

/**
 * Oak leaves alternating along a twig: each on a short stalk at its own angle and size; a leaf
 * that would land on top of an earlier one is skipped, so the leaves stay separate.
 */
const paintOakTwigLeaves = (
  painter: Painter,
  twig: Twig,
  leaves: OakTwigLeaves,
  placed: Placed
) => {
  for (let leaf = 0; leaf < leaves.count; leaf += 1) {
    const placement = placeLeaf(twig, leaves, leaf, painter.random);
    if (!claimRoom(painter, placement, placed)) continue;
    paintOakLeaf(painter, placement, leaves.back);
  }
};

/** Two or three side twigs leaving the main twig at alternating sides. */
const createSideTwigs = (painter: Painter, main: Twig) => {
  const { area, random } = painter;
  const sideCount = 2 + Math.floor(random() * 2);
  return Array.from({ length: sideCount }, (_, index) => {
    const side = (index % 2 === 0 ? 1 : -1) * (random() < 0.2 ? -1 : 1);
    return twigPath(
      main(0.22 + ((index + random() * 0.7) / sideCount) * 0.5),
      Math.PI / 2 - side * (0.6 + random() * 0.6),
      area.width * (0.26 + random() * 0.14),
      side * (random() - 0.3) * 0.8
    );
  });
};

/**
 * Oak spray: an irregular twig with two or three side twigs, small leaves alternating along
 * them with gaps; the first side twig lies behind (its leaves darker and bluer). Every cell
 * differs.
 */
export const paintOakSpray = (painter: Painter) => {
  const { area, random } = painter;
  const cell = area.width;
  const main = twigPath(
    [cell * (0.42 + random() * 0.16), 3],
    Math.PI / 2 + (random() - 0.5) * 0.35,
    cell * (0.72 + random() * 0.12),
    (random() - 0.5) * 0.5
  );
  const sides = createSideTwigs(painter, main);
  const size: Point = [cell * 0.13, cell * 0.19];
  const placed: Placed = [];
  paintPath(painter, sides[0]!, [1.4, 0.7], TWIG);
  paintOakTwigLeaves(painter, sides[0]!, { back: true, count: 13, size }, placed);
  paintPath(painter, main, [2.4, 0.9], TWIG);
  for (const twig of sides.slice(1)) paintPath(painter, twig, [1.5, 0.7], TWIG);
  paintOakTwigLeaves(painter, main, { back: false, count: 20, size }, placed);
  for (const twig of sides.slice(1)) {
    paintOakTwigLeaves(painter, twig, { back: false, count: 12, size }, placed);
  }
};
