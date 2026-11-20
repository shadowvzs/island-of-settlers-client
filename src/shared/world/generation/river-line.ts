/** Spacing (cells) of the centreline samples. */
export const SAMPLE_SPACING = 0.5;
/** Estuary: over these last cells to the coast the bed widens and the surface sinks to the sea. */
export const MOUTH_LENGTH = 6;

/** Distance (cells) upstream from a sample to the coast; 0 at and beyond the coast. */
export const getMouthDistance = (step: number, mouthStep: number) =>
  Math.max(0, mouthStep - step) * SAMPLE_SPACING;
const SMOOTHING_PASSES = 3;
const AVERAGE_RADIUS = 4;
const AVERAGE_PASSES = 2;

export interface RiverPoint {
  x: number;
  z: number;
}

/** Moving average (ends pinned): removes the right angle turns of the 8-direction path. */
export const averagePath = (points: RiverPoint[]) => {
  let current = points;
  for (let pass = 0; pass < AVERAGE_PASSES; pass += 1) {
    current = current.map((point, index) => {
      if (index === 0 || index === current.length - 1) return point;
      const from = Math.max(0, index - AVERAGE_RADIUS);
      const to = Math.min(current.length - 1, index + AVERAGE_RADIUS);
      let x = 0;
      let z = 0;
      for (let other = from; other <= to; other += 1) {
        x += current[other]!.x;
        z += current[other]!.z;
      }
      return { x: x / (to - from + 1), z: z / (to - from + 1) };
    });
  }
  return current;
};

/** Chaikin corner cutting: turns the 8-direction vertex path into a smooth line. */
export const smoothPath = (points: RiverPoint[]) => {
  let current = points;
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    const next: RiverPoint[] = [current[0]!];
    for (let index = 0; index < current.length - 1; index += 1) {
      const a = current[index]!;
      const b = current[index + 1]!;
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
};

/** Even spacing along the path, so meanders, carving and the surface profile are uniform. */
export const resamplePath = (points: RiverPoint[]) => {
  const samples: RiverPoint[] = [points[0]!];
  let carried = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    let along = SAMPLE_SPACING - carried;
    while (along <= length) {
      const t = along / length;
      samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      along += SAMPLE_SPACING;
    }
    carried = length - (along - SAMPLE_SPACING);
  }
  return samples;
};

/**
 * Signed curvature (1 / cells, positive turning left) per sample: the heading change between
 * the chords `reach` samples back and ahead, over the distance of their midpoints.
 */
export const getCurvatures = (points: RiverPoint[], reach: number) =>
  Float32Array.from(points, (point, index) => {
    const before = points[Math.max(0, index - reach)]!;
    const after = points[Math.min(points.length - 1, index + reach)]!;
    const inX = point.x - before.x;
    const inZ = point.z - before.z;
    const outX = after.x - point.x;
    const outZ = after.z - point.z;
    const turn = Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ);
    const arc = Math.hypot(inX, inZ) + Math.hypot(outX, outZ);
    return arc > 0 ? (turn * 2) / arc : 0;
  });
