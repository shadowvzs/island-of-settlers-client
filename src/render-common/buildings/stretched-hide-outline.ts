import { DMath } from "../../shared/math/deterministic-math";
/**
 * Outline of a whole animal hide pegged out flesh side up: one piece with the neck at the top,
 * four leg flaps pulled towards the frame corners, a tail stub and a gently irregular, slightly
 * asymmetric edge. Points are in the unit box (x and y in -0.5…0.5); the recipe part's size
 * scales them, and the lacing cords start at the same points the mesh uses.
 */
export type HidePoint = readonly [number, number];

interface HideLobe { amplitude: number; angle: number; width: number }

/** Angles run clockwise from the neck (+y). Left and right legs differ slightly, as real hides do. */
const HIDE_LOBES: readonly HideLobe[] = [
  { amplitude: .13, angle: 0, width: .26 },
  { amplitude: .25, angle: .98, width: .15 },
  { amplitude: .23, angle: -.94, width: .16 },
  { amplitude: .28, angle: 2.27, width: .15 },
  { amplitude: .26, angle: -2.24, width: .16 },
  { amplitude: .09, angle: Math.PI, width: .06 }
];
/** The trunk is a rounded rectangle (superellipse), not an oval. */
const BODY_RADIUS_X = .25;
const BODY_RADIUS_Y = .38;
const BODY_SQUARENESS = 3.2;
/** Flanks between the legs are drawn in where the belly skin was cut. */
const FLANK_DIP = .03;
const DENSE_SAMPLES = 720;

const angularDistance = (a: number, b: number) => DMath.atan2(DMath.sin(a - b), DMath.cos(a - b));

const lobeLift = (angle: number) => HIDE_LOBES.reduce((total, lobe) =>
  total + lobe.amplitude * DMath.exp(-((angularDistance(angle, lobe.angle) / lobe.width) ** 2)), 0);

/** Small, non-repeating waviness: a knife-cut edge, never a smooth geometric curve. */
const edgeWobble = (angle: number) =>
  .012 * DMath.sin(angle * 7 + .6) + .008 * DMath.sin(angle * 13 + 2.1) + .005 * DMath.sin(angle * 23 + 4.4);

const hideRadius = (angle: number) => {
  const across = Math.abs(DMath.sin(angle) / BODY_RADIUS_X) ** BODY_SQUARENESS;
  const along = Math.abs(DMath.cos(angle) / BODY_RADIUS_Y) ** BODY_SQUARENESS;
  const trunk = (across + along) ** (-1 / BODY_SQUARENESS);
  return trunk + lobeLift(angle) - FLANK_DIP * DMath.sin(angle) ** 8 + edgeWobble(angle);
};

const denseOutline = (): HidePoint[] => Array.from({ length: DENSE_SAMPLES }, (_, index) => {
  const angle = index / DENSE_SAMPLES * Math.PI * 2, radius = hideRadius(angle);
  return [DMath.sin(angle) * radius, DMath.cos(angle) * radius];
});

const normalizedToUnitBox = (points: HidePoint[]): HidePoint[] => {
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return points.map(([x, y]) => [(x - minX) / (maxX - minX) - .5, (y - minY) / (maxY - minY) - .5]);
};

/** Equal steps along the edge, so the long leg flaps get as many vertices as the flanks. */
const resampledByLength = (points: HidePoint[], count: number): HidePoint[] => {
  const lengths = [0];
  for (let index = 1; index <= points.length; index++) {
    const [ax, ay] = points[index - 1]!, [bx, by] = points[index % points.length]!;
    lengths.push(lengths[index - 1]! + DMath.hypot(bx - ax, by - ay));
  }
  const total = lengths[points.length]!, result: HidePoint[] = [];
  let segment = 0;
  for (let sample = 0; sample < count; sample++) {
    const target = sample / count * total;
    while (lengths[segment + 1]! < target) segment++;
    const [ax, ay] = points[segment]!, [bx, by] = points[(segment + 1) % points.length]!;
    const amount = (target - lengths[segment]!) / Math.max(1e-9, lengths[segment + 1]! - lengths[segment]!);
    result.push([ax + (bx - ax) * amount, ay + (by - ay) * amount]);
  }
  return result;
};

const outlineCache = new Map<number, HidePoint[]>();

/** The hide edge with `count` vertices, clockwise from the neck, in the unit box. */
export const stretchedHideOutline = (count: number): HidePoint[] => {
  const cached = outlineCache.get(count);
  if (cached) return cached;
  const outline = resampledByLength(normalizedToUnitBox(denseOutline()), count);
  outlineCache.set(count, outline);
  return outline;
};

/** Lacing holes, as angles: the neck, each leg tip, the tail and the flanks between them. */
const LACING_ANGLES = [0, .98, -.94, 2.28, -2.25, Math.PI, 1.6, -1.6, .45, -.45, 2.65, -2.63, 1.25, -1.22];
/** Minimal keeps the neck, leg tips, tail and flank midpoints. */
const MINIMAL_LACING = 8;

/** Edge points (unit box) where the lacing cords pass through the hide. */
export const stretchedHideLacingPoints = (detailed: boolean): HidePoint[] => {
  const dense = normalizedToUnitBox(denseOutline());
  const angles = detailed ? LACING_ANGLES : LACING_ANGLES.slice(0, MINIMAL_LACING);
  return angles.map(angle => {
    const index = Math.round((angle / (Math.PI * 2) + 1) % 1 * DENSE_SAMPLES) % DENSE_SAMPLES;
    const [x, y] = dense[index]!;
    // The hole sits just inside the edge, so the cord visibly pierces the skin.
    return [x * .96, y * .96];
  });
};
