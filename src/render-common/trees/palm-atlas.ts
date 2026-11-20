import { lerp3, smoothstep } from "../../shared/world/noise";
import { createRandom, type Random } from "../../shared/world/rng";
import { type AtlasCanvas,writePixel } from "./atlas-canvas";
import { type CellArea, paintStem, type Rgb } from "./foliage-strokes";

/**
 * Palm atlas cells (PALM_BRIEF.md): pinnate fronds along u (rachis at the cell's middle row,
 * leaflets to both sides), two leaflet group cards, one fan leaf. Original procedural strokes.
 */
export const PALM_CELL = {
  green01: 0,
  green02: 1,
  young01: 2,
  old01: 3,
  dryTip01: 4,
  leaflet01: 5,
  leaflet02: 6,
  fan01: 7
} as const;

export const PALM_CELL_COUNT = 8;

type Point = readonly [number, number];

interface Brush {
  area: CellArea;
  canvas: AtlasCanvas;
  first: number;
  random: Random;
  stroke: number;
}

const nextStroke = (brush: Brush) => {
  brush.stroke += 1;
  return { layer: (brush.stroke - brush.first) * 0.004, surface: brush.stroke };
};


const vary = (color: Rgb, random: Random, amount: number): Rgb => {
  const factor = 1 - amount / 2 + random() * amount;
  return [color[0] * factor * (0.95 + random() * 0.1), color[1] * factor, color[2] * factor];
};

/** One long, narrow, pointed leaflet on a curved centre line. */
interface LeafletStroke {
  /** Wider on one side (subtle asymmetry), -0.2..0.2. */
  asymmetry: number;
  base: Point;
  /** Centre line bow as a share of the length (positive: towards the left of base -> tip). */
  bend: number;
  color: Rgb;
  /** Split along the midrib from this share of the length (1: whole). */
  splitFrom: number;
  tip: Point;
  /** Tip colour (yellowing or dry) and where it starts along the leaflet. */
  tipColor: Rgb;
  tipFrom: number;
  /** Half width at the widest point (pixels). */
  width: number;
}

/** Half width profile: narrow base, long parallel body, drawn-out point. */
const getLeafletHalfWidth = (t: number) =>
  Math.min(1, 0.45 + t * 5) * (1 - smoothstep(0.42, 1, t) * 0.96);

const bezier = (stroke: LeafletStroke, t: number): Point => {
  const [baseX, baseY] = stroke.base;
  const [tipX, tipY] = stroke.tip;
  const middleX = (baseX + tipX) / 2 - (tipY - baseY) * stroke.bend;
  const middleY = (baseY + tipY) / 2 + (tipX - baseX) * stroke.bend;
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * baseX + b * middleX + c * tipX, a * baseY + b * middleY + c * tipY];
};

/**
 * Leaflet pixel: darker edges, a lighter yellow-green midrib, faint longitudinal veins (low
 * contrast, gone at distance once mipmapped), a keeled relief for the restrained normal map.
 */
const paintLeafletPixel = (
  brush: Brush,
  stroke: LeafletStroke,
  id: { layer: number; surface: number },
  pixel: { across: number; coverage: number; t: number; x: number; y: number }
) => {
  const across = Math.abs(pixel.across);
  const midrib = 1 - smoothstep(0.06, 0.2, across);
  const vein = smoothstep(0.82, 1, Math.abs(Math.sin(across * Math.PI * 2.5)));
  const tone = (0.84 + (1 - across) * 0.16) * (1 - vein * 0.05) * (1 + midrib * 0.14);
  const tipMix = smoothstep(stroke.tipFrom, stroke.tipFrom + 0.22, pixel.t);
  const color = lerp3(stroke.color, stroke.tipColor, tipMix);
  writePixel(brush.canvas, brush.area.x + pixel.x, brush.area.y + pixel.y, {
    color: [color[0] * tone * (1 + midrib * 0.12), color[1] * tone, color[2] * tone],
    coverage: pixel.coverage,
    relief: id.layer + (1 - across * across) * 0.22 + midrib * 0.06 - vein * 0.025,
    surface: id.surface
  });
};

const isInsideArea = (area: CellArea, x: number, y: number) =>
  x >= 0 && y >= 0 && x < area.width && y < area.height;

/** Rasterises the leaflet segment by segment along its centre line. */
const paintLeaflet = (brush: Brush, stroke: LeafletStroke) => {
  const id = nextStroke(brush);
  const length = Math.hypot(stroke.tip[0] - stroke.base[0], stroke.tip[1] - stroke.base[1]);
  const segments = Math.max(4, Math.ceil(length / 4));
  for (let segment = 0; segment < segments; segment += 1) {
    const t0 = segment / segments;
    const t1 = (segment + 1) / segments;
    const from = bezier(stroke, t0);
    const to = bezier(stroke, t1);
    const dirX = to[0] - from[0];
    const dirY = to[1] - from[1];
    const lengthSquared = Math.max(1e-6, dirX * dirX + dirY * dirY);
    const reach = stroke.width * 1.3 + 1;
    for (
      let y = Math.floor(Math.min(from[1], to[1]) - reach);
      y <= Math.max(from[1], to[1]) + reach;
      y += 1
    ) {
      for (
        let x = Math.floor(Math.min(from[0], to[0]) - reach);
        x <= Math.max(from[0], to[0]) + reach;
        x += 1
      ) {
        if (!isInsideArea(brush.area, x, y)) continue;
        const s = Math.min(
          1,
          Math.max(0, ((x - from[0]) * dirX + (y - from[1]) * dirY) / lengthSquared)
        );
        const t = t0 + (t1 - t0) * s;
        const offsetX = x - from[0] - dirX * s;
        const offsetY = y - from[1] - dirY * s;
        const side = Math.sign(dirX * offsetY - dirY * offsetX) || 1;
        const half = stroke.width * getLeafletHalfWidth(t) * (1 + stroke.asymmetry * side);
        const distance = Math.hypot(offsetX, offsetY);
        const coverage = Math.min(1, half - distance + 0.5);
        if (coverage <= 0 || half <= 0) continue;
        const across = (distance / Math.max(half, 0.5)) * side;
        if (t > stroke.splitFrom && Math.abs(across) < 0.16) continue;
        paintLeafletPixel(brush, stroke, id, { across, coverage, t, x, y });
      }
    }
  }
};

/** Look of one pinnate frond cell. */
interface FrondCellStyle {
  /** Leaflet angle forward from the rachis (radians) at the base and the tip. */
  angle: [number, number];
  /** Leaflet bow (share of length). */
  bend: number;
  /** Share of the half height the leaflets reach. */
  fill: number;
  greens: Rgb[];
  /** Leaflets grouped in twos and threes with gaps (date palms). */
  grouped: boolean;
  /** Chance a leaflet is missing / split. */
  missing: number;
  rachis: Rgb;
  /** Pixels between leaflets. */
  spacing: [number, number];
  split: number;
  /** Tip colour, the share of leaflets that get it and where it starts. */
  tip: { chance: number; color: Rgb; from: [number, number] };
  /** Leaflet half width range (pixels). */
  width: [number, number];
}

const HEALTHY_GREENS: Rgb[] = [
  [0.07, 0.15, 0.035],
  [0.085, 0.165, 0.04],
  [0.06, 0.135, 0.035]
];
const DARK_GREENS: Rgb[] = [
  [0.045, 0.11, 0.035],
  [0.055, 0.12, 0.04],
  [0.04, 0.1, 0.035]
];
const YOUNG_GREENS: Rgb[] = [
  [0.13, 0.22, 0.05],
  [0.15, 0.24, 0.06]
];
const OLD_GREENS: Rgb[] = [
  [0.1, 0.14, 0.04],
  [0.11, 0.15, 0.045]
];
const MIDRIB: Rgb = [0.22, 0.25, 0.08];
const YELLOW_TIP: Rgb = [0.27, 0.22, 0.05];
const DRY_TIP: Rgb = [0.3, 0.21, 0.1];
const NO_TIP = { chance: 0, color: YELLOW_TIP, from: [1, 1] as [number, number] };

const FROND_STYLES: Record<number, FrondCellStyle> = {
  [PALM_CELL.green01]: {
    angle: [1.05, 0.62],
    bend: 0.06,
    fill: 0.96,
    greens: HEALTHY_GREENS,
    grouped: false,
    missing: 0.02,
    rachis: MIDRIB,
    spacing: [10, 15],
    split: 0,
    tip: NO_TIP,
    width: [2.8, 3.6]
  },
  [PALM_CELL.green02]: {
    angle: [0.9, 0.55],
    bend: 0.03,
    fill: 0.92,
    greens: DARK_GREENS,
    grouped: true,
    missing: 0.03,
    rachis: [0.2, 0.22, 0.08],
    spacing: [7, 12],
    split: 0,
    tip: NO_TIP,
    width: [2.3, 3]
  },
  [PALM_CELL.young01]: {
    angle: [0.5, 0.32],
    bend: 0.02,
    fill: 0.82,
    greens: YOUNG_GREENS,
    grouped: false,
    missing: 0,
    rachis: [0.26, 0.29, 0.1],
    spacing: [9, 12],
    split: 0,
    tip: NO_TIP,
    width: [2.2, 2.8]
  },
  [PALM_CELL.old01]: {
    angle: [1.1, 0.68],
    bend: 0.08,
    fill: 0.98,
    greens: OLD_GREENS,
    grouped: false,
    missing: 0.06,
    rachis: [0.26, 0.25, 0.09],
    spacing: [11, 17],
    split: 0.06,
    tip: { chance: 0.45, color: YELLOW_TIP, from: [0.62, 0.85] },
    width: [2.7, 3.5]
  },
  [PALM_CELL.dryTip01]: {
    angle: [1.15, 0.72],
    bend: 0.1,
    fill: 0.98,
    greens: OLD_GREENS,
    grouped: false,
    missing: 0.12,
    rachis: [0.3, 0.26, 0.11],
    spacing: [11, 18],
    split: 0.14,
    tip: { chance: 0.85, color: DRY_TIP, from: [0.45, 0.75] },
    width: [2.6, 3.4]
  }
};

/** Leaflet reach along the frond: short at the base and at the tip, longest in the middle. */
const getCellSpan = (along: number) =>
  Math.min(1, 0.5 + along * 4) * (1 - smoothstep(0.86, 1, along) * 0.55);

const pickTip = (style: FrondCellStyle, random: Random) => {
  if (random() >= style.tip.chance) return { color: style.tip.color, from: 1.1 };
  const [from, to] = style.tip.from;
  return { color: style.tip.color, from: from + random() * (to - from) };
};

/** Leaflets of one side at one rachis position (the second of a group lies a bit steeper). */
const paintFrondLeaflet = (
  brush: Brush,
  style: FrondCellStyle,
  position: { along: number; groupIndex: number; side: number; x: number }
) => {
  const { area, random } = brush;
  const middle = area.height / 2;
  const { along, side, x } = position;
  const [baseAngle, tipAngle] = style.angle;
  const steeper = style.grouped ? position.groupIndex * 0.12 : 0;
  const angle = baseAngle + (tipAngle - baseAngle) * along + (random() - 0.5) * 0.12 - steeper;
  const span = (middle - 3) * style.fill * getCellSpan(along) * (0.86 + random() * 0.14);
  const length = span / Math.sin(Math.max(angle, 0.15));
  const tip = pickTip(style, random);
  const color = vary(style.greens[Math.floor(random() * style.greens.length)]!, random, 0.14);
  paintLeaflet(brush, {
    asymmetry: (random() - 0.5) * 0.3,
    base: [x, middle + side * 2],
    bend: side * (0.03 + random() * style.bend),
    color,
    splitFrom: random() < style.split ? 0.45 + random() * 0.3 : 1.1,
    tip: [x + Math.cos(angle) * length, middle + side * Math.sin(angle) * span],
    tipColor: tip.color,
    tipFrom: tip.from,
    width: style.width[0] + random() * (style.width[1] - style.width[0])
  });
};

/** Pinnate frond: irregular leaflet spacing (groups, gaps), then the rachis on top. */
const paintFrondCell = (brush: Brush, style: FrondCellStyle) => {
  const { area, random } = brush;
  let groupIndex = 0;
  for (let x = area.width * 0.02; x < area.width * 0.975;) {
    const along = x / area.width;
    for (const side of [-1, 1]) {
      if (random() < style.missing) continue;
      paintFrondLeaflet(brush, style, { along, groupIndex, side, x: x + side * random() * 2 });
    }
    const [min, max] = style.spacing;
    const groupGap = style.grouped && groupIndex === 2 ? max * 0.8 : 0;
    groupIndex = style.grouped ? (groupIndex + 1) % 3 : 0;
    x += min + random() * (max - min) + groupGap;
  }
  paintStem(brush.canvas, area, {
    ...nextStroke(brush),
    color: style.rachis,
    from: [0, area.height / 2],
    thickness: [5.5, 1.1],
    to: [area.width - 2, area.height / 2]
  });
};

/** Leaflet group card: a few leaflets fanning from the card's left edge (LOD0 detail). */
const paintLeafletCell = (brush: Brush, damaged: boolean) => {
  const { area, random } = brush;
  const middle = area.height / 2;
  const count = 3;
  for (let leaflet = 0; leaflet < count; leaflet += 1) {
    const spread = (leaflet - (count - 1) / 2) * 0.13 + (random() - 0.5) * 0.04;
    const length = area.width * (0.88 + random() * 0.1);
    const hurt = damaged && leaflet === 1;
    paintLeaflet(brush, {
      asymmetry: (random() - 0.5) * 0.25,
      base: [3, middle + spread * 40],
      bend: (random() - 0.5) * 0.08,
      color: vary(HEALTHY_GREENS[leaflet % HEALTHY_GREENS.length]!, random, 0.12),
      splitFrom: hurt ? 0.5 : 1.1,
      tip: [length, middle + Math.sin(spread) * length],
      tipColor: hurt ? YELLOW_TIP : HEALTHY_GREENS[0]!,
      tipFrom: hurt ? 0.7 : 1.1,
      width: area.height * 0.07
    });
  }
};

const FAN_GREEN: Rgb = [0.075, 0.13, 0.07];
const FAN_SEGMENTS = 21;

/**
 * Fan leaf (half disc, centre at the cell's bottom middle): pleated segments radiating from the
 * hastula, free and split at their tips, folds shaded light / dark, a faint costa line.
 */
const paintFanCell = (brush: Brush) => {
  const { area, random } = brush;
  const id = nextStroke(brush);
  const centreX = area.width / 2;
  const centreY = area.height - 3;
  const radius = Math.min(area.width / 2, area.height) - 6;
  const reach = Array.from({ length: FAN_SEGMENTS }, () => 0.86 + random() * 0.14);
  for (let y = 0; y < area.height; y += 1) {
    for (let x = 0; x < area.width; x += 1) {
      const dx = x - centreX;
      const dy = centreY - y;
      const r = Math.hypot(dx, dy) / radius;
      const phi = Math.atan2(dy, dx);
      if (r > 1 || phi < 0.06 || phi > Math.PI - 0.06) continue;
      const position = ((phi - 0.06) / (Math.PI - 0.12)) * FAN_SEGMENTS;
      const segment = Math.min(FAN_SEGMENTS - 1, Math.floor(position));
      const across = (position - segment) * 2 - 1;
      const free = smoothstep(0.55, 0.75, r);
      const notch = Math.abs(across) < 0.2 ? 0.16 * free : 0;
      const limit = reach[segment]! - notch - Math.abs(across) * 0.05;
      const gap = Math.abs(across) > 1 - free * 0.22;
      if (r > limit || gap || r < 0.03) continue;
      const fold = 0.86 + across * 0.16;
      const costa = 1 + (1 - smoothstep(0.02, 0.1, Math.abs(across))) * 0.12;
      const tone = fold * costa * (0.9 + r * 0.14);
      writePixel(brush.canvas, area.x + x, area.y + y, {
        color: [FAN_GREEN[0] * tone, FAN_GREEN[1] * tone, FAN_GREEN[2] * tone],
        coverage: Math.min(1, (limit - r) * radius + 0.5),
        relief: id.layer + (1 - Math.abs(across)) * 0.3,
        surface: id.surface + segment
      });
    }
  }
  brush.stroke += FAN_SEGMENTS;
};

/** Paints one palm cell (deterministic per seed); `first` keeps stroke ids unique. */
export const paintPalmCell = (
  canvas: AtlasCanvas,
  area: CellArea,
  cell: number,
  seed: number,
  first: number
) => {
  const brush: Brush = { area, canvas, first, random: createRandom(seed), stroke: first };
  if (cell === PALM_CELL.fan01) return paintFanCell(brush);
  if (cell === PALM_CELL.leaflet01 || cell === PALM_CELL.leaflet02) {
    return paintLeafletCell(brush, cell === PALM_CELL.leaflet02);
  }
  paintFrondCell(brush, FROND_STYLES[cell]!);
};
