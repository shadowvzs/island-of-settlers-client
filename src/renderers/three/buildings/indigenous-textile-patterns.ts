import { indigenousHideDetail } from "./indigenous-surface-detail";
import type { SurfaceCoordinate, SurfaceSampler } from "./surface-detail-common";

type Point = readonly [number, number];
type Ink = [number, number, number];
const EARTH: Ink = [.69, .51, .37], CHARCOAL: Ink = [.52, .49, .43], OCHRE: Ink = [.8, .64, .42];

/** Faded mineral pigment lets the sewn skin's grain and mild tanning differences show through. */
const painted = (point: SurfaceCoordinate, ink?: Ink) => {
  const hide = indigenousHideDetail(point);
  if (!ink) return hide;
  const opacity = .38 - point.weather * .1;
  const colour = hide.colour.map((channel, index) =>
    channel * (1 - opacity) + ink[index]! * opacity) as Ink;
  return { ...hide, colour };
};

const nearLine = (x: number, y: number, a: Point, b: Point, width = .003) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < width;
};

const nearPath = (x: number, y: number, points: readonly Point[], width = .003) => {
  for (let at = 1; at < points.length; at++)
    if (nearLine(x, y, points[at - 1]!, points[at]!, width)) return true;
  return false;
};

// A bounded scene, not a tiled border: one small deer and a hunter with a bow.
const DEER_BACK: readonly Point[] = [[-.055, .018], [.012, .023], [.034, -.011], [.046, -.034], [.065, -.039]];
const DEER_LEGS: readonly (readonly Point[])[] = [
  [[-.05, .032], [-.065, .076], [-.078, .08]], [[-.025, .035], [-.017, .075]],
  [[.01, .03], [.03, .075]], [[.025, .025], [.046, .064]],
  [[.051, -.034], [.049, -.066], [.035, -.076]], [[.049, -.06], [.065, -.073]],
  [[-.064, .022], [-.083, .005]],
];
const HUNTER: readonly (readonly Point[])[] = [
  [[-.151, -.013], [-.15, .033], [-.177, .078]],
  [[-.15, .033], [-.126, .077]], [[-.15, 0], [-.125, .017], [-.099, -.006]],
  [[-.15, .003], [-.11, -.012]], [[-.106, -.04], [-.097, -.022], [-.096, .004], [-.109, .033]],
  [[-.106, -.04], [-.108, .033]], [[-.126, -.005], [-.071, -.008]],
];

export const indigenousHuntingHide: SurfaceSampler = point => {
  const x = (point.u - .17) * 2, y = point.v - .62;
  if (Math.abs(x) > .2 || Math.abs(y) > .1) return indigenousHideDetail(point);
  const torso = ((x + .019) / .043) ** 2 + ((y - .027) / .014) ** 2 < 1;
  const head = ((x - .061) / .015) ** 2 + ((y + .035) / .009) ** 2 < 1;
  const hunterHead = Math.hypot(x + .151, y + .028) < .01;
  const mark = torso || head || hunterHead || nearPath(x, y, DEER_BACK)
    || DEER_LEGS.some(path => nearPath(x, y, path)) || HUNTER.some(path => nearPath(x, y, path));
  return painted(point, mark ? EARTH : undefined);
};

/** One modest mountain ridge with a small sun; the rest of the hide remains unpainted. */
export const indigenousMountainHide: SurfaceSampler = point => {
  const x = (point.u - .16) * 2, y = point.v - .65;
  if (Math.abs(x) > .16 || Math.abs(y) > .09) return indigenousHideDetail(point);
  const ridge: readonly Point[] = [[-.14, .055], [-.065, -.045], [-.015, .02], [.045, -.065], [.135, .055]];
  const snow: readonly Point[] = [[-.085, -.019], [-.066, -.008], [-.048, -.023]];
  if (nearPath(x, y, ridge) || nearPath(x, y, snow)) return painted(point, CHARCOAL);
  return painted(point, Math.abs(Math.hypot(x + .13, y + .045) - .017) < .003 ? OCHRE : undefined);
};

/** A small paired-leaf sprig replaces the former repeated coloured stripe grid. */
export const indigenousReedHide: SurfaceSampler = point => {
  const x = (point.u - .16) * 2, y = point.v - .64;
  if (Math.abs(x) > .07 || Math.abs(y) > .1) return indigenousHideDetail(point);
  let mark = nearLine(x, y, [0, .09], [.008, -.09]);
  for (const side of [-1, 1]) for (const height of [-.04, .025]) {
    const localX = (x - side * .022) / .027, localY = (y - height) / .012;
    if (localX * localX + localY * localY < 1) mark = true;
  }
  return painted(point, mark ? CHARCOAL : undefined);
};

/** A single weathered sun, without rows of suns, bright rays or continuous hem bands. */
export const indigenousSunHide: SurfaceSampler = point => {
  const x = (point.u - .16) * 2, y = point.v - .64;
  const radius = Math.hypot(x, y);
  if (radius > .079) return indigenousHideDetail(point);
  const disc = Math.abs(radius - .04) < .004;
  const rays = radius > .055 && Math.cos(Math.atan2(y, x) * 8) > .94;
  return painted(point, disc || rays ? OCHRE : undefined);
};
