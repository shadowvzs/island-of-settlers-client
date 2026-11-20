type Point2 = readonly [number, number];
type Curve = readonly [Point2, Point2, Point2, Point2];
// Original filled ruyi-cloud silhouettes; no imported artwork or font dependency.
export const CHINESE_CLOUD_OUTLINE: readonly Curve[] = [
  [[-.48, -.07], [-.63, -.04], [-.61, .16], [-.45, .17]],
  [[-.45, .17], [-.39, .38], [-.10, .36], [-.08, .15]],
  [[-.08, .15], [.06, .35], [.31, .27], [.26, .10]],
  [[.26, .10], [.49, .17], [.61, -.04], [.43, -.11]],
  [[.43, -.11], [.27, -.18], [.07, -.08], [-.09, -.13]],
  [[-.09, -.13], [-.25, -.22], [-.36, -.18], [-.48, -.07]]
];
export const CHINESE_CLOUD_CURLS: readonly Curve[] = [
  [[-.46, .07], [-.49, .17], [-.31, .18], [-.31, .07]],
  [[-.31, .07], [-.31, -.04], [-.15, -.05], [-.12, .03]],
  [[.07, .07], [.19, .17], [.34, .07], [.24, -.01]]
];
export const sampleChineseCloudCurve = ([a, b, c, d]: Curve, t: number): Point2 => {
  const s = 1 - t;
  return [s ** 3 * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t ** 3 * d[0],
    s ** 3 * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t ** 3 * d[1]];
};

