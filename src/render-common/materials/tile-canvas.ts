/**
 * Tileable paint buffer for ground materials. Every stamp wraps around the tile edges and is
 * height tested: a stamp only covers what lies below it, so blades grow over soil, pebbles sink
 * into it and leaves rest on top, like a z-buffer for painted debris.
 */
export interface TileCanvas {
  readonly color: Float32Array;
  readonly height: Float32Array;
  readonly mask: number;
  readonly roughness: Float32Array;
  readonly size: number;
}

/** Colour (sRGB 0..1) and roughness of one stamp; reused as scratch to avoid allocations. */
export interface Paint {
  b: number;
  g: number;
  r: number;
  roughness: number;
}

export type Rgb = readonly [number, number, number];

export const createPaint = (): Paint => ({ b: 0, g: 0, r: 0, roughness: 1 });

/** Sets the paint to `from` mixed towards `to`, scaled by `shade`. */
export const setPaint = (paint: Paint, from: Rgb, to: Rgb, amount: number, shade = 1) => {
  paint.r = (from[0] + (to[0] - from[0]) * amount) * shade;
  paint.g = (from[1] + (to[1] - from[1]) * amount) * shade;
  paint.b = (from[2] + (to[2] - from[2]) * amount) * shade;
};

/** Blends the paint towards the colour `from`..`to` at `t`, by `amount` (0 keeps the paint). */
export const blendPaint = (paint: Paint, from: Rgb, to: Rgb, t: number, amount: number) => {
  paint.r += (from[0] + (to[0] - from[0]) * t - paint.r) * amount;
  paint.g += (from[1] + (to[1] - from[1]) * t - paint.g) * amount;
  paint.b += (from[2] + (to[2] - from[2]) * t - paint.b) * amount;
};

export const createTileCanvas = (size: number): TileCanvas => {
  if ((size & (size - 1)) !== 0) throw new Error(`Tile size ${size} must be a power of two`);
  return {
    color: new Float32Array(size * size * 3),
    height: new Float32Array(size * size).fill(-1),
    mask: size - 1,
    roughness: new Float32Array(size * size).fill(1),
    size
  };
};

/** Integer hash of a texel, 0..1: per texel speckle without a noise lookup. */
export const hashTexel = (x: number, y: number, salt: number) => {
  let value = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
};

/** Writes the base layer of a texel unconditionally (soil, rock body, snow). */
export const writeBase = (canvas: TileCanvas, index: number, paint: Paint, height: number) => {
  canvas.color[index * 3] = paint.r;
  canvas.color[index * 3 + 1] = paint.g;
  canvas.color[index * 3 + 2] = paint.b;
  canvas.height[index] = height;
  canvas.roughness[index] = paint.roughness;
};

/** Height tested deposit with partial coverage (anti aliased stamp edges). */
const depositTexel = (
  canvas: TileCanvas,
  x: number,
  y: number,
  height: number,
  paint: Paint,
  coverage: number
) => {
  const index = (y & canvas.mask) * canvas.size + (x & canvas.mask);
  const current = canvas.height[index]!;
  if (height <= current) return;
  const offset = index * 3;
  canvas.color[offset] = canvas.color[offset]! + (paint.r - canvas.color[offset]!) * coverage;
  canvas.color[offset + 1] =
    canvas.color[offset + 1]! + (paint.g - canvas.color[offset + 1]!) * coverage;
  canvas.color[offset + 2] =
    canvas.color[offset + 2]! + (paint.b - canvas.color[offset + 2]!) * coverage;
  canvas.height[index] = current + (height - current) * coverage;
  canvas.roughness[index] =
    canvas.roughness[index]! + (paint.roughness - canvas.roughness[index]!) * coverage;
};

/** Round stamp with a dome profile (`dome` = extra height at the centre). */
export const stampDisc = (
  canvas: TileCanvas,
  centerX: number,
  centerY: number,
  radius: number,
  height: number,
  dome: number,
  paint: Paint
) => {
  const reach = Math.ceil(radius + 1);
  const baseX = Math.floor(centerX);
  const baseY = Math.floor(centerY);
  for (let y = baseY - reach; y <= baseY + reach; y += 1) {
    for (let x = baseX - reach; x <= baseX + reach; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      const coverage = Math.min(1, radius + 0.5 - distance);
      if (coverage <= 0) continue;
      const falloff = Math.max(0, 1 - (distance / Math.max(radius, 0.5)) ** 2);
      depositTexel(canvas, x, y, height + dome * Math.sqrt(falloff), paint, coverage);
    }
  }
};

/** A curved, tapering line: grass blades, needles, twigs and roots. */
export interface Stroke {
  angle: number;
  /** Total change of direction from base to tip (radians). */
  bend: number;
  baseHeight: number;
  length: number;
  /** 0 keeps the width, 1 ends in a point. */
  taper: number;
  tipHeight: number;
  /** Sideways meander (radians) and its frequency along the stroke. */
  wiggle: number;
  wiggleFrequency: number;
  width: number;
  x: number;
  y: number;
}

/** Paints a stroke as overlapping discs; `colorAt(t)` updates the paint along the stroke. */
export const stampStroke = (
  canvas: TileCanvas,
  stroke: Stroke,
  paint: Paint,
  colorAt?: (t: number) => void,
  heightAt?: (t: number) => number
) => {
  const steps = Math.max(2, Math.ceil(stroke.length * 1.5));
  const stepLength = stroke.length / steps;
  let x = stroke.x;
  let y = stroke.y;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle =
      stroke.angle +
      stroke.bend * t * t +
      stroke.wiggle * Math.sin(t * stroke.wiggleFrequency * Math.PI * 2 + stroke.x);
    colorAt?.(t);
    const radius = (stroke.width * (1 - stroke.taper * t * 0.92)) / 2;
    const height = heightAt
      ? heightAt(t)
      : stroke.baseHeight + (stroke.tipHeight - stroke.baseHeight) * t;
    stampDisc(canvas, x, y, radius, height, Math.min(0.05, radius * 0.03), paint);
    x += Math.cos(angle) * stepLength;
    y += Math.sin(angle) * stepLength;
  }
};

/** Irregular stone outline: lobes for rounded pebbles, polygon facets for angular grit. */
export interface Stone {
  /** 0 rounded, 1 angular (polygon with `facets` sides). */
  angularity: number;
  baseHeight: number;
  dome: number;
  facets: number;
  /** 0..1, profile height where the top flattens (stylised flat topped stones). */
  flatTop: number;
  lobes: readonly [number, number, number];
  radius: number;
  rotation: number;
  /** How much the albedo darkens towards the rim (0 none). */
  rimShade: number;
  speckle: number;
  x: number;
  y: number;
}

const getStoneRadius = (stone: Stone, theta: number) => {
  const [a, b, c] = stone.lobes;
  const lobed =
    1 +
    a * Math.sin(theta * 2 + stone.rotation) +
    b * Math.sin(theta * 3 + stone.rotation * 2.3) +
    c * Math.sin(theta * 5 + stone.rotation * 0.7);
  const sector = (Math.PI * 2) / stone.facets;
  const local = ((((theta - stone.rotation) % sector) + sector) % sector) - sector / 2;
  const polygon = Math.cos(sector / 2) / Math.cos(local);
  return stone.radius * (lobed + (polygon - lobed) * stone.angularity);
};

export const stampStone = (canvas: TileCanvas, stone: Stone, paint: Paint, salt: number) => {
  const reach = Math.ceil(stone.radius * 1.6 + 1);
  const baseX = Math.floor(stone.x);
  const baseY = Math.floor(stone.y);
  const scratch: Paint = { ...paint };
  for (let y = baseY - reach; y <= baseY + reach; y += 1) {
    for (let x = baseX - reach; x <= baseX + reach; x += 1) {
      const dx = x + 0.5 - stone.x;
      const dy = y + 0.5 - stone.y;
      const outline = getStoneRadius(stone, Math.atan2(dy, dx));
      const distance = Math.hypot(dx, dy);
      const coverage = Math.min(1, outline + 0.5 - distance);
      if (coverage <= 0) continue;
      const normalised = Math.min(1, distance / outline);
      const profile = Math.min(1, Math.sqrt(1 - normalised * normalised) / stone.flatTop);
      const shade =
        (1 - stone.rimShade * (1 - profile)) *
        (1 - stone.speckle + hashTexel(x, y, salt) * stone.speckle * 2);
      scratch.r = paint.r * shade;
      scratch.g = paint.g * shade;
      scratch.b = paint.b * shade;
      depositTexel(canvas, x, y, stone.baseHeight + stone.dome * profile, scratch, coverage);
    }
  }
};

/** Almond shaped leaf with a darker midrib, edges curling up. */
export interface Leaf {
  angle: number;
  curl: number;
  height: number;
  length: number;
  width: number;
  x: number;
  y: number;
}

export const stampLeaf = (canvas: TileCanvas, leaf: Leaf, paint: Paint) => {
  const reach = Math.ceil(leaf.length / 2 + 1);
  const baseX = Math.floor(leaf.x);
  const baseY = Math.floor(leaf.y);
  const cos = Math.cos(leaf.angle);
  const sin = Math.sin(leaf.angle);
  const scratch: Paint = { ...paint };
  for (let y = baseY - reach; y <= baseY + reach; y += 1) {
    for (let x = baseX - reach; x <= baseX + reach; x += 1) {
      const dx = x + 0.5 - leaf.x;
      const dy = y + 0.5 - leaf.y;
      const along = (dx * cos + dy * sin) / leaf.length + 0.5;
      if (along <= 0 || along >= 1) continue;
      const across = Math.abs(-dx * sin + dy * cos);
      const halfWidth = (leaf.width / 2) * Math.sin(Math.PI * along) ** 0.75;
      const coverage = Math.min(1, halfWidth + 0.5 - across);
      if (coverage <= 0) continue;
      const edge = across / Math.max(halfWidth, 0.5);
      const shade = (across < 0.6 ? 0.8 : 1) * (0.92 + along * 0.12);
      scratch.r = paint.r * shade;
      scratch.g = paint.g * shade;
      scratch.b = paint.b * shade;
      depositTexel(canvas, x, y, leaf.height + leaf.curl * edge * edge, scratch, coverage);
    }
  }
};
