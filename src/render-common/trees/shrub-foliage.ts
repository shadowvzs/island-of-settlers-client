import type { Random } from "../../shared/world/rng";
import { type CellArea, type LeafStroke, paintLeaf, paintLeafShadow, paintStem, type Rgb } from "./foliage-strokes";
import { jitter, type Painter, paintPath, type Point, type Twig, twigPath } from "./spray-painter";

/**
 * Broadleaf spray cells (512 px, foliage atlas row 0): one species each, painted as a forked
 * shoot carrying 25-40 separate leaves on petioles. Every leaf has its species outline and
 * margin, midrib and vein network, its own green (sunlit outer leaves, shaded inner ones), some
 * show the paler underside, a few are yellowing; leaves cast soft contact shadows on the ones
 * below. Original procedural strokes, no photo pixels.
 */
export interface SprayLeafSpecies {
  /** Leaves per twig: the main shoot and each side shoot. */
  count: { main: number; side: number };
  greens: Rgb[];
  /** Blade outline and surface (fields of LeafStroke). */
  leaf: Pick<LeafStroke, "lobes" | "roundness" | "sheen" | "teeth" | "toothDepth" | "veins" | "widest">;
  /** Leaf length range as a share of the cell width. */
  size: Point;
  /** Side shoots off the main shoot. */
  sides: Point;
  /** Petiole length as a share of the leaf length. */
  stalk: number;
  twig: Rgb;
  /** Blade width as a share of its length. */
  width: number;
}

const YELLOWING: Rgb = [0.3, 0.25, 0.05];
/** Contact shadow of a leaf on the leaves below it (towards the twig base, away from the light). */
const SHADOW = { offset: [-1.6, -3] as const, strength: 0.4 };

type Placed = { radius: number; x: number; y: number }[];

const isCrowded = (placed: Placed, x: number, y: number, radius: number) =>
  placed.some(leaf => Math.hypot(leaf.x - x, leaf.y - y) < (leaf.radius + radius) * 0.45);

const isOutside = (area: CellArea, x: number, y: number, radius: number) =>
  x - radius < 2 || y - radius < 2 || x + radius > area.width - 2 || y + radius > area.height - 2;

/** Underside: paler, greyer, a little bluish (hairs and wax). */
const toUnderside = (color: Rgb): Rgb => [color[0] * 1.3 + 0.025, color[1] * 1.2 + 0.025,
  color[2] * 1.45 + 0.02];

interface LeafLook {
  color: Rgb;
  spots: number;
  underside: boolean;
}

/** Back (first painted) leaves sit in the spray's shade; outer ones are sunlit and warmer. */
const pickLook = (species: SprayLeafSpecies, random: Random, back: boolean): LeafLook => {
  if (random() < 0.018) return { color: jitter(YELLOWING, random, 0.3), spots: 0.4, underside: false };
  const green = jitter(species.greens[Math.floor(random() * species.greens.length)]!, random, 0.3);
  const underside = random() < 0.14;
  const warm = (random() - 0.5) * 0.14;
  const value = back ? 0.7 : 1.05;
  const color: Rgb = [green[0] * value * (1 + warm), green[1] * value, green[2] * value * (1 - warm)];
  return { color: underside ? toUnderside(color) : color, spots: 0, underside };
};

interface Placement {
  angle: number;
  length: number;
  twigPoint: Point;
}

/** n-th leaf of a twig: alternating sides at uneven angles, larger mid-shoot, one at the tip. */
const placeLeaf = (painter: Painter, species: SprayLeafSpecies, twig: Twig, leaf: number, count: number) => {
  const { area, random } = painter;
  const t = Math.min(1, 0.12 + 0.88 * (leaf + 0.35 + random() * 0.45) / count);
  const twigPoint = twig(t);
  const ahead = twig(Math.min(1, t + 0.03));
  const heading = Math.atan2(ahead[1] - twigPoint[1], ahead[0] - twigPoint[0]);
  const side = leaf % 2 === 0 ? 1 : -1;
  const last = leaf === count - 1 && t > 0.9;
  const angle = last ? heading : heading + side * (0.45 + random() * 0.75);
  const grow = 0.75 + Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.35;
  const length = area.width * (species.size[0] + random() * (species.size[1] - species.size[0])) * grow;
  return { angle, length, twigPoint };
};

/** Claims room for the blade; false when it would leave the cell or bury an earlier leaf. */
const claimRoom = (painter: Painter, species: SprayLeafSpecies, placement: Placement, placed: Placed) => {
  const reach = placement.length * (species.stalk + 0.5);
  const x = placement.twigPoint[0] + Math.cos(placement.angle) * reach;
  const y = placement.twigPoint[1] + Math.sin(placement.angle) * reach;
  const radius = placement.length * 0.42;
  if (isOutside(painter.area, x, y, radius * 1.1) || isCrowded(placed, x, y, radius)) return false;
  placed.push({ radius, x, y });
  return true;
};

const paintSprayLeaf = (painter: Painter, species: SprayLeafSpecies, placement: Placement, back: boolean) => {
  const { random } = painter;
  const { angle, length, twigPoint } = placement;
  const stalk = length * species.stalk;
  const base: Point = [twigPoint[0] + Math.cos(angle) * stalk, twigPoint[1] + Math.sin(angle) * stalk];
  paintStem(painter.canvas, painter.area, {
    ...painter.next(),
    color: species.twig,
    from: twigPoint,
    thickness: [1.3, 0.9],
    to: base
  });
  const look = pickLook(species, random, back);
  const turned = random() < 0.25 ? 0.55 + random() * 0.25 : 0.88 + random() * 0.12;
  const leaf: LeafStroke = {
    ...painter.next(),
    ...species.leaf,
    angle: angle + (random() - 0.5) * 0.3,
    color: look.color,
    fold: (random() - 0.5) * 0.34,
    length,
    rim: 0.22,
    sheen: look.underside ? 0 : species.leaf.sheen,
    spots: look.spots,
    underside: look.underside,
    width: length * species.width * turned,
    x: base[0],
    y: base[1]
  };
  paintLeafShadow(painter.canvas, painter.area, leaf, SHADOW);
  paintLeaf(painter.canvas, painter.area, leaf);
};

const paintTwigLeaves = (painter: Painter, species: SprayLeafSpecies, twig: Twig, count: number,
  back: boolean, placed: Placed) => {
  for (let leaf = 0; leaf < count; leaf += 1) {
    const placement = placeLeaf(painter, species, twig, leaf, count);
    if (claimRoom(painter, species, placement, placed)) paintSprayLeaf(painter, species, placement, back);
  }
};

/** Side shoots leaving the main shoot alternately, shorter towards its tip. */
const createSideShoots = (painter: Painter, species: SprayLeafSpecies, main: Twig) => {
  const { area, random } = painter;
  const count = Math.round(species.sides[0] + random() * (species.sides[1] - species.sides[0]));
  return Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    const at = 0.18 + ((index + random() * 0.6) / count) * 0.55;
    return twigPath(main(at), Math.PI / 2 - side * (0.55 + random() * 0.45),
      area.width * (0.42 - at * 0.3) * (0.85 + random() * 0.3), side * (random() - 0.2) * 0.6);
  });
};

/**
 * One species spray: the main shoot starts at the cell's v = 0 edge (the card's attachment), the
 * first side shoot lies behind (its leaves shaded), the rest in front.
 */
export const paintSpeciesSpray = (painter: Painter, species: SprayLeafSpecies) => {
  const { area, random } = painter;
  const main = twigPath([area.width * (0.44 + random() * 0.12), 3], Math.PI / 2 + (random() - 0.5) * 0.3,
    area.height * (0.8 + random() * 0.1), (random() - 0.5) * 0.45);
  const sides = createSideShoots(painter, species, main);
  const placed: Placed = [];
  const [back, ...front] = sides;
  if (back) {
    paintPath(painter, back, [2.6, 1], species.twig);
    paintTwigLeaves(painter, species, back, species.count.side, true, placed);
  }
  paintPath(painter, main, [4.2, 1.2], species.twig);
  for (const twig of front) paintPath(painter, twig, [2.6, 1], species.twig);
  paintTwigLeaves(painter, species, main, species.count.main, false, placed);
  for (const twig of front) paintTwigLeaves(painter, species, twig, species.count.side, false, placed);
};

const BROWN_TWIG: Rgb = [0.13, 0.085, 0.05];

/**
 * Species of the four row 0 spray cells (LEAF_SPRAY_RECTS order): young oak (oak saplings),
 * willow (riverbank and field shrubs), hornbeam-hazel (woody forest shrub), glossy elliptic
 * berry bush leaves.
 */
export const SPRAY_SPECIES: SprayLeafSpecies[] = [
  {
    count: { main: 9, side: 6 },
    greens: [[0.1, 0.24, 0.045], [0.14, 0.29, 0.05], [0.18, 0.33, 0.06]],
    leaf: { lobes: 5, roundness: 0.8, sheen: 0.25 },
    size: [0.17, 0.23],
    sides: [2, 3],
    stalk: 0.08,
    twig: BROWN_TWIG,
    width: 0.4
  },
  {
    count: { main: 13, side: 8 },
    greens: [[0.08, 0.2, 0.075], [0.1, 0.235, 0.085], [0.125, 0.27, 0.095]],
    leaf: { roundness: 0.2, sheen: 0.12, teeth: 16, toothDepth: 0.06, veins: 13, widest: 0.38 },
    size: [0.2, 0.27],
    sides: [2, 3],
    stalk: 0.05,
    twig: [0.2, 0.12, 0.06],
    width: 0.13
  },
  {
    count: { main: 12, side: 7 },
    greens: [[0.09, 0.23, 0.045], [0.125, 0.28, 0.055], [0.16, 0.33, 0.06]],
    leaf: { roundness: 0.8, sheen: 0.2, teeth: 10, toothDepth: 0.1, veins: 11, widest: 0.42 },
    size: [0.14, 0.2],
    sides: [2, 4],
    stalk: 0.12,
    twig: BROWN_TWIG,
    width: 0.34
  },
  {
    count: { main: 14, side: 8 },
    greens: [[0.08, 0.21, 0.05], [0.105, 0.25, 0.055], [0.135, 0.29, 0.06]],
    leaf: { roundness: 0.55, sheen: 0.9, veins: 6 },
    size: [0.11, 0.16],
    sides: [3, 4],
    stalk: 0.06,
    twig: [0.2, 0.08, 0.05],
    width: 0.27
  }
];
