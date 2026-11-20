import { createRandom, type Random } from "../../shared/world/rng";
import { type AtlasRegion,buildAtlasMips } from "../baker/atlas-mips";
import { createAtlasCanvas, finishCanvas } from "./atlas-canvas";
import { type BirchCellKind,paintBirchCell } from "./birch-foliage";
import { paintCherrySpray } from "./cherry-foliage";
import { type CellArea, paintStem, type Rgb } from "./foliage-strokes";
import { paintOakSpray } from "./oak-foliage";
import { paintPalmCell } from "./palm-atlas";
import { paintSpeciesSpray, SPRAY_SPECIES } from "./shrub-foliage";
import { createPainter, jitter, type Painter, paintPath, type Point, TWIG, twigPath } from "./spray-painter";

/**
 * Foliage atlas (2048 x 2048): row 0 four broadleaf species sprays (shrub-foliage.ts), row 1 one needle
 * spray (512 px cell: short spruce needles), four cherry blossom sprays and eight oak sprays (256 px), then
 * the palm rows (palm-atlas.ts: five fronds of 1024 x 256 with the rachis along u, two 512 x 128 leaflet
 * cards, one 512 x 256 fan leaf) and
 * a bottom strip of eight 256 px birch cells.
 * Texture row 0 is v = 0; a spray's twig starts at its cell's v = 0 edge and grows towards
 * higher v.
 */
const FOLIAGE_ATLAS_SIZE = 2048;
const SPRAY_CELL = 512;

export interface AtlasRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const toRect = (x: number, y: number, width: number, height: number): AtlasRect => ({
  u0: x / FOLIAGE_ATLAS_SIZE,
  u1: (x + width) / FOLIAGE_ATLAS_SIZE,
  v0: y / FOLIAGE_ATLAS_SIZE,
  v1: (y + height) / FOLIAGE_ATLAS_SIZE
});

/** Species sprays: 0 young oak, 1 willow, 2 hornbeam-hazel, 3 glossy berry bush (SPRAY_SPECIES). */
export const LEAF_SPRAY_RECTS = [0, 1, 2, 3].map((cell) =>
  toRect(cell * SPRAY_CELL, 0, SPRAY_CELL, SPRAY_CELL)
);
/** Short-needle conifer spray (every conifer archetype draws this cell). */
export const NEEDLE_SPRAY_RECTS = [toRect(0, SPRAY_CELL, SPRAY_CELL, SPRAY_CELL)];
const OAK_CELL = 256;
/** Oak sprays: eight 256 px twigs with separate lobed leaves (needle row cells 2-3). */
export const OAK_SPRAY_RECTS = Array.from({ length: 8 }, (_, cell) =>
  toRect(
    1024 + (cell % 4) * OAK_CELL,
    SPRAY_CELL + Math.floor(cell / 4) * OAK_CELL,
    OAK_CELL,
    OAK_CELL
  )
);
/** Cherry blossom sprays: four 256 px cells in the free second half of row 1. */
const CHERRY_SPRAY_RECTS = Array.from({ length: 4 }, (_, cell) =>
  toRect(SPRAY_CELL + (cell % 2) * OAK_CELL, SPRAY_CELL + Math.floor(cell / 2) * OAK_CELL, OAK_CELL, OAK_CELL)
);
/**
 * Broadleaf (oak species) spray cells: eight oak sprays, then four cherry blossom sprays. Oak
 * sprays use variants 0-7, blossoming cherries `CHERRY_SPRAY_VARIANT` onwards.
 */
export const BROADLEAF_SPRAY_RECTS = [...OAK_SPRAY_RECTS, ...CHERRY_SPRAY_RECTS];
export const CHERRY_SPRAY_VARIANT = OAK_SPRAY_RECTS.length;
export const CHERRY_SPRAY_COUNT = CHERRY_SPRAY_RECTS.length;
const PALM_ROW = 1024;
const PALM_ROWS_HEIGHT = 768;
/** Palm cells (PALM_CELL order) as [x, y, width, height] inside the palm rows. */
const PALM_LAYOUT: [number, number, number, number][] = [
  [0, 0, 1024, 256],
  [1024, 0, 1024, 256],
  [0, 256, 1024, 256],
  [1024, 256, 1024, 256],
  [0, 512, 1024, 256],
  [1024, 512, 512, 128],
  [1024, 640, 512, 128],
  [1536, 512, 512, 256]
];
/** Palm cells by PALM_CELL: fronds (rachis along u, v across), leaflet cards, the fan leaf. */
export const PALM_RECTS = PALM_LAYOUT.map(([x, y, width, height]) =>
  toRect(x, PALM_ROW + y, width, height)
);
const BIRCH_CELL_SIZE = 256;
const BIRCH_ROW = PALM_ROW + PALM_ROWS_HEIGHT;
/** Birch cells in the bottom strip, by role (birch-crown.ts BIRCH_CELL picks them). */
const BIRCH_CELL_KINDS: BirchCellKind[] = [
  "spray",
  "spray",
  "spray",
  "young",
  "shadow",
  "hanging",
  "hanging",
  "leaf"
];
const BIRCH_RECTS = BIRCH_CELL_KINDS.map((_, cell) =>
  toRect(cell * BIRCH_CELL_SIZE, BIRCH_ROW, BIRCH_CELL_SIZE, BIRCH_CELL_SIZE)
);
/** Every painted cell, used for region-aware mipping. */
export const FOLIAGE_ATLAS_REGIONS = [
  ...LEAF_SPRAY_RECTS,
  ...NEEDLE_SPRAY_RECTS,
  ...BROADLEAF_SPRAY_RECTS,
  ...PALM_RECTS,
  ...BIRCH_RECTS
];
const getFoliageAtlasPixelRegions = (size: number): AtlasRegion[] =>
  FOLIAGE_ATLAS_REGIONS.map(rect => ({
    height: Math.round((rect.v1 - rect.v0) * size),
    width: Math.round((rect.u1 - rect.u0) * size),
    x: Math.round(rect.u0 * size),
    y: Math.round(rect.v0 * size)
  }));
/**
 * Atlas regions (uv) of the evergreen foliage, so shaders and bakes can tell the kinds apart by
 * uv: conifer needles (both needle cells of row 1) and the palm rows. Every other atlas leaf is
 * broadleaf (sprays, oak, birch): bare in winter.
 */
export const EVERGREEN_REGIONS = {
  needles: {
    u1: SPRAY_CELL / FOLIAGE_ATLAS_SIZE,
    v0: SPRAY_CELL / FOLIAGE_ATLAS_SIZE,
    v1: (2 * SPRAY_CELL) / FOLIAGE_ATLAS_SIZE
  },
  palms: { v0: PALM_ROW / FOLIAGE_ATLAS_SIZE, v1: BIRCH_ROW / FOLIAGE_ATLAS_SIZE }
} as const;

/**
 * Atlas regions (uv) whose species the season tint reads from the texture itself: the birch strip and
 * the cherry blossom sprays (a hardwood birch form or a cherry-form broadleaf keep their own autumn).
 */
export const SEASON_SPECIES_REGIONS = {
  birch: { v0: BIRCH_ROW / FOLIAGE_ATLAS_SIZE },
  cherry: {
    u0: SPRAY_CELL / FOLIAGE_ATLAS_SIZE,
    u1: (2 * SPRAY_CELL) / FOLIAGE_ATLAS_SIZE,
    v0: SPRAY_CELL / FOLIAGE_ATLAS_SIZE,
    v1: (2 * SPRAY_CELL) / FOLIAGE_ATLAS_SIZE
  }
} as const;

/** Birch sprays: 0-2 leaf sprays, 3 young, 4 shadow, 5-6 hanging twigs. */
export const BIRCH_SPRAY_RECTS = BIRCH_RECTS.slice(0, 7);
/** One birch leaf, front (left half) and back (right half): reference sheet only. */
export const BIRCH_LEAF_RECT = BIRCH_RECTS[7]!;

/** Needle colours: dark old needles inside, fresh light green at the shoot tips. */
const getNeedleColor = (t: number, random: Random): Rgb => {
  const fresh = Math.max(0, (t - 0.65) / 0.35);
  const base: Rgb = [0.03 + fresh * 0.08, 0.085 + fresh * 0.13, 0.04 + fresh * 0.03];
  return jitter(base, random, 0.35);
};

/**
 * How needles sit on a shoot: where they start, their spacing, angle from the shoot, length and
 * colour.
 */
interface NeedleSet {
  angle: [number, number];
  color: (t: number, random: Random) => Rgb;
  from: number;
  length: number;
  step: number;
}

/** Spruce / fir: short, stiff needles all along the shoot (a bottle brush). */
const SHORT_NEEDLES: Omit<NeedleSet, "length"> = {
  angle: [0.75, 0.45],
  color: getNeedleColor,
  from: 0.04,
  step: 0.009
};

/** Paired needles along a shoot, angled forward, shorter towards the tip. */
const paintNeedlesAlong = (painter: Painter, path: (t: number) => Point, set: NeedleSet) => {
  const { random } = painter;
  for (let t = set.from; t < 1; t += set.step) {
    const [x, y] = path(t);
    const [aheadX, aheadY] = path(Math.min(1, t + 0.02));
    const heading = Math.atan2(aheadY - y, aheadX - x);
    for (const side of [-1, 1]) {
      const angle = heading + side * (set.angle[0] + random() * set.angle[1]);
      const needle = set.length * (1 - t * 0.45) * (0.75 + random() * 0.4);
      const tip: Point = [x + Math.cos(angle) * needle, y + Math.sin(angle) * needle];
      paintStem(painter.canvas, painter.area, {
        ...painter.next(),
        color: set.color(t, random),
        from: [x, y],
        thickness: [1.5, 0.45],
        to: tip
      });
    }
  }
};

/** Spruce spray (cell 0): a flat shoot with four side shoots, densely set with short needles. */
const paintSpruceSpray = (painter: Painter) => {
  const { random } = painter;
  const main = twigPath(
    [SPRAY_CELL / 2, 4],
    Math.PI / 2 + (random() - 0.5) * 0.15,
    SPRAY_CELL * 0.9,
    (random() - 0.5) * 0.25
  );
  const sides = Array.from({ length: 4 }, (_, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    return twigPath(
      main(0.16 + index * 0.16),
      Math.PI / 2 - side * (0.6 + random() * 0.2),
      SPRAY_CELL * (0.44 - index * 0.06),
      side * 0.2
    );
  });
  for (const path of sides) {
    paintPath(painter, path, [2, 0.8], TWIG);
    paintNeedlesAlong(painter, path, { ...SHORT_NEEDLES, length: 30 });
  }
  paintPath(painter, main, [3, 1], TWIG);
  paintNeedlesAlong(painter, main, { ...SHORT_NEEDLES, length: 38 });
};

/** Paints every foliage cell (deterministic per seed). */
export const createFoliageAtlas = (seed: number) => {
  const canvas = createAtlasCanvas(FOLIAGE_ATLAS_SIZE, FOLIAGE_ATLAS_SIZE);
  canvas.color.fill(0.06);
  const toArea = (rect: AtlasRect): CellArea => ({
    height: (rect.v1 - rect.v0) * FOLIAGE_ATLAS_SIZE,
    width: (rect.u1 - rect.u0) * FOLIAGE_ATLAS_SIZE,
    x: rect.u0 * FOLIAGE_ATLAS_SIZE,
    y: rect.v0 * FOLIAGE_ATLAS_SIZE
  });
  LEAF_SPRAY_RECTS.forEach((rect, variant) =>
    paintSpeciesSpray(
      createPainter(canvas, toArea(rect), createRandom(seed + variant), variant * 10_000),
      SPRAY_SPECIES[variant]!
    )
  );
  NEEDLE_SPRAY_RECTS.forEach((rect, variant) =>
    paintSpruceSpray(
      createPainter(
        canvas,
        toArea(rect),
        createRandom(seed + 50 + variant),
        100_000 + variant * 10_000
      )
    )
  );
  OAK_SPRAY_RECTS.forEach((rect, variant) =>
    paintOakSpray(
      createPainter(
        canvas,
        toArea(rect),
        createRandom(seed + 70 + variant),
        300_000 + variant * 1000
      )
    )
  );
  CHERRY_SPRAY_RECTS.forEach((rect, variant) =>
    paintCherrySpray(createPainter(canvas, toArea(rect), createRandom(seed + 130 + variant),
      500_000 + variant * 1000))
  );
  BIRCH_RECTS.forEach((rect, cell) =>
    paintBirchCell(
      canvas,
      toArea(rect),
      BIRCH_CELL_KINDS[cell]!,
      seed + 110 + cell,
      400_000 + cell * 1000
    )
  );
  PALM_RECTS.forEach((rect, cell) =>
    paintPalmCell(canvas, toArea(rect), cell, seed + 90 + cell, 200_000 + cell * 10_000)
  );
  const painted = finishCanvas(canvas, 6);
  const regions = getFoliageAtlasPixelRegions(FOLIAGE_ATLAS_SIZE);
  painted.colorMips = buildAtlasMips(
    painted.color, FOLIAGE_ATLAS_SIZE, FOLIAGE_ATLAS_SIZE, regions, { maxLevels: 4 }
  );
  painted.normalMips = buildAtlasMips(
    painted.normal, FOLIAGE_ATLAS_SIZE, FOLIAGE_ATLAS_SIZE, regions, {
      maxLevels: 4, mode: "normal"
    }
  );
  return painted;
};
