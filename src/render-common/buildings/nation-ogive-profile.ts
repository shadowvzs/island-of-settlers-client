/** One canonical Persian/Nubian pointed-dome profile, shared by the mesh and roof contacts. */
const BASE = .5, ARC_RADIUS = .75;
const APEX_ANGLE = Math.acos((ARC_RADIUS - BASE) / ARC_RADIUS);
const HEIGHT = ARC_RADIUS * Math.sin(APEX_ANGLE);

export const ogiveProfilePoint = (share: number): readonly [number, number] => {
  const angle = APEX_ANGLE * share;
  return [Math.max(0, BASE - ARC_RADIUS + ARC_RADIUS * Math.cos(angle)),
    ARC_RADIUS * Math.sin(angle) / HEIGHT - .5];
};

/** Exact height of the actual piecewise-linear lathe, including the polygonal ring outline. */
export const ogiveMeshHeight = (x: number, z: number, detailed: boolean, radialSegments?: number): number | null => {
  const count = radialSegments ?? (detailed ? 18 : 10), rows = detailed ? 8 : 4;
  const angle = Math.atan2(x, z), slice = Math.PI * 2 / count;
  const phase = ((angle % slice) + slice) % slice;
  const polygonScale = Math.cos(slice / 2) / Math.cos(phase - slice / 2);
  const radius = Math.hypot(x, z) / polygonScale;
  if (radius > BASE + 1e-8) return null;
  for (let row = 0; row < rows; row++) {
    const first = ogiveProfilePoint(row / rows), next = ogiveProfilePoint((row + 1) / rows);
    if (radius < next[0] - 1e-9) continue;
    const amount = Math.max(0, Math.min(1, (first[0] - radius) / (first[0] - next[0])));
    return first[1] + (next[1] - first[1]) * amount;
  }
  return .5;
};
