export type ArtPoint = readonly [number, number];
export type ArtPath = readonly ArtPoint[];
export const artLine = (x: number, y: number, a: ArtPoint, b: ArtPoint, width = .035) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length)) : 0;
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) < width;
};
export const artPath = (x: number, y: number, path: ArtPath, width = .035) =>
  path.slice(1).some((point, index) => artLine(x, y, path[index]!, point, width));
export const artEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
export const artRing = (x: number, y: number, cx: number, cy: number, radius: number, width = .035) =>
  Math.abs(Math.hypot(x - cx, y - cy) - radius) < width;
export const artPolygon = (x: number, y: number, points: ArtPath) => {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index]!, b = points[previous]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
export const artWheat = (x: number, y: number) => {
  if (artLine(x, y, [0, -.78], [0, .8], .025)) return true;
  for (const side of [-1, 1]) for (let row = 0; row < 5; row++) {
    const cy = -.62 + row * .22;
    if (artLine(x, y, [0, cy + .13], [side * .22, cy - .04], .07)) return true;
  }
  return false;
};
export const artAxe = (x: number, y: number) => artLine(x, y, [-.18, .73], [.14, -.66], .045) ||
  artPolygon(x, y, [[.05, -.68], [.47, -.55], [.43, -.18], [.10, -.30]]);
export const artMountain = (x: number, y: number) => {
  const range = artPolygon(x, y, [[-.94, .66], [-.44, -.47], [-.16, .05], [.29, -.79],
    [.55, -.25], [.91, .66]]);
  if (!range) return false;
  const leftSnow = artPolygon(x, y, [[-.56, -.18], [-.44, -.44], [-.29, -.15], [-.42, -.23]]);
  const rightSnow = artPolygon(x, y, [[.08, -.37], [.29, -.74], [.47, -.36], [.31, -.46], [.22, -.34]]);
  const folds = artPath(x, y, [[.29, -.47], [.20, -.10], [.35, .22], [.27, .58]], .022) ||
    artPath(x, y, [[-.42, -.18], [-.30, .17], [-.40, .54]], .019) ||
    artPath(x, y, [[.52, .14], [.67, .42], [.61, .61]], .018);
  return !(leftSnow || rightSnow || folds);
};
