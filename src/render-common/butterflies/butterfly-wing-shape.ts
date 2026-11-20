/**
 * Butterfly wing outlines on the wing card (wingspan units: x forward, z out from the body).
 * Each wing is a polar outline around the wing root: a straight front edge (the forewing's
 * costa) at the first angle, a curved margin through the radius keys, a straight inner edge at
 * the last angle. The forewing lies over the hindwing.
 */

/** Wing card bounds: every species' outline fits inside (forward / back and out). */
export const CARD_X_MIN = -0.3;
export const CARD_X_MAX = 0.34;
export const CARD_Z_MAX = 0.52;
export const WING_ROOT_X = 0.02;
export const WING_ROOT_Z = 0.015;

/** One wing: radius keys [angle from forward (radians), radius] in increasing angle order. */
export interface WingOutline {
  keys: readonly (readonly [number, number])[];
  /** Scalloped margin: waves over the whole margin and their depth (share of the radius). */
  scallopDepth?: number;
  scallops?: number;
}

export interface WingShape {
  fore: WingOutline;
  hind: WingOutline;
}

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 *
  (2 * p1 +
    (p2 - p0) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (3 * p1 - p0 - 3 * p2 + p3) * t ** 3);

/** Margin radius of a wing at an angle (0 outside its angle range): smooth through the keys. */
export const getOutlineRadius = (outline: WingOutline, angle: number) => {
  const { keys } = outline;
  const first = keys[0]![0];
  const last = keys[keys.length - 1]![0];
  if (angle < first || angle > last) return 0;
  let segment = 0;
  while (segment < keys.length - 2 && angle > keys[segment + 1]![0]) segment += 1;
  const [from, radiusA] = keys[segment]!;
  const [to, radiusB] = keys[segment + 1]!;
  const before = keys[Math.max(0, segment - 1)]![1];
  const after = keys[Math.min(keys.length - 1, segment + 2)]![1];
  const radius = catmullRom(before, radiusA, radiusB, after, (angle - from) / (to - from));
  const scallops = outline.scallops ?? 0;
  if (scallops === 0) return radius;
  const wave = 0.5 - 0.5 * Math.cos(((angle - first) / (last - first)) * Math.PI * 2 * scallops);
  return radius * (1 - (outline.scallopDepth ?? 0) * wave);
};

/**
 * A card point as the painters see it: which wing, `radial` 0 at the root .. 1 at the margin,
 * `across` 0 at the front edge .. 1 at the inner edge, `toMargin` its distance to the outline
 * (wingspan units), the card position, and `coverage` 0..1 (anti-aliased outline).
 */
export interface WingPixel {
  across: number;
  angle: number;
  coverage: number;
  fore: boolean;
  /** Distance (wingspan units) outside the forewing's outline, on the hindwing (its shadow). */
  foreGap: number;
  /** Signed distance inside the wings (wingspan units, negative outside). */
  inside: number;
  radial: number;
  toMargin: number;
  x: number;
  z: number;
}

/** Signed distance inside a wing (wingspan units, negative outside). */
const getInside = (outline: WingOutline, radius: number, angle: number) => {
  const keys = outline.keys;
  const margin = getOutlineRadius(outline, angle) - radius;
  const fromFront = radius * Math.sin(angle - keys[0]![0]);
  const fromInner = radius * Math.sin(keys[keys.length - 1]![0] - angle);
  return Math.min(margin, fromFront, fromInner);
};

/** The painters' view of a card point; `texel` is the anti-aliasing width (wingspan units). */
export const getWingPixel = (shape: WingShape, x: number, z: number, texel: number) => {
  const dx = x - WING_ROOT_X;
  const dz = z - WING_ROOT_Z;
  const radius = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const foreInside = getInside(shape.fore, radius, angle);
  const hindInside = getInside(shape.hind, radius, angle);
  const fore = foreInside >= 0 || foreInside >= hindInside;
  const outline = fore ? shape.fore : shape.hind;
  const keys = outline.keys;
  const first = keys[0]![0];
  const last = keys[keys.length - 1]![0];
  const margin = Math.max(getOutlineRadius(outline, angle), 0.001);
  const inside = Math.max(foreInside, hindInside);
  return {
    across: Math.min(1, Math.max(0, (angle - first) / (last - first))),
    angle,
    coverage: Math.min(1, Math.max(0, inside / texel + 0.5)),
    fore,
    foreGap: fore ? 0 : -foreInside,
    inside,
    radial: Math.min(1, radius / margin),
    toMargin: Math.max(0, margin - radius),
    x,
    z
  } satisfies WingPixel;
};
