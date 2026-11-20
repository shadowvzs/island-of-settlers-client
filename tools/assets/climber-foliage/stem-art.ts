import { type FoliageElement, paintElement, type Rgb, shadedColour, type TilePainter } from "./foliage-canvas";
import { clamp01, fractalNoise, mix } from "./foliage-noise";

export type Point = readonly [number, number];

export interface StemStyle {
  base: Rgb;
  roughness: number;
  tint: number;
  translucency: number;
}

export interface StemSpec {
  /** Quadratic Bezier start, control and end in tile UV. */
  curve: readonly [Point, Point, Point];
  /** Radius at the start and end, in tile UV. */
  radius: readonly [number, number];
  salt: number;
  shadow?: number;
  style: StemStyle;
}

const SEGMENTS = 18;

export const bezierPoint = ([a, b, c]: readonly [Point, Point, Point], t: number): [number, number] => {
  const s = 1 - t;
  return [s * s * a[0] + 2 * s * t * b[0] + t * t * c[0], s * s * a[1] + 2 * s * t * b[1] + t * t * c[1]];
};

/** Direction angle (0 = +v, positive towards +u) of the curve at t. */
export const bezierAngle = ([a, b, c]: readonly [Point, Point, Point], t: number) => {
  const du = 2 * (1 - t) * (b[0] - a[0]) + 2 * t * (c[0] - b[0]);
  const dv = 2 * (1 - t) * (b[1] - a[1]) + 2 * t * (c[1] - b[1]);
  return Math.atan2(du, dv);
};

interface Nearest { across: number; distance: number; t: number }

const nearestOnPolyline = (points: readonly Point[], u: number, v: number): Nearest => {
  let best: Nearest = { across: 0, distance: Infinity, t: 0 };
  for (let index = 0; index < points.length - 1; index += 1) {
    const [au, av] = points[index]!, [bu, bv] = points[index + 1]!;
    const du = bu - au, dv = bv - av, lengthSquared = du * du + dv * dv || 1e-9;
    const along = clamp01(((u - au) * du + (v - av) * dv) / lengthSquared);
    const pu = au + du * along, pv = av + dv * along;
    const distance = Math.hypot(u - pu, v - pv);
    if (distance >= best.distance) continue;
    const side = Math.sign(du * (v - av) - dv * (u - au)) || 1;
    best = { across: side * distance, distance, t: (index + along) / (points.length - 1) };
  }
  return best;
};

/** Tapered round stem (rachis, petiole, pedicel, cane, rootlet) along a quadratic curve. */
export const stemElement = (spec: StemSpec): FoliageElement => {
  const points = Array.from({ length: SEGMENTS + 1 }, (_, index) => bezierPoint(spec.curve, index / SEGMENTS));
  const radiusAt = (t: number) => mix(spec.radius[0], spec.radius[1], t);
  const pad = Math.max(...spec.radius) * 1.5;
  const us = points.map(point => point[0]), vs = points.map(point => point[1]);
  return {
    bounds: [Math.min(...us) - pad, Math.min(...vs) - pad, Math.max(...us) + pad, Math.max(...vs) + pad],
    distance: (u, v) => {
      const nearest = nearestOnPolyline(points, u, v);
      return nearest.distance - radiusAt(nearest.t);
    },
    frame: { angle: 0, length: 1, origin: [0, 0] },
    shade: (u, v) => {
      const nearest = nearestOnPolyline(points, u, v), radius = radiusAt(nearest.t);
      const across = Math.max(-1, Math.min(1, nearest.across / radius));
      const round = Math.sqrt(1 - across * across);
      const streak = fractalNoise(nearest.t * 60, across * 3, spec.salt) * 0.12;
      const highlight = Math.exp(-(((across + 0.35) / 0.25) ** 2)) * 0.14;
      return {
        colour: shadedColour(spec.style.base, 0.68 + round * 0.3 + highlight + streak),
        relief: 0.6 * (1 - across * across) * radius,
        roughness: spec.style.roughness,
        tint: spec.style.tint,
        translucency: spec.style.translucency * (0.4 + 0.3 * (1 - round))
      };
    },
    shadow: spec.shadow ?? 0.28
  };
};

export const paintStem = (painter: TilePainter, spec: StemSpec) => paintElement(painter, stemElement(spec));

export interface PrickleSpec {
  angle: number;
  length: number;
  origin: Point;
  style: StemStyle;
}

/** A broad-based, slightly hooked rose prickle (local y from the cane outwards). */
export const paintPrickle = (painter: TilePainter, spec: PrickleSpec) => paintElement(painter, {
  bounds: [-0.45, -0.05, 0.7, 1.02],
  distance: (x, y) => {
    const hooked = x - 0.32 * y * y, width = 0.34 * Math.pow(clamp01(1 - y), 1.25);
    return Math.max(Math.abs(hooked) - width, -y, y - 1);
  },
  frame: { angle: spec.angle, length: spec.length, origin: spec.origin },
  shade: (x, y) => {
    const tipDark = 1 - 0.35 * y, side = 0.85 + 0.25 * Math.max(0, -x * 2);
    return { colour: shadedColour(spec.style.base, tipDark * side), relief: (1 - y) * 0.12,
      roughness: 0.45, tint: spec.style.tint, translucency: 0.15 };
  },
  shadow: 0.2
});
