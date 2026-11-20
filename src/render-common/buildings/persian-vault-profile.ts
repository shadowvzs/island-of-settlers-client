/** Intact Firuzabad-inspired shells: rounded ellipses, not later pointed or bulbous domes. */
export const PERSIAN_OCULUS_RADIUS = .045;
export const PERSIAN_INNER_RADIUS_SCALE = .91;
export const PERSIAN_INNER_HEIGHT_SCALE = .93;
export const PERSIAN_BARREL_INNER_WIDTH_SCALE = .86;
export const PERSIAN_BARREL_INNER_HEIGHT_SCALE = .84;
export const persianDomeSegments = (detailed: boolean) => ({ radial: detailed ? 40 : 16, rows: detailed ? 14 : 6 });
const TOP_ANGLE = Math.acos(PERSIAN_OCULUS_RADIUS * 2);

/** Outer ellipsoidal shell in a unit box; the tiny open oculus remains a real hole. */
export const persianDomeProfilePoint = (share: number): readonly [number, number] => {
  const angle = TOP_ANGLE * share;
  return [.5 * Math.cos(angle), Math.sin(angle) / Math.sin(TOP_ANGLE) - .5];
};

/** Exact polygonal shell height for canonical roof contacts, including the open oculus. */
export const persianDomeMeshHeight = (x: number, z: number, detailed: boolean): number | null => {
  const { radial, rows } = persianDomeSegments(detailed), slice = Math.PI * 2 / radial;
  const angle = Math.atan2(x, z), phase = ((angle % slice) + slice) % slice;
  const polygonScale = Math.cos(slice / 2) / Math.cos(phase - slice / 2);
  const radius = Math.hypot(x, z) / polygonScale;
  const innerLip = PERSIAN_OCULUS_RADIUS * PERSIAN_INNER_RADIUS_SCALE;
  if (radius > .5 + 1e-8 || radius < innerLip - 1e-8) return null;
  if (radius < PERSIAN_OCULUS_RADIUS) {
    const innerCrown = PERSIAN_INNER_HEIGHT_SCALE - .5;
    return innerCrown + (.5 - innerCrown) * (radius - innerLip) / (PERSIAN_OCULUS_RADIUS - innerLip);
  }
  for (let row = 0; row < rows; row++) {
    const first = persianDomeProfilePoint(row / rows), next = persianDomeProfilePoint((row + 1) / rows);
    if (radius < next[0] - 1e-9) continue;
    const amount = Math.max(0, Math.min(1, (first[0] - radius) / (first[0] - next[0])));
    return first[1] + (next[1] - first[1]) * amount;
  }
  return .5;
};

export const persianBarrelSegments = (detailed: boolean) => detailed ? 32 : 12;
export const persianBarrelHeight = (x: number, detailed: boolean): number | null => {
  if (Math.abs(x) > .5) return null;
  const segments = persianBarrelSegments(detailed);
  for (let index = 0; index < segments; index++) {
    const first = Math.PI * index / segments, next = Math.PI * (index + 1) / segments;
    const firstX = .5 * Math.cos(first), nextX = .5 * Math.cos(next);
    if (x < nextX - 1e-9) continue;
    const amount = (firstX - x) / (firstX - nextX);
    return -.5 + Math.sin(first) + (Math.sin(next) - Math.sin(first)) * amount;
  }
  return -.5;
};
